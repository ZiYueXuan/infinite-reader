-- Atomic admission across Worker isolates. Completed maps never expire on model/prompt changes.
CREATE TABLE mindmaps (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  started_at INTEGER NOT NULL,
  result TEXT,
  PRIMARY KEY (user_id, book_id, target)
);
