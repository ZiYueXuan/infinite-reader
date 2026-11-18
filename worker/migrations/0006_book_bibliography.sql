-- Additive: source metadata is separate from user-editable display title/author.
ALTER TABLE books ADD COLUMN bibliography TEXT;
ALTER TABLE books ADD COLUMN bibliography_attempted_at INTEGER;
ALTER TABLE books ADD COLUMN bibliography_error TEXT;
