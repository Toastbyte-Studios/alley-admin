-- D1 schema for the Alley Admin waitlist registration Worker.
--
-- Apply to a database created with `wrangler d1 create`:
--   wrangler d1 execute alleyadmin-registrations-dev --local --file=./schema.sql
--   wrangler d1 execute alleyadmin-registrations-dev --remote --file=./schema.sql
--
-- The Worker inserts with `INSERT OR IGNORE`, so the UNIQUE constraint on
-- `email` is what makes repeat signups a silent no-op rather than an error.

CREATE TABLE IF NOT EXISTS registrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_registrations_created_at
  ON registrations (created_at);
