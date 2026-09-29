CREATE TABLE IF NOT EXISTS reimbursement_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  amount_vnd INTEGER NOT NULL CHECK(amount_vnd > 0),
  status TEXT NOT NULL CHECK(status IN ('sent','received','cancelled')),
  sent_by INTEGER NOT NULL,
  received_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_reimbursement_per_transaction
  ON reimbursement_requests(transaction_id) WHERE status='sent';

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
