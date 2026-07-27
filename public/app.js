const estado = {
  meta: null,
  centroAtivo: '',
  mes: '',
  ano: '',
  verExcluidos: false,
  modo: 'lancamentos',
};

let graficoSaldo = null;
let graficoReceitaDespesa = null;

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
  atualizarVisaoAtiva();
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

function atualizarVisaoAtiva() {
  if (estado.modo === 'lancamentos') {
    carregarEntradas();
  } else {
    carregarFluxoDeCaixa();
  }
}

// ---------- Alternância de modo (Lançamentos / Fluxo de Caixa) ----------
$('#modos').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.modo');
  if (!btn) return;
  $$('.modo').forEach((m) => m.classList.remove('ativo'));
  btn.classList.add('ativo');
  estado.modo = btn.dataset.modo;

  $('#view-lancamentos').classList.toggle('escondido', estado.modo !== 'lancamentos');
  $('#view-fluxo').classList.toggle('escondido', estado.modo !== 'fluxo');

  atualizarVisaoAtiva();
});

$('#filtro-ano').addEventListener('change', (ev) => {
  estado.ano = ev.target.value;
  carregarFluxoDeCaixa();
});

// ---------- Fluxo de caixa: carregar e renderizar ----------
async function carregarFluxoDeCaixa() {
  const params = new URLSearchParams();
  if (estado.centroAtivo) params.set('cost_center', estado.centroAtivo);
  if (estado.ano) params.set('year', estado.ano);

  const res = await fetch(`/api/relatorio?${params.toString()}`);
  if (res.status === 401) return exigirAutenticacao();
  const dados = await res.json();

  renderizarCartoesFluxo(dados);
  renderizarGraficoSaldo(dados);
  renderizarGraficoReceitaDespesa(dados);
  renderizarTopDespesas(dados);
}

function renderizarCartoesFluxo(dados) {
  const lucroClasse = dados.lucroLiquido >= 0 ? 'receita' : '';
  $('#resumo-fluxo').innerHTML = `
    <div class="cartao">
      <div class="cartao-titulo">Total de Receitas</div>
      <div class="cartao-valor receita">${formatarMoeda(dados.totalReceitas)}</div>
    </div>
    <div class="cartao">
      <div class="cartao-titulo">Total de Despesas</div>
      <div class="cartao-valor">${formatarMoeda(dados.totalDespesas)}</div>
    </div>
    <div class="cartao">
      <div class="cartao-titulo">Lucro Líquido</div>
      <div class="cartao-valor ${lucroClasse}">${formatarMoeda(dados.lucroLiquido)}</div>
    </div>
    <div class="cartao cartao-lucratividade">
      <div class="cartao-titulo">Lucratividade</div>
      <div class="cartao-valor">${dados.lucratividade.toFixed(1)}%</div>
    </div>
  `;
}

const NOMES_MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function renderizarGraficoSaldo(dados) {
  const ctx = $('#grafico-saldo').getContext('2d');
  const saldos = dados.meses.map((m) => m.saldo);

  if (graficoSaldo) graficoSaldo.destroy();
  graficoSaldo = new Chart(ctx, {
    type: 'line',
    data: {
      labels: NOMES_MESES,
      datasets: [
        {
          label: 'Saldo',
          data: saldos,
          borderColor: '#C08A2E',
          backgroundColor: 'rgba(192,138,46,0.15)',
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: (v) => formatarMoeda(v) } },
      },
    },
  });
}

function renderizarGraficoReceitaDespesa(dados) {
  const ctx = $('#grafico-receita-despesa').getContext('2d');
  const receitas = dados.meses.map((m) => m.receitas);
  const despesas = dados.meses.map((m) => -m.despesas);

  if (graficoReceitaDespesa) graficoReceitaDespesa.destroy();
  graficoReceitaDespesa = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: NOMES_MESES,
      datasets: [
        { label: 'Receita', data: receitas, backgroundColor: '#2F6B4F' },
        { label: 'Despesa', data: despesas, backgroundColor: '#A6472E' },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { ticks: { callback: (v) => formatarMoeda(Math.abs(v)) } },
      },
    },
  });
}

function renderizarTopDespesas(dados) {
  const max = Math.max(...dados.topDespesas.map((d) => d.valor), 1);
  $('#top-despesas').innerHTML = dados.topDespesas.length
    ? dados.topDespesas
        .map(
          (d) => `
        <div class="top-despesa-item">
          <span class="top-despesa-nome">${d.categoria}</span>
          <div class="top-despesa-barra-wrap">
            <div class="top-despesa-barra" style="width:${(d.valor / max) * 100}%"></div>
          </div>
          <span class="top-despesa-valor">${formatarMoeda(d.valor)}</span>
        </div>`
        )
        .join('')
    : '<p class="vazio">Nenhuma despesa no período.</p>';
}

// ---------- Gerenciar categorias ----------
$('#btn-categorias').addEventListener('click', () => {
  const selCentro = $('#categoria-centro-select');
  selCentro.innerHTML = estado.meta.costCenters.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  renderizarListaCategorias();
  $('#modal-categorias-fundo').classList.add('aberto');
});

$('#btn-fechar-categorias').addEventListener('click', () => {
  $('#modal-categorias-fundo').classList.remove('aberto');
  carregarMeta(); // recarrega categorias atualizadas para os selects de edição
});

$('#categoria-centro-select').addEventListener('change', renderizarListaCategorias);

function renderizarListaCategorias() {
  const centroId = Number($('#categoria-centro-select').value);
  const categorias = estado.meta.categories.filter((c) => c.cost_center_id === centroId);

  $('#lista-categorias').innerHTML = categorias
    .map(
      (c) => `
      <li class="${c.active ? '' : 'inativa'}" data-id="${c.id}">
        <input type="text" value="${c.name}" data-id="${c.id}" />
        <button class="btn-icone" data-acao="renomear" data-id="${c.id}">Salvar</button>
        <button class="btn-icone ${c.active ? 'excluir' : 'restaurar'}" data-acao="${c.active ? 'desativar' : 'reativar'}" data-id="${c.id}">
          ${c.active ? 'Desativar' : 'Reativar'}
        </button>
      </li>`
    )
    .join('');
}

$('#lista-categorias').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-acao]');
  if (!btn) return;
  const id = btn.dataset.id;
  const acao = btn.dataset.acao;

  if (acao === 'renomear') {
    const input = document.querySelector(`#lista-categorias input[data-id="${id}"]`);
    await fetch(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.value }),
    });
  }

  if (acao === 'desativar' || acao === 'reativar') {
    await fetch(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: acao === 'reativar' }),
    });
  }

  await carregarMeta();
  renderizarListaCategorias();
});

$('#form-nova-categoria').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nome = $('#nova-categoria-nome').value.trim();
  const centroId = Number($('#categoria-centro-select').value);
  if (!nome) return;

  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cost_center_id: centroId, name: nome }),
  });

  if (res.ok) {
    $('#nova-categoria-nome').value = '';
    await carregarMeta();
    renderizarListaCategorias();
  } else {
    const erro = await res.json();
    alert(erro.error || 'Não foi possível adicionar a categoria.');
  }
});

// ---------- Inicialização ----------
(async function init() {
  estado.mes = mesAtualISO();
  estado.ano = String(new Date().getFullYear());
  $('#filtro-mes').value = estado.mes;
  $('#filtro-ano').value = estado.ano;
  await carregarMeta();
  await carregarEntradas();
})();
