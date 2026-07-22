-- MadeWith… admin schema (Postgres). Ported from the D1/SQLite schema.

-- Public submissions awaiting moderation.
CREATE TABLE IF NOT EXISTS submissions (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL,                   -- target domain
  repo_url    TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  demo_url    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, slug);

-- Approved manual entries (a normalised Project JSON), merged into the domain feed.
CREATE TABLE IF NOT EXISTS approved_entries (
  slug       TEXT NOT NULL,
  github_id  BIGINT NOT NULL,
  data       TEXT NOT NULL,                    -- JSON Project
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, github_id)
);

-- Per-entry editorial overrides applied at publish time.
CREATE TABLE IF NOT EXISTS entry_overrides (
  slug        TEXT NOT NULL,
  github_id   BIGINT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  featured    BOOLEAN NOT NULL DEFAULT FALSE,
  name        TEXT,                            -- optional field overrides
  description TEXT,
  category    TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  PRIMARY KEY (slug, github_id)
);
