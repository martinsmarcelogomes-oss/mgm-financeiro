const express = require('express');
const { db } = require('../db');

const router = express.Router();

// ---------- Autenticação simples por senha (Basic Auth) ----------
router.use((req, res, next) => {
  const senha = process.env.DASHBOARD_PASSWORD;
  if (!senha) return next(); // se não configurada, não bloqueia (não recomendado)

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="MGM Financeiro"');
    return res.status(401).send('Autenticação necessária');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [, pass] = decoded.split(':');
  if (pass !== senha) {
    res.set('WWW-Authenticate', 'Basic realm="MGM Financeiro"');
    return res.status(401).send('Senha incorreta');
  }
  next();
});

// ---------- Dados de apoio (centros de custo, categorias, formas de pagamento) ----------
router.get('/meta', (req, res) => {
  const costCenters = db.prepare('SELECT * FROM cost_centers WHERE active = 1 ORDER BY id').all();
  const categories = db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY id').all();
  const paymentMethods = db.prepare('SELECT * FROM payment_methods ORDER BY id').all();
  res.json({ costCenters, categories, paymentMethods });
});

// ---------- Listar lançamentos (com filtros) ----------
router.get('/entries', (req, res) => {
  const { cost_center, month, deleted } = req.query;

  let sql = `
    SELECT e.*, cc.name as cost_center_name, cc.slug as cost_center_slug,
           c.name as category_name, pm.name as payment_method_name, u.name as user_name
    FROM entries e
    JOIN cost_centers cc ON e.cost_center_id = cc.id
    LEFT JOIN categories c ON e.category_id = c.id
    LEFT JOIN payment_methods pm ON e.payment_method_id = pm.id
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.deleted = ?
  `;
  const params = [deleted === '1' ? 1 : 0];

  if (cost_center) {
    sql += ' AND cc.slug = ?';
    params.push(cost_center);
  }
  if (month) {
    sql += ` AND substr(COALESCE(e.entry_date, e.created_at), 1, 7) = ?`;
    params.push(month);
  }
  sql += ' ORDER BY COALESCE(e.entry_date, e.created_at) DESC, e.id DESC';

  const entries = db.prepare(sql).all(...params);
  res.json(entries);
});

// ---------- Editar um lançamento ----------
router.put('/entries/:id', (req, res) => {
  const { id } = req.params;
  const { value, cost_center_id, category_id, payment_method_id, entry_date, vendor, description, type } = req.body;

  const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado' });

  db.prepare(
    `UPDATE entries SET
       value = COALESCE(?, value),
       cost_center_id = COALESCE(?, cost_center_id),
       category_id = COALESCE(?, category_id),
       payment_method_id = COALESCE(?, payment_method_id),
       entry_date = COALESCE(?, entry_date),
       vendor = COALESCE(?, vendor),
       description = COALESCE(?, description),
       type = COALESCE(?, type),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    value ?? null,
    cost_center_id ?? null,
    category_id ?? null,
    payment_method_id ?? null,
    entry_date ?? null,
    vendor ?? null,
    description ?? null,
    type ?? null,
    id
  );

  const updated = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  res.json(updated);
});

// ---------- Excluir (exclusão lógica, não apaga de verdade) ----------
router.delete('/entries/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Lançamento não encontrado' });

  db.prepare(`UPDATE entries SET deleted = 1, deleted_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ---------- Restaurar um lançamento excluído ----------
router.post('/entries/:id/restore', (req, res) => {
  const { id } = req.params;
  db.prepare(`UPDATE entries SET deleted = 0, deleted_at = NULL WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// ---------- Criar categoria ----------
router.post('/categories', (req, res) => {
  const { cost_center_id, name } = req.body;
  if (!cost_center_id || !name || !name.trim()) {
    return res.status(400).json({ error: 'Centro de custo e nome são obrigatórios' });
  }
  try {
    const info = db
      .prepare('INSERT INTO categories (cost_center_id, name) VALUES (?, ?)')
      .run(cost_center_id, name.trim());
    res.json({ id: info.lastInsertRowid, cost_center_id, name: name.trim(), active: 1 });
  } catch (err) {
    res.status(400).json({ error: 'Essa categoria já existe nesse centro de custo' });
  }
});

// ---------- Renomear ou reativar/desativar categoria ----------
router.put('/categories/:id', (req, res) => {
  const { id } = req.params;
  const { name, active } = req.body;
  db.prepare('UPDATE categories SET name = COALESCE(?, name), active = COALESCE(?, active) WHERE id = ?').run(
    name ? name.trim() : null,
    active === undefined ? null : active ? 1 : 0,
    id
  );
  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.json(updated);
});

// ---------- Desativar categoria (não apaga histórico) ----------
router.delete('/categories/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Relatório de fluxo de caixa por centro de custo e ano ----------
router.get('/relatorio', (req, res) => {
  const { cost_center, year } = req.query;
  const ano = year || String(new Date().getFullYear());

  let sql = `
    SELECT e.type, e.value, e.category_id, substr(COALESCE(e.entry_date, e.created_at), 1, 7) as ym
    FROM entries e
    JOIN cost_centers cc ON e.cost_center_id = cc.id
    WHERE e.deleted = 0 AND substr(COALESCE(e.entry_date, e.created_at), 1, 4) = ?
  `;
  const params = [ano];
  if (cost_center) {
    sql += ' AND cc.slug = ?';
    params.push(cost_center);
  }
  const linhas = db.prepare(sql).all(...params);

  const meses = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const ym = `${ano}-${mm}`;
    const doMes = linhas.filter((l) => l.ym === ym);
    const receitas = doMes.filter((l) => l.type === 'receita').reduce((s, l) => s + l.value, 0);
    const despesas = doMes.filter((l) => l.type === 'despesa').reduce((s, l) => s + l.value, 0);
    return { mes: mm, receitas, despesas, saldo: receitas - despesas };
  });

  const totalReceitas = linhas.filter((l) => l.type === 'receita').reduce((s, l) => s + l.value, 0);
  const totalDespesas = linhas.filter((l) => l.type === 'despesa').reduce((s, l) => s + l.value, 0);
  const lucroLiquido = totalReceitas - totalDespesas;
  const lucratividade = totalReceitas > 0 ? (lucroLiquido / totalReceitas) * 100 : 0;

  const despesasPorCategoria = {};
  linhas
    .filter((l) => l.type === 'despesa')
    .forEach((l) => {
      const chave = l.category_id || 'sem_categoria';
      despesasPorCategoria[chave] = (despesasPorCategoria[chave] || 0) + l.value;
    });

  const categorias = db.prepare('SELECT id, name FROM categories').all();
  const mapaCategorias = Object.fromEntries(categorias.map((c) => [c.id, c.name]));

  const topDespesas = Object.entries(despesasPorCategoria)
    .map(([id, valor]) => ({ categoria: mapaCategorias[id] || 'Sem categoria', valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);

  res.json({ ano, meses, totalReceitas, totalDespesas, lucroLiquido, lucratividade, topDespesas });
});

// ---------- Usuários (para saber quem está lançando pelo painel) ----------
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY id').all();
  res.json(users);
});

// ---------- Criar um novo lançamento direto pelo painel ----------
router.post('/entries', (req, res) => {
  const {
    user_id,
    type,
    value,
    cost_center_id,
    category_id,
    payment_method_id,
    entry_date,
    vendor,
    description,
  } = req.body;

  if (!user_id || !value || !cost_center_id || !category_id || !payment_method_id) {
    return res.status(400).json({ error: 'Preencha usuário, valor, centro de custo, categoria e pagamento.' });
  }

  const info = db
    .prepare(
      `INSERT INTO entries
        (user_id, cost_center_id, category_id, payment_method_id, type, value, description, vendor, entry_date, raw_message)
       VALUES (@user_id, @cost_center_id, @category_id, @payment_method_id, @type, @value, @description, @vendor, @entry_date, 'Lançado pelo painel')`
    )
    .run({
      user_id,
      cost_center_id,
      category_id,
      payment_method_id,
      type: type || 'despesa',
      value,
      description: description || null,
      vendor: vendor || null,
      entry_date: entry_date || null,
    });

  const novo = db.prepare('SELECT * FROM entries WHERE id = ?').get(info.lastInsertRowid);
  res.json(novo);
});

module.exports = router;
