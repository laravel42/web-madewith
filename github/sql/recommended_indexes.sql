-- Makes freshness checks and incremental processing cheaper at scale.
CREATE INDEX IF NOT EXISTS repositories_github_id_enriched_idx ON repositories(github_repository_id, enriched_at);
CREATE INDEX IF NOT EXISTS github_search_runs_technology_finished_idx ON github_search_runs(technology_id, finished_at DESC) WHERE status='completed';
CREATE INDEX IF NOT EXISTS repository_manifests_repo_fetched_idx ON repository_manifests(repository_id, fetched_at DESC);
