-- YouTube tech video catalog (run once against madewith Postgres)
CREATE TABLE IF NOT EXISTS youtube_videos (
  id BIGSERIAL PRIMARY KEY,
  youtube_video_id VARCHAR(11) NOT NULL UNIQUE,
  technology_id BIGINT REFERENCES technologies(id),
  catalog_slug VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  channel_id VARCHAR(64) NOT NULL,
  channel_title TEXT NOT NULL,
  channel_subscriber_count BIGINT DEFAULT 0,
  published_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  view_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  default_language VARCHAR(16),
  definition VARCHAR(8),
  thumbnail_url TEXT,
  video_url TEXT NOT NULL,
  quality_score NUMERIC(6, 2) DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_videos_catalog_slug ON youtube_videos(catalog_slug);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_technology_id ON youtube_videos(technology_id);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_quality_score ON youtube_videos(catalog_slug, quality_score DESC);

CREATE TABLE IF NOT EXISTS youtube_search_runs (
  id BIGSERIAL PRIMARY KEY,
  technology_id BIGINT REFERENCES technologies(id),
  catalog_slug VARCHAR(64) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  query TEXT NOT NULL DEFAULT '',
  candidate_count INTEGER DEFAULT 0,
  accepted_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_search_runs_slug ON youtube_search_runs(catalog_slug);
