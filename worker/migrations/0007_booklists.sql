-- One saved extraction per owned book. Completed parts live in private R2 storage.
-- Attempt IDs fence queued messages from an earlier, explicitly retried attempt.
CREATE TABLE booklists (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  total_parts INTEGER NOT NULL DEFAULT 0,
  completed_parts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  part_started_at INTEGER,
  error_code TEXT
);
