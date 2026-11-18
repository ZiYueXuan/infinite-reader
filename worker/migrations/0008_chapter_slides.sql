-- One immutable successful deck per owned chapter. Paid stages are claimed durably.
CREATE TABLE chapter_slides (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  total_parts INTEGER NOT NULL DEFAULT 0,
  completed_parts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  part_started_at INTEGER,
  error_code TEXT,
  PRIMARY KEY (book_id, user_id, target)
);
