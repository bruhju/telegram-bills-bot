/**
 * DDL de runtime, idempotente (CREATE ... IF NOT EXISTS) — roda no cold start
 * sobre o D1 (no dev, via shim better-sqlite3 de devD1.ts).
 *
 * Sem PRAGMA de propósito: o D1 rejeita a maioria (o WAL do dev é ligado pelo
 * próprio shim). A tabela `sync_state` do espelho GitHub foi removida junto
 * com src/db/remoteSync.ts — o D1 é durável, não há mais sync de arquivo.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS recurring_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  amount REAL,
  emoji TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,

  `CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL,
  due_date TEXT,
  month_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  emoji TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  recurring_bill_id INTEGER REFERENCES recurring_bills(id) ON DELETE SET NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recurring_bill_id, month_ref)
)`,

  `CREATE INDEX IF NOT EXISTS idx_bills_month_ref ON bills(month_ref)`,

  `CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date)`,

  `CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('photo','document')),
  local_path TEXT NOT NULL,
  matched INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,

  `CREATE INDEX IF NOT EXISTS idx_receipts_bill_id ON receipts(bill_id)`,

  `CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('monthly_list','due_tomorrow','due_today','overdue')),
  reference_date TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bill_id, reminder_type, reference_date)
)`,

  `CREATE TABLE IF NOT EXISTS wizard_state (
  chat_id INTEGER PRIMARY KEY,
  flow_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`,
];
