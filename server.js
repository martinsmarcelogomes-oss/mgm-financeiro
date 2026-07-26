require('dotenv').config();
const express = require('express');
const { db, initDb } = require('./db');
const { sendMessage } = require('./services/twilio');
const { analisarComprovante, interpretarTexto } = require('./services/claude');
const { getState, setState, clearState } = require('./services/sessionState');

initDb();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const AUTHORIZED = [process.env.OWNER_PHONE, process.env.ADMIN_PHONE]
  .filter(Boolean)
  .map((s) => s.trim());

// ---------- Helpers de banco ----------

function getUserByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ? AND active = 1').get(phone);
}

function getCostCenters() {
  return db.prepare('SELECT * FROM cost_centers WHERE active = 1 ORDER BY id').all();
}

function getCategories(costCenterId) {
  return db
    .prepare('SELECT * FROM categories WHERE cost_center_id = ? AND active = 1 ORDER BY id')
    .all(costCenterId);
}

function getPaymentMethods() {
  return db.prepare('SELECT * FROM payment_methods ORDER BY id').all();
}

function formatarLista(titulo, itens, nomeFn) {
  const linhas = itens.map((item, i) => `${i + 1}. ${nomeFn(item)}`).join('\n');
  return `${titulo}\n${linhas}\n\n_Responda com o número da opção._`;
}

// ---------- Máquina de estados ----------

async function iniciarLancamento(phone, userId, { mediaUrl, texto }) {
  const categoriasTodas = db.prepare('SELECT * FROM categories').all();
  let draft = { user_id: userId, raw_message: texto || null, type: 'despesa' };

  if (mediaUrl) {
    await sendMessage(phone, '📸 Recebi a foto, analisando o comprovante...');
    const dados = await analisarComprovante(mediaUrl, categoriasTodas);
    draft.valor = dados.valor;
    draft.entry_date = dados.data;
    draft.vendor = dados.estabelecimento;
    draft.descricao_sugerida = dados.descricao;
    draft.categoria_sugerida = dados.categoria_sugerida;
    draft.photo_url = mediaUrl;
  } else {
    const dados = await interpretarTexto(texto, categoriasTodas);
    draft.valor = dados.valor;
    draft.descricao_sugerida = dados.descricao;
    draft.categoria_sugerida = dados.categoria_sugerida;
    if (/\brecebi\b|\breceita\b/i.test(texto)) draft.type = 'receita';
  }

  // Se não conseguiu extrair valor, pergunta antes de tudo
  if (!draft.valor) {
    setState(phone, 'aguardando_valor', draft);
    await sendMessage(phone, '💰 Não identifiquei o valor. Qual foi o valor da despesa? (ex: 50.00)');
    return;
  }

  perguntarCentroCusto(phone, draft);
}

async function perguntarCentroCusto(phone, draft) {
  setState(phone, 'aguardando_centro', draft);
  const centros = getCostCenters();
  const valorFmt = draft.valor ? `R$ ${Number(draft.valor).toFixed(2)}` : '(valor não identificado)';
  const resumo = `✅ Valor: ${valorFmt}${draft.vendor ? `\n🏪 ${draft.vendor}` : ''}\n\nEsse lançamento é de qual centro de custo?`;
  await sendMessage(phone, formatarLista(resumo, centros, (c) => c.name));
}

async function perguntarCategoria(phone, draft) {
  setState(phone, 'aguardando_categoria', draft);
  const categorias = getCategories(draft.cost_center_id);
  await sendMessage(phone, formatarLista('📂 Qual a categoria?', categorias, (c) => c.name));
}

async function perguntarPagamento(phone, draft) {
  setState(phone, 'aguardando_pagamento', draft);
  const metodos = getPaymentMethods();
  await sendMessage(phone, formatarLista('💳 Qual a forma de pagamento?', metodos, (m) => m.name));
}

async function perguntarConfirmacao(phone, draft) {
  setState(phone, 'aguardando_confirmacao', draft);
  const centro = db.prepare('SELECT name FROM cost_centers WHERE id = ?').get(draft.cost_center_id);
  const categoria = db.prepare('SELECT name FROM categories WHERE id = ?').get(draft.category_id);
  const pagamento = db.prepare('SELECT name FROM payment_methods WHERE id = ?').get(draft.payment_method_id);

  const resumo = [
    '📝 Confirme o lançamento:',
    `Tipo: ${draft.type === 'receita' ? 'Receita' : 'Despesa'}`,
    `Valor: R$ ${Number(draft.valor).toFixed(2)}`,
    `Centro de custo: ${centro.name}`,
    `Categoria: ${categoria.name}`,
    `Pagamento: ${pagamento.name}`,
    draft.vendor ? `Estabelecimento: ${draft.vendor}` : null,
    '',
    'Responda *1* para confirmar ou *2* para cancelar.',
  ]
    .filter(Boolean)
    .join('\n');

  await sendMessage(phone, resumo);
}

function salvarLancamento(draft) {
  const stmt = db.prepare(`
    INSERT INTO entries
      (user_id, cost_center_id, category_id, payment_method_id, type, value, description, vendor, entry_date, photo_url, raw_message)
    VALUES (@user_id, @cost_center_id, @category_id, @payment_method_id, @type, @valor, @descricao, @vendor, @entry_date, @photo_url, @raw_message)
  `);
  stmt.run({
    user_id: draft.user_id,
    cost_center_id: draft.cost_center_id,
    category_id: draft.category_id,
    payment_method_id: draft.payment_method_id,
    type: draft.type,
    valor: draft.valor,
    descricao: draft.descricao_sugerida || null,
    vendor: draft.vendor || null,
    entry_date: draft.entry_date || null,
    photo_url: draft.photo_url || null,
    raw_message: draft.raw_message || null,
  });
}

// ---------- Webhook principal ----------

app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('<Response></Response>'); // responde rápido ao Twilio

  const phone = req.body.From; // formato whatsapp:+55...
  const texto = (req.body.Body || '').trim();
  const mediaUrl = req.body.NumMedia && Number(req.body.NumMedia) > 0 ? req.body.MediaUrl0 : null;

  try {
    if (!AUTHORIZED.includes(phone)) {
      await sendMessage(phone, '🚫 Este número não está autorizado a lançar despesas.');
      return;
    }

    const user = getUserByPhone(phone);
    if (!user) {
      await sendMessage(phone, '🚫 Usuário não cadastrado. Peça para o administrador te cadastrar na tabela users.');
      return;
    }

    const state = getState(phone);

    // Comando para cancelar a qualquer momento
    if (/^cancelar$/i.test(texto)) {
      clearState(phone);
      await sendMessage(phone, '❌ Lançamento cancelado.');
      return;
    }

    if (!state) {
      // Novo lançamento
      if (!mediaUrl && !texto) return;
      await iniciarLancamento(phone, user.id, { mediaUrl, texto });
      return;
    }

    const draft = state.draft;

    switch (state.step) {
      case 'aguardando_valor': {
        const valor = parseFloat(texto.replace(',', '.').replace(/[^\d.]/g, ''));
        if (!valor) {
          await sendMessage(phone, 'Não entendi o valor. Digite apenas o número, ex: 50.00');
          return;
        }
        draft.valor = valor;
        await perguntarCentroCusto(phone, draft);
        return;
      }

      case 'aguardando_centro': {
        const centros = getCostCenters();
        const idx = parseInt(texto, 10) - 1;
        if (isNaN(idx) || !centros[idx]) {
          await sendMessage(phone, 'Opção inválida. Responda com o número do centro de custo.');
          return;
        }
        draft.cost_center_id = centros[idx].id;
        await perguntarCategoria(phone, draft);
        return;
      }

      case 'aguardando_categoria': {
        const categorias = getCategories(draft.cost_center_id);
        const idx = parseInt(texto, 10) - 1;
        if (isNaN(idx) || !categorias[idx]) {
          await sendMessage(phone, 'Opção inválida. Responda com o número da categoria.');
          return;
        }
        draft.category_id = categorias[idx].id;
        await perguntarPagamento(phone, draft);
        return;
      }

      case 'aguardando_pagamento': {
        const metodos = getPaymentMethods();
        const idx = parseInt(texto, 10) - 1;
        if (isNaN(idx) || !metodos[idx]) {
          await sendMessage(phone, 'Opção inválida. Responda com o número da forma de pagamento.');
          return;
        }
        draft.payment_method_id = metodos[idx].id;
        await perguntarConfirmacao(phone, draft);
        return;
      }

      case 'aguardando_confirmacao': {
        if (texto === '1') {
          salvarLancamento(draft);
          clearState(phone);
          await sendMessage(phone, '✅ Lançamento salvo com sucesso!');
        } else if (texto === '2') {
          clearState(phone);
          await sendMessage(phone, '❌ Lançamento cancelado.');
        } else {
          await sendMessage(phone, 'Responda *1* para confirmar ou *2* para cancelar.');
        }
        return;
      }

      default:
        clearState(phone);
    }
  } catch (err) {
    console.error('Erro no webhook:', err);
    await sendMessage(phone, '⚠️ Ocorreu um erro ao processar sua mensagem. Tente novamente.');
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
