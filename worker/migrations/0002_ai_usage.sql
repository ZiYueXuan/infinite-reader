-- One row per provider attempt, including retries and fallbacks. Unknown usage is NULL, never zero.
CREATE TABLE ai_usage (
  id                    TEXT PRIMARY KEY,
  operation_id          TEXT NOT NULL,
  user_id               TEXT REFERENCES users(id) ON DELETE SET NULL,
  book_id               TEXT REFERENCES books(id) ON DELETE SET NULL,
  feature               TEXT NOT NULL,
  provider              TEXT NOT NULL,
  requested_model       TEXT NOT NULL,
  response_model        TEXT,
  provider_request_id   TEXT,
  status                TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'succeeded', 'failed', 'aborted')),
  usage_status          TEXT NOT NULL DEFAULT 'pending' CHECK (usage_status IN ('pending', 'reported', 'partial', 'unavailable')),
  input_tokens          INTEGER CHECK (input_tokens >= 0),
  output_tokens         INTEGER CHECK (output_tokens >= 0),
  total_tokens          INTEGER CHECK (total_tokens >= 0),
  cached_input_tokens   INTEGER CHECK (cached_input_tokens >= 0),
  uncached_input_tokens INTEGER CHECK (uncached_input_tokens >= 0),
  reasoning_tokens      INTEGER CHECK (reasoning_tokens >= 0),
  raw_usage             TEXT,
  finish_reason         TEXT,
  http_status           INTEGER,
  error_code            TEXT,
  started_at            INTEGER NOT NULL,
  finished_at           INTEGER,
  duration_ms           INTEGER
);
CREATE INDEX idx_ai_usage_user_time ON ai_usage(user_id, started_at DESC);
CREATE INDEX idx_ai_usage_operation ON ai_usage(operation_id);
CREATE INDEX idx_ai_usage_time ON ai_usage(started_at DESC);
