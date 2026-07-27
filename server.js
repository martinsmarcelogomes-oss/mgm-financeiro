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
app.use('/api', require('./routes/api'));
app.use(express.static('public'));

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

async function iniciarLancamento(phone, userId, { mediaUrl, texto, mediaContentType }) {
  const categoriasTodas = db.prepare('SELECT * FROM categories').all();
  let draft = { user_id: userId, raw_message: texto || null, type: 'despesa' };

  if (mediaUrl) {
    const dados = await analisarComprovante(mediaUrl, categoriasTodas, mediaContentType);
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
  const resumo = `✅ Valor: ${valorFmt}${draft.vendor ? `\n🏪 ${draft.vendor}` : ''}\n\nEsse lançamento é de qual centro de custo?\n_(digite "cancelar" a qualquer momento para desistir)_`;
  await sendMessage(phone, formatarLista(resumo, centros, (c) => c.name));
}

async function perguntarCategoriaPagamento(phone, draft) {
  setState(phone, 'aguardando_categoria_pagamento', draft);
  const categorias = getCategories(draft.cost_center_id);
  const metodos = getPaymentMethods();

  const listaCategorias = categorias.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
  const listaPagamentos = metodos.map((m, i) => `${i + 1}. ${m.name}`).join('\n');

  const mensagem = [
    '📂 Categoria:',
    listaCategorias,
    '',
    '💳 Forma de pagamento:',
    listaPagamentos,
    '',
    '_Responda com os dois números juntos, ex: 3 2 (categoria e pagamento)._',
  ].join('\n');

  await sendMessage(phone, mensagem);
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
  const mediaContentType = req.body.MediaContentType0 || null;

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

    // Uma foto/PDF novo sempre inicia um lançamento novo, mesmo que exista
    // uma confirmação antiga pendente sem resposta.
    if (mediaUrl) {
      if (state) {
        await sendMessage(phone, '⚠️ Havia um lançamento anterior pendente de confirmação, foi cancelado automaticamente.');
      }
      clearState(phone);
      await iniciarLancamento(phone, user.id, { mediaUrl, texto, mediaContentType });
      return;
    }

    if (!state) {
      // Novo lançamento
      if (!texto) return;
      await iniciarLancamento(phone, user.id, { mediaUrl, texto, mediaContentType });
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
        await perguntarCategoriaPagamento(phone, draft);
        return;
      }

      case 'aguardando_categoria_pagamento': {
        const numeros = texto.split(/[,\s]+/).filter(Boolean).map((n) => parseInt(n, 10));
        const categorias = getCategories(draft.cost_center_id);
        const metodos = getPaymentMethods();
        const [idxCategoria, idxPagamento] = numeros;

        const categoria = categorias[idxCategoria - 1];
        const pagamento = metodos[idxPagamento - 1];

        if (!categoria || !pagamento) {
          await sendMessage(phone, 'Não entendi. Responda com os dois números juntos, ex: 3 2 (categoria e pagamento).');
          return;
        }

        draft.category_id = categoria.id;
        draft.payment_method_id = pagamento.id;

        salvarLancamento(draft);
        clearState(phone);

        const centro = db.prepare('SELECT name FROM cost_centers WHERE id = ?').get(draft.cost_center_id);
        const resumo = [
          '✅ Lançamento salvo!',
          `${draft.type === 'receita' ? 'Receita' : 'Despesa'}: R$ ${Number(draft.valor).toFixed(2)}`,
          `${centro.name} · ${categoria.name} · ${pagamento.name}`,
          draft.vendor ? draft.vendor : null,
          '',
          '_Errou algo? Corrija no painel web._',
        ]
          .filter(Boolean)
          .join('\n');
        await sendMessage(phone, resumo);
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
