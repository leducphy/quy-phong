CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  member TEXT NOT NULL UNIQUE CHECK(member IN ('Phi','An')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_on TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('contribution','expense')),
  amount_vnd INTEGER NOT NULL CHECK(amount_vnd > 0),
  description TEXT NOT NULL,
  member TEXT CHECK(member IN ('Phi','An')),
  category TEXT,
  paid_by TEXT CHECK(paid_by IN ('Phi','An')),
  reimbursed_vnd INTEGER NOT NULL DEFAULT 0 CHECK(reimbursed_vnd >= 0 AND reimbursed_vnd <= amount_vnd),
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed')),
  note TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  created_by INTEGER,
  confirmed_by INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_update_id INTEGER UNIQUE,
  UNIQUE(source_sheet,source_row)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  action TEXT NOT NULL CHECK(action IN ('edit','delete')),
  field TEXT,
  proposed_value TEXT,
  requested_by INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_change_per_transaction
  ON change_requests(transaction_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_member TEXT NOT NULL CHECK(recipient_member IN ('Phi','An')),
  event TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
