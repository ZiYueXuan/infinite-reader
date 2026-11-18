-- Users & auth
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  avatar_url    TEXT,
  google_sub    TEXT UNIQUE,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,          -- sha256(token) hex
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT,
  ip_hash      TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,              -- HMAC-SHA256(secret, email|code)
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX idx_login_codes_email ON login_codes(email, created_at DESC);

CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Books
CREATE TABLE books (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  author         TEXT,
  language       TEXT,
  description    TEXT,
  filename       TEXT,
  size_bytes     INTEGER NOT NULL,
  file_key       TEXT NOT NULL,
  cover_key      TEXT,
  status         TEXT NOT NULL DEFAULT 'uploaded', -- uploaded|parsing|indexing|ready|failed
  error          TEXT,
  chapter_count  INTEGER NOT NULL DEFAULT 0,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  indexed_chunks INTEGER NOT NULL DEFAULT 0,
  toc            TEXT,                              -- JSON
  progress       TEXT,                              -- JSON reading progress
  state          TEXT,                              -- JSON opaque client state (canvas, etc.)
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_books_user ON books(user_id, created_at DESC);

CREATE TABLE chunks (
  id            TEXT PRIMARY KEY,                   -- {bookId}:{ordinal}
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ordinal       INTEGER NOT NULL,
  chapter_index INTEGER NOT NULL,
  chapter_title TEXT,
  chapter_href  TEXT,
  char_start    INTEGER NOT NULL,
  char_end      INTEGER NOT NULL,
  text          TEXT NOT NULL,
  embedded      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chunks_book ON chunks(book_id, ordinal);

-- Marks
CREATE TABLE annotations (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                         -- highlight|underline
  color      TEXT NOT NULL,
  anchor     TEXT NOT NULL,                         -- JSON text-range anchor
  text       TEXT,                                  -- quoted text
  note_id    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_annotations_book ON annotations(book_id, user_id);

CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text          TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '#fff3a3',
  x             REAL NOT NULL DEFAULT 0,
  y             REAL NOT NULL DEFAULT 0,
  width         REAL,
  height        REAL,
  z             INTEGER NOT NULL DEFAULT 0,
  annotation_id TEXT,
  anchor        TEXT,                               -- optional JSON anchor
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_notes_book ON notes(book_id, user_id);

-- AI chat
CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id  TEXT NOT NULL DEFAULT 'default',
  role       TEXT NOT NULL,                         -- user|assistant
  content    TEXT NOT NULL,
  selection  TEXT,                                  -- JSON
  citations  TEXT,                                  -- JSON
  model      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_book ON chat_messages(book_id, user_id, thread_id, created_at);
