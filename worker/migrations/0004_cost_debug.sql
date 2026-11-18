-- Diagnostic counters only: no book text, prompts, images or SQL statements.
ALTER TABLE ai_usage ADD COLUMN input_characters INTEGER CHECK (input_characters >= 0);
CREATE TABLE cost_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  metrics TEXT NOT NULL
);
CREATE INDEX idx_cost_events_user_time ON cost_events(user_id, started_at DESC);
