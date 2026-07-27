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

module.exports = router;
