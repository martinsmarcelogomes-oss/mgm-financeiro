const estado = {
  meta: null,
  centroAtivo: '',
  mes: '',
  verExcluidos: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatarMoeda(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return '—';
  const data = iso.length > 10 ? iso.slice(0, 10) : iso;
  const [ano, mes, dia] = data.split('-');
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function mesAtualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Carregar dados de apoio (centros, categorias, pagamentos) ----------
async function carregarMeta() {
  const res = await fetch('/api/meta');
  if (res.status === 401) return exigirAutenticacao();
  estado.meta = await res.json();
  preencherSelects();
}

function preencherSelects() {
  const selCentro = $('#editar-centro');
  selCentro.innerHTML = estado.meta.costCenters
    .map((c) => `<option value="${c.id}" data-slug="${c.slug}">${c.name}</option>`)
    .join('');

  const selPagamento = $('#editar-pagamento');
  selPagamento.innerHTML = estado.meta.paymentMethods
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  atualizarCategoriasDoModal();
  selCentro.addEventListener('change', atualizarCategoriasDoModal);
}

function atualizarCategoriasDoModal() {
  const centroId = Number($('#editar-centro').value);
  const selCategoria = $('#editar-categoria');
  const categorias = estado.meta.categories.filter((c) => c.cost_center_id === centroId);
  selCategoria.innerHTML = categorias.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ---------- Carregar lançamentos ----------
async function carregarEntradas() {
  const params = new URLSearchParams();
  if (estado.centroAtivo) params.set('cost_center', estado.centroAtivo);
  if (estado.mes) params.set('month', estado.mes);
  if (estado.verExcluidos) params.set('deleted', '1');

  const res = await fetch(`/api/entries?${params.toString()}`);
  if (res.status === 401) return exigirAutenticacao();
  const entradas = await res.json();
  renderizarTabela(entradas);
  renderizarResumo(entradas);
}

function renderizarResumo(entradas) {
  const totais = { pessoal: 0, fazenda: 0, mgm: 0 };
  entradas.forEach((e) => {
    if (e.deleted) return;
    const sinal = e.type === 'receita' ? 1 : -1;
    if (totais[e.cost_center_slug] !== undefined) {
      totais[e.cost_center_slug] += sinal * Number(e.value);
    }
  });

  const nomes = { pessoal: 'Pessoal', fazenda: 'Fazenda', mgm: 'MGM' };
  $('#resumo').innerHTML = Object.entries(totais)
    .map(([slug, valor]) => {
      const classe = valor >= 0 ? 'receita' : '';
      return `
        <div class="cartao">
          <div class="cartao-titulo">${nomes[slug]}</div>
          <div class="cartao-valor ${classe}">${formatarMoeda(valor)}</div>
        </div>`;
    })
    .join('');
}

function renderizarTabela(entradas) {
  $('#contador').textContent = `${entradas.length} lançamento${entradas.length === 1 ? '' : 's'}`;

  if (entradas.length === 0) {
    $('#tabela-corpo').innerHTML = `<tr><td colspan="8" class="vazio">Nenhum lançamento encontrado.</td></tr>`;
    return;
  }

  $('#tabela-corpo').innerHTML = entradas
    .map((e) => {
      const acoes = e.deleted
        ? `<button class="btn-icone restaurar" data-acao="restaurar" data-id="${e.id}">Restaurar</button>`
        : `
          <button class="btn-icone" data-acao="editar" data-id="${e.id}">Editar</button>
          <button class="btn-icone excluir" data-acao="excluir" data-id="${e.id}">Excluir</button>
        `;

      return `
        <tr data-id="${e.id}">
          <td data-rotulo="Data">${formatarData(e.entry_date || e.created_at)}</td>
          <td data-rotulo="Centro">${e.cost_center_name}</td>
          <td data-rotulo="Categoria">${e.category_name || '—'}${e.deleted ? '<span class="tag-excluido">excluído</span>' : ''}</td>
          <td data-rotulo="Valor" class="valor ${e.type === 'receita' ? 'receita' : 'despesa'}">${formatarMoeda(e.value)}</td>
          <td data-rotulo="Pagamento">${e.payment_method_name || '—'}</td>
          <td data-rotulo="Estabelecimento">${e.vendor || '—'}</td>
          <td data-rotulo="Lançado por">${e.user_name || '—'}</td>
          <td data-rotulo="Ações" class="acoes-cel">${acoes}</td>
        </tr>`;
    })
    .join('');

  // Guardamos os dados brutos para reabrir no modal de edição
  window.__entradasAtuais = entradas;
}

// ---------- Ações da tabela (editar / excluir / restaurar) ----------
$('#tabela-corpo').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-acao]');
  if (!btn) return;
  const id = btn.dataset.id;
  const acao = btn.dataset.acao;

  if (acao === 'editar') {
    const entrada = window.__entradasAtuais.find((e) => String(e.id) === id);
    abrirModalEdicao(entrada);
  }

  if (acao === 'excluir') {
    if (!confirm('Excluir este lançamento? Ele pode ser restaurado depois em "Ver excluídos".')) return;
    await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    carregarEntradas();
  }

  if (acao === 'restaurar') {
    await fetch(`/api/entries/${id}/restore`, { method: 'POST' });
    carregarEntradas();
  }
});

// ---------- Modal de edição ----------
function abrirModalEdicao(entrada) {
  $('#editar-id').value = entrada.id;
  $('#editar-tipo').value = entrada.type;
  $('#editar-valor').value = entrada.value;
  $('#editar-data').value = (entrada.entry_date || entrada.created_at || '').slice(0, 10);
  $('#editar-centro').value = entrada.cost_center_id;
  atualizarCategoriasDoModal();
  $('#editar-categoria').value = entrada.category_id || '';
  $('#editar-pagamento').value = entrada.payment_method_id || '';
  $('#editar-estabelecimento').value = entrada.vendor || '';
  $('#editar-descricao').value = entrada.description || '';
  $('#modal-fundo').classList.add('aberto');
}

function fecharModal() {
  $('#modal-fundo').classList.remove('aberto');
}

$('#btn-cancelar').addEventListener('click', fecharModal);
$('#modal-fundo').addEventListener('click', (ev) => {
  if (ev.target === $('#modal-fundo')) fecharModal();
});

$('#form-editar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = $('#editar-id').value;

  const payload = {
    type: $('#editar-tipo').value,
    value: Number($('#editar-valor').value),
    entry_date: $('#editar-data').value || null,
    cost_center_id: Number($('#editar-centro').value),
    category_id: Number($('#editar-categoria').value),
    payment_method_id: Number($('#editar-pagamento').value),
    vendor: $('#editar-estabelecimento').value || null,
    description: $('#editar-descricao').value || null,
  };

  await fetch(`/api/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  fecharModal();
  carregarEntradas();
});

// ---------- Filtros (abas, mês, excluídos) ----------
$('#abas').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.aba');
  if (!btn) return;
  $$('.aba').forEach((a) => a.classList.remove('ativa'));
  btn.classList.add('ativa');
  estado.centroAtivo = btn.dataset.slug;
  carregarEntradas();
});

$('#filtro-mes').addEventListener('change', (ev) => {
  estado.mes = ev.target.value;
  carregarEntradas();
});

$('#filtro-excluidos').addEventListener('change', (ev) => {
  estado.verExcluidos = ev.target.checked;
  carregarEntradas();
});

function exigirAutenticacao() {
  document.body.innerHTML = `
    <div style="padding:60px 20px;text-align:center;font-family:Inter,sans-serif;">
      <h2 style="font-family:Fraunces,serif;">Acesso restrito</h2>
      <p>Recarregue a página e informe a senha do painel quando solicitado.</p>
    </div>`;
}

// ---------- Inicialização ----------
(async function init() {
  estado.mes = mesAtualISO();
  $('#filtro-mes').value = estado.mes;
  await carregarMeta();
  await carregarEntradas();
})();
