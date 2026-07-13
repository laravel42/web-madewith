-- Newsletter subscribers (Cloudflare D1 / SQLite).

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'network',
  slug            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL,
  unsubscribed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_unique
  ON newsletter_subscribers (email, scope, slug);

CREATE INDEX IF NOT EXISTS idx_newsletter_status
  ON newsletter_subscribers (status, scope, slug);
