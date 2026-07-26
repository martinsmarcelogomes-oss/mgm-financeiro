const { db } = require('../db');

function getState(phone) {
  const row = db.prepare('SELECT * FROM conversation_state WHERE phone = ?').get(phone);
  if (!row) return null;
  return { step: row.step, draft: JSON.parse(row.draft_json) };
}

function setState(phone, step, draft) {
  db.prepare(
    `INSERT INTO conversation_state (phone, step, draft_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(phone) DO UPDATE SET step = excluded.step, draft_json = excluded.draft_json, updated_at = datetime('now')`
  ).run(phone, step, JSON.stringify(draft));
}

function clearState(phone) {
  db.prepare('DELETE FROM conversation_state WHERE phone = ?').run(phone);
}

module.exports = { getState, setState, clearState };
