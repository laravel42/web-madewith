-- Per-domain page editorial settings (hero copy, URLs, meta, visible categories).
CREATE TABLE IF NOT EXISTS domain_settings (
  slug        TEXT PRIMARY KEY,
  data        TEXT NOT NULL,                   -- JSON DomainSettingsPayload
  updated_at  TEXT,
  updated_by  TEXT
);
