-- ============================================
-- MGM Financeiro - Schema do banco de dados
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,          -- número do WhatsApp, formato whatsapp:+55...
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',  -- 'owner' | 'admin'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,           -- 'Pessoal' | 'Fazenda' | 'MGM Assessoria Veterinária'
  slug TEXT UNIQUE NOT NULL,           -- 'pessoal' | 'fazenda' | 'mgm'
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(cost_center_id, name)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL            -- 'Dinheiro' | 'PIX' | 'Débito' | 'Crédito' | 'Boleto' | 'Transferência'
);

-- Lançamentos financeiros (receitas e despesas)
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
  category_id INTEGER REFERENCES categories(id),
  payment_method_id INTEGER REFERENCES payment_methods(id),
  type TEXT NOT NULL DEFAULT 'despesa',   -- 'despesa' | 'receita'
  value REAL NOT NULL,
  description TEXT,
  vendor TEXT,                            -- estabelecimento/fornecedor (extraído da foto ou digitado)
  entry_date TEXT,                        -- data da despesa (extraída ou informada)
  photo_url TEXT,                         -- caminho/local do comprovante, se houver
  raw_message TEXT,                       -- texto original enviado pelo usuário
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Estado da conversa em andamento por número de telefone
-- (guarda o lançamento sendo montado até o usuário confirmar tudo)
CREATE TABLE IF NOT EXISTS conversation_state (
  phone TEXT PRIMARY KEY,
  step TEXT NOT NULL,                     -- 'aguardando_centro' | 'aguardando_categoria' | 'aguardando_pagamento' | 'aguardando_confirmacao'
  draft_json TEXT NOT NULL,               -- JSON com os dados parciais do lançamento
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeds iniciais
INSERT OR IGNORE INTO cost_centers (name, slug) VALUES
  ('Pessoal', 'pessoal'),
  ('Fazenda', 'fazenda'),
  ('MGM Assessoria Veterinária', 'mgm');

INSERT OR IGNORE INTO payment_methods (name) VALUES
  ('Dinheiro'), ('PIX'), ('Débito'), ('Crédito'), ('Boleto'), ('Transferência');

-- Categorias por centro de custo
INSERT OR IGNORE INTO categories (cost_center_id, name)
SELECT id, cat FROM cost_centers, (
  SELECT 'Combustível' AS cat UNION SELECT 'Alimentação' UNION SELECT 'Manutenção'
  UNION SELECT 'Saúde' UNION SELECT 'Educação' UNION SELECT 'Lazer' UNION SELECT 'Outros'
) WHERE slug = 'pessoal';

INSERT OR IGNORE INTO categories (cost_center_id, name)
SELECT id, cat FROM cost_centers, (
  SELECT 'Ração/Insumos' AS cat UNION SELECT 'Combustível' UNION SELECT 'Manutenção de Máquinas'
  UNION SELECT 'Veterinário/Medicamentos' UNION SELECT 'Mão de Obra' UNION SELECT 'Sementes/Adubos'
  UNION SELECT 'Impostos/Taxas' UNION SELECT 'Outros'
) WHERE slug = 'fazenda';

INSERT OR IGNORE INTO categories (cost_center_id, name)
SELECT id, cat FROM cost_centers, (
  SELECT 'Material de Escritório' AS cat UNION SELECT 'Marketing' UNION SELECT 'Salários'
  UNION SELECT 'Impostos' UNION SELECT 'Serviços Contratados' UNION SELECT 'Combustível'
  UNION SELECT 'Manutenção' UNION SELECT 'Outros'
) WHERE slug = 'mgm';
