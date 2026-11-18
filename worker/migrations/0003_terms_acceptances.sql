-- Explicit consent only: do not backfill existing users or sessions as having accepted.
CREATE TABLE terms_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('email', 'google'))
);
CREATE INDEX idx_terms_acceptances_user_version ON terms_acceptances(user_id, terms_version);
