const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Se a variável DB_PATH estiver definida (ex: apontando pra um Volume persistente
// no Railway), usamos ela. Senão, cai no caminho local (só para testes).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'mgm.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
  seedUsers();
  console.log('Banco de dados inicializado em', DB_PATH);
}

// Adiciona colunas novas em bancos já existentes (sem apagar dados),
// necessárias para o painel: exclusão lógica e data de edição.
function migrate() {
  const colunas = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  if (!colunas.includes('deleted')) {
    db.exec('ALTER TABLE entries ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  }
  if (!colunas.includes('deleted_at')) {
    db.exec('ALTER TABLE entries ADD COLUMN deleted_at TEXT');
  }
  if (!colunas.includes('updated_at')) {
    db.exec('ALTER TABLE entries ADD COLUMN updated_at TEXT');
  }
}

// Cadastra automaticamente os dois usuários com base nas variáveis de ambiente,
// pra quem não é técnico não precisar digitar nenhum comando SQL.
function seedUsers() {
  const upsert = db.prepare(`
    INSERT INTO users (phone, name, role) VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1
  `);

  if (process.env.OWNER_PHONE && process.env.OWNER_NAME) {
    upsert.run(process.env.OWNER_PHONE.trim(), process.env.OWNER_NAME.trim(), 'owner');
  }
  if (process.env.ADMIN_PHONE && process.env.ADMIN_NAME) {
    upsert.run(process.env.ADMIN_PHONE.trim(), process.env.ADMIN_NAME.trim(), 'admin');
  }
}

if (require.main === module && process.argv.includes('--init')) {
  initDb();
}

module.exports = { db, initDb };
