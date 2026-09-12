"""Postgres persistence for madewith catalog schema."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .domains import technology_slug

RUN_PREFIX = "spawn:"
_tech_cache: dict[str, int | None] = {}


def database_url() -> str:
    import os
    from pathlib import Path

    from dotenv import load_dotenv

    # Prefer the repo-root .env (…/web-madewith/.env). Bare load_dotenv() only
    # looks at CWD, which is workers/projects when launched via the pipeline.
    root_env = Path(__file__).resolve().parents[3] / ".env"
    if root_env.exists():
        load_dotenv(root_env)
    load_dotenv()
    return os.environ.get("SCRAPE_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""


def correlation_id(slug: str, shard: str) -> str:
    return f"{RUN_PREFIX}{slug}:{shard}"


def connect():
    url = database_url()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required (set it in the repo-root .env, "
            "e.g. postgresql://USER:PASSWORD@127.0.0.1:5432/madewith)"
        )
    try:
        return psycopg.connect(url, row_factory=dict_row)
    except psycopg.OperationalError as exc:
        msg = str(exc)
        if "no password supplied" in msg or "password authentication failed" in msg:
            raise RuntimeError(
                "Postgres rejected the connection: DATABASE_URL is missing a password "
                "(or the password is wrong). Update the repo-root .env, e.g. "
                "DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/madewith"
            ) from exc
        raise


def reset_spawn_runs(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM github_search_runs WHERE correlation_id LIKE %s", (f"{RUN_PREFIX}%",))
    conn.commit()


def is_shard_done(conn, slug: str, shard: str, refresh_days: int = 0) -> bool:
    """True when this shard should be skipped.

    `refresh_days`:
      - 0 → completed shards stay done forever (until `clean=1`)
      - N → re-queue when the completed run is older than N days so default-branch
        tip dates (`pushed_at`) stay aligned with GitHub
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, finished_at FROM github_search_runs WHERE correlation_id = %s",
            (correlation_id(slug, shard),),
        )
        row = cur.fetchone()
    if not row or row["status"] != "completed":
        return False
    if refresh_days <= 0:
        return True
    finished = row.get("finished_at")
    if not finished:
        return False
    if finished.tzinfo is None:
        finished = finished.replace(tzinfo=timezone.utc)
    from datetime import timedelta

    return (datetime.now(timezone.utc) - finished) < timedelta(days=refresh_days)


def get_technology_id(conn, catalog_slug: str) -> int | None:
    tech_slug = technology_slug(catalog_slug)
    if tech_slug in _tech_cache:
        return _tech_cache[tech_slug]
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM technologies WHERE slug = %s LIMIT 1", (tech_slug,))
        row = cur.fetchone()
    tid = row["id"] if row else None
    _tech_cache[tech_slug] = tid
    return tid


def mark_shard_running(conn, slug: str, shard: str) -> None:
    cid = correlation_id(slug, shard)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM github_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE github_search_runs
                SET status = 'running', started_at = %s, finished_at = NULL, error = NULL, updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO github_search_runs (
                  technology_id, correlation_id, status, query, partition,
                  result_count, started_at, created_at, updated_at
                ) VALUES (%s, %s, 'running', '', %s, 0, %s, NOW(), NOW())
                """,
                (tech_id, cid, json.dumps({"shard_id": shard}), now),
            )
    conn.commit()


def mark_shard_completed(conn, slug: str, shard: str, query: str, total: int, repo_count: int) -> None:
    cid = correlation_id(slug, shard)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    partition = json.dumps({"shard_id": shard, "total": total})
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM github_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE github_search_runs SET
                  technology_id = COALESCE(%s, technology_id),
                  status = 'completed',
                  query = %s,
                  partition = %s,
                  result_count = %s,
                  finished_at = %s,
                  error = NULL,
                  updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (tech_id, query, partition, repo_count, now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO github_search_runs (
                  technology_id, correlation_id, status, query, partition,
                  result_count, started_at, finished_at, created_at, updated_at
                ) VALUES (%s, %s, 'completed', %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                (tech_id, cid, query, partition, repo_count, now, now),
            )
    conn.commit()


def mark_shard_failed(conn, slug: str, shard: str, error: str) -> None:
    cid = correlation_id(slug, shard)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    err = json.dumps({"message": str(error)[:500]})
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM github_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE github_search_runs
                SET status = 'failed', error = %s::json, finished_at = %s, updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (err, now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO github_search_runs (
                  technology_id, correlation_id, status, partition, error,
                  finished_at, created_at, updated_at
                ) VALUES (%s, %s, 'failed', %s, %s::json, %s, NOW(), NOW())
                """,
                (tech_id, cid, json.dumps({"shard_id": shard}), err, now),
            )
    conn.commit()


def _synthetic_github_id(full_name: str) -> int:
    key = full_name.lower()
    h = 0
    for ch in key:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    h = h if h < 2**31 else h - 2**32
    return h if h <= 0 else -h


# ---------- refactored upsert helpers ----------------------------------------

# Columns on `repositories` whose values the scraper owns on insert; everything
# else (commit_count, latest_release_*, open_issues, etag, screenshot_*, ...) is
# left NULL and gets filled by the downstream enrich/classify/score/homepage
# workers. We DO refresh the columns listed in _REFRESHABLE_COLUMNS on every
# upsert because they come straight from the search result.
_REFRESHABLE_COLUMNS = (
    "github_repository_id",
    "name",
    "full_name",
    "description",
    "repository_url",
    "homepage_url",
    "owner_login",
    "owner_avatar_url",
    "stars",
    "fork",
    "archived",
    "primary_language",
    "license_spdx",
    "pushed_at",
    "github_updated_at",
)


def _owner_login(repo: dict) -> str | None:
    owner = repo.get("owner") or {}
    if isinstance(owner, dict):
        return owner.get("login")
    return repo.get("owner_login")


def _owner_avatar(repo: dict) -> str | None:
    owner = repo.get("owner") or {}
    if isinstance(owner, dict):
        return owner.get("avatar_url")
    return repo.get("owner_avatar_url")


def _spdx(repo: dict) -> str | None:
    lic = repo.get("license")
    if isinstance(lic, dict):
        spdx = lic.get("spdx_id") or lic.get("spdxId")
    else:
        spdx = lic
    if not spdx or spdx in ("—", "-", "NOASSERTION"):
        return None
    return spdx


def _github_id(repo: dict) -> int:
    raw = repo.get("databaseId") or repo.get("github_repository_id")
    if raw is not None:
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
    return _synthetic_github_id(repo.get("full_name") or repo.get("name") or "unknown")


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _build_repo_metadata(catalog_slug: str, repo: dict, existing_meta: dict | None = None) -> dict:
    """Build the metadata JSON blob stored in repositories.metadata.

    Shape contract (preserved for load_repos_for_slug): top-level keys
    `catalog_slug`, `catalog_slugs`, `source`, `synthetic_github_id`, `raw`.
    Plus a `last_upserted_at` marker and provenance for the new fields we set.
    """
    meta = dict(existing_meta or {})
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    slugs: set[str] = set(meta.get("catalog_slugs") or [])
    if meta.get("catalog_slug"):
        slugs.add(meta["catalog_slug"])
    slugs.add(catalog_slug)
    meta.update({
        "catalog_slug": catalog_slug,
        "catalog_slugs": sorted(slugs),
        "source": repo.get("_import_source") or meta.get("source") or "scrapy-github",
        "synthetic_github_id": not (repo.get("databaseId") or repo.get("github_repository_id")),
        "raw": repo,
        "last_upserted_at": datetime.now(timezone.utc).isoformat(),
    })
    return meta


def _replace_topics(cur, repo_id: int, topics: list[str]) -> None:
    cur.execute("DELETE FROM repository_topics WHERE repository_id = %s", (repo_id,))
    for t in topics:
        if not t:
            continue
        cur.execute(
            """
            INSERT INTO repository_topics (repository_id, topic, created_at, updated_at)
            VALUES (%s, %s, NOW(), NOW())
            ON CONFLICT (repository_id, topic) DO UPDATE SET updated_at = NOW()
            """,
            (repo_id, t),
        )


def _replace_languages(cur, repo_id: int, langs: list[dict] | None, primary: str | None) -> None:
    cur.execute("DELETE FROM repository_languages WHERE repository_id = %s", (repo_id,))
    if not langs:
        if primary:
            cur.execute(
                """
                INSERT INTO repository_languages (repository_id, language, bytes, percentage, created_at, updated_at)
                VALUES (%s, %s, 0, 0, NOW(), NOW())
                ON CONFLICT (repository_id, language) DO UPDATE SET updated_at = NOW()
                """,
                (repo_id, primary),
            )
        return
    lang_list: list[dict] = langs
    total_bytes = sum(int(l.get("size") or l.get("bytes") or 0) for l in lang_list) or 0
    for lang in lang_list:
        name = lang.get("name")
        if not name:
            continue
        size = int(lang.get("size") or lang.get("bytes") or 0)
        pct = (size / total_bytes * 100.0) if total_bytes else float(lang.get("pct") or 0)
        cur.execute(
            """
            INSERT INTO repository_languages (repository_id, language, bytes, percentage, created_at, updated_at)
            VALUES (%s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (repository_id, language) DO UPDATE
              SET bytes = EXCLUDED.bytes,
                  percentage = EXCLUDED.percentage,
                  updated_at = NOW()
            """,
            (repo_id, name, size, pct),
        )


def _write_metrics_snapshot(cur, repo_id: int, repo: dict) -> None:
    """One row in repository_metrics per (repository, captured_at).

    Captured_at is bucketed at the second. For repeated upserts in the same
    second the row is updated in place to avoid violating the unique
    constraint on (repository_id, captured_at).
    """
    now = datetime.now(timezone.utc).replace(microsecond=0)
    source_payload = json.dumps({
        "stars": repo.get("stargazers_count"),
        "forks": repo.get("forks_count"),
        "watchers": repo.get("watchers_count") or repo.get("subscribers_count"),
        "open_issues": repo.get("open_issues"),
        "open_pull_requests": repo.get("open_pull_requests"),
    }, default=str)
    cur.execute(
        """
        INSERT INTO repository_metrics (
          repository_id, captured_at, stars, forks, watchers, open_issues,
          open_pull_requests, source_payload, created_at, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::json, NOW(), NOW())
        ON CONFLICT (repository_id, captured_at) DO UPDATE
          SET stars = EXCLUDED.stars,
              forks = EXCLUDED.forks,
              watchers = EXCLUDED.watchers,
              open_issues = EXCLUDED.open_issues,
              open_pull_requests = EXCLUDED.open_pull_requests,
              source_payload = EXCLUDED.source_payload,
              updated_at = NOW()
        """,
        (
            repo_id,
            now,
            int(repo.get("stargazers_count") or 0),
            int(repo.get("forks_count") or 0),
            int(repo.get("watchers_count") or repo.get("subscribers_count") or 0),
            int(repo.get("open_issues") or 0),
            int(repo.get("open_pull_requests") or 0),
            source_payload,
        ),
    )


def _write_star_snapshot(cur, repo_id: int, stars: int) -> None:
    cur.execute(
        """
        INSERT INTO repository_star_snapshots (repository_id, snapshot_date, stars, created_at)
        VALUES (%s, CURRENT_DATE, %s, NOW())
        ON CONFLICT (repository_id, snapshot_date)
          DO UPDATE SET stars = EXCLUDED.stars, created_at = NOW()
        """,
        (repo_id, int(stars or 0)),
    )


def _link_technology(cur, repo_id: int, tech_id: int, status: str = "discovered", confidence: float = 0.5) -> None:
    cur.execute(
        """
        INSERT INTO repository_technologies (
          repository_id, technology_id, confidence, status, evidence,
          created_at, updated_at
        ) VALUES (%s, %s, %s, %s, '[]'::json, NOW(), NOW())
        ON CONFLICT (repository_id, technology_id) DO UPDATE
          SET confidence = EXCLUDED.confidence,
              status = EXCLUDED.status,
              updated_at = NOW()
        """,
        (repo_id, tech_id, confidence, status),
    )


def _insert_repository_row(cur, gh_id: int, catalog_slug: str, repo: dict, now: datetime) -> int:
    full_name = repo.get("full_name") or repo.get("nameWithOwner") or repo.get("name")
    name = repo.get("name") or (full_name.split("/")[-1] if full_name and "/" in full_name else full_name)
    metadata = _build_repo_metadata(catalog_slug, repo)
    cur.execute(
        """
        INSERT INTO repositories (
          github_repository_id, name, full_name, description, repository_url, homepage_url,
          owner_login, owner_avatar_url, stars, fork, archived, primary_language, license_spdx,
          pushed_at, status, discovered_at, metadata, created_at, updated_at
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'discovered',%s,%s::json,%s,%s
        ) RETURNING id
        """,
        (
            gh_id,
            name,
            full_name,
            repo.get("description"),
            repo.get("html_url") or repo.get("url"),
            repo.get("homepage") or repo.get("homepageUrl"),
            _owner_login(repo),
            _owner_avatar(repo),
            int(repo.get("stargazers_count") or 0),
            bool(repo.get("fork") or repo.get("isFork")),
            bool(repo.get("archived") or repo.get("isArchived")),
            repo.get("language") or repo.get("primary_language") or (repo.get("primaryLanguage") or {}).get("name"),
            _spdx(repo),
            _parse_dt(repo.get("pushed_at") or repo.get("pushedAt")),
            now,
            json.dumps(metadata),
            now,
            now,
        ),
    )
    return cur.fetchone()["id"]


def _update_repository_row(cur, repo_id: int, gh_id: int, catalog_slug: str, repo: dict, prev_meta: dict | None) -> None:
    metadata = _build_repo_metadata(catalog_slug, repo, prev_meta)
    next_gh = (
        gh_id
        if (repo.get("databaseId") or repo.get("github_repository_id"))
        and (prev_meta or {}).get("synthetic_github_id")
        else None  # keep existing on re-runs to avoid bouncing real -> synthetic
    )
    cur.execute(
        f"""
        UPDATE repositories SET
          {"github_repository_id = %s," if next_gh is not None else ""}
          name = %s,
          full_name = COALESCE(%s, full_name),
          description = %s,
          repository_url = %s,
          homepage_url = %s,
          owner_login = %s,
          owner_avatar_url = %s,
          stars = %s,
          fork = %s,
          archived = %s,
          primary_language = %s,
          license_spdx = %s,
          pushed_at = COALESCE(%s, pushed_at),
          github_updated_at = COALESCE(%s, github_updated_at),
          metadata = (COALESCE(metadata::jsonb, '{{}}'::jsonb) || %s::jsonb)::json,
          updated_at = NOW()
        WHERE id = %s
        """,
        (
            *((next_gh,) if next_gh is not None else ()),
            repo.get("name") or (repo.get("full_name", "").split("/")[-1] if repo.get("full_name") else None),
            repo.get("full_name") or repo.get("nameWithOwner"),
            repo.get("description"),
            repo.get("html_url") or repo.get("url"),
            repo.get("homepage") or repo.get("homepageUrl"),
            _owner_login(repo),
            _owner_avatar(repo),
            int(repo.get("stargazers_count") or 0),
            bool(repo.get("fork") or repo.get("isFork")),
            bool(repo.get("archived") or repo.get("isArchived")),
            repo.get("language") or repo.get("primary_language") or (repo.get("primaryLanguage") or {}).get("name"),
            _spdx(repo),
            _parse_dt(repo.get("pushed_at") or repo.get("pushedAt")),
            _parse_dt(repo.get("updated_at") or repo.get("updatedAt")),
            json.dumps(metadata),
            repo_id,
        ),
    )


def upsert_repository(conn, catalog_slug: str, repo: dict[str, Any]) -> str:
    """Upsert by lower(full_name). Writes the full repositories row, child tables
    (topics, languages, technologies, metrics, star_snapshot) in one transaction.

    Returns 'inserted', 'updated', or 'skipped'. Skips when the catalog_slug has
    no matching technologies row (linker target missing — caller should ensure
    the technology exists before bulk-loading).
    """
    full_name = repo.get("full_name") or repo.get("nameWithOwner") or repo.get("name")
    if not full_name:
        return "skipped"

    tech_id = get_technology_id(conn, catalog_slug)
    if tech_id is None:
        # don't orphan: refuse to insert repos that can't be linked to a tech
        return "skipped"

    gh_id = _github_id(repo)
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, metadata FROM repositories WHERE lower(full_name) = lower(%s)",
            (full_name,),
        )
        existing = cur.fetchone()

        if existing is None and gh_id > 0:
            # Renamed/transferred repos keep their GitHub id but change
            # full_name; without this match the INSERT below violates the
            # unique index on github_repository_id. Synthetic ids (<= 0) are
            # hash-derived from full_name and must not match other rows.
            cur.execute(
                "SELECT id, metadata FROM repositories WHERE github_repository_id = %s",
                (gh_id,),
            )
            existing = cur.fetchone()

        if existing:
            repo_id = existing["id"]
            prev_meta = existing["metadata"]
            if isinstance(prev_meta, str):
                prev_meta = json.loads(prev_meta)
            _update_repository_row(cur, repo_id, gh_id, catalog_slug, repo, prev_meta)
            action = "updated"
        else:
            repo_id = _insert_repository_row(cur, gh_id, catalog_slug, repo, now)
            action = "inserted"

        # Always refresh these child tables — search API gives us the source of truth
        topics = repo.get("topics") or [
            t.get("name") if isinstance(t, dict) else t
            for t in (repo.get("repositoryTopics") or {}).get("nodes", [])
        ]
        _replace_topics(cur, repo_id, [t for t in topics if t])

        langs = repo.get("_langs") or [
            {"name": e["node"]["name"], "size": e.get("size") or 0}
            for e in (repo.get("languages") or {}).get("edges", [])
        ]
        primary_lang = (
            repo.get("language")
            or repo.get("primary_language")
            or (repo.get("primaryLanguage") or {}).get("name")
        )
        _replace_languages(cur, repo_id, langs, primary_lang)

        _write_metrics_snapshot(cur, repo_id, repo)
        _write_star_snapshot(cur, repo_id, int(repo.get("stargazers_count") or 0))
        _link_technology(cur, repo_id, tech_id)

    conn.commit()
    return action


def ensure_technology(
    conn,
    catalog_slug: str,
    name: str | None = None,
    *,
    min_stars: int = 50,
    include_forks: bool = False,
    include_archived: bool = False,
    search_topics: list[str] | None = None,
    search_keywords: list[str] | None = None,
) -> int:
    """Idempotently create a technologies row for a catalog slug.

    Uses technology_slug() to map catalog -> technology slug. Returns the
    technologies.id. If the row already exists, returns its id without
    touching other fields.
    """
    tech_slug = technology_slug(catalog_slug)
    table_name = f"technologies"
    seq_name = f"{table_name}_id_seq"
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM technologies WHERE slug = %s LIMIT 1", (tech_slug,))
        row = cur.fetchone()
        if row:
            return row["id"]
        # Repair the sequence if it's drifted (e.g. from a partial restore,
        # or because pg_get_serial_sequence returns NULL for plain-default id
        # columns). We address the sequence by name rather than via the
        # pg_get_serial_sequence helper, which can be unreliable.
        cur.execute(
            f"SELECT setval(%s, GREATEST(COALESCE((SELECT MAX(id) FROM {table_name}), 0), 1), true)",
            (seq_name,),
        )
        cur.execute(
            """
            INSERT INTO technologies (
              slug, name, enabled, minimum_stars, include_forks, include_archived,
              search_topics, search_keywords, excluded_keywords,
              allowed_project_types, homepage_optional, quality_threshold,
              metadata, created_at, updated_at
            ) VALUES (
              %s, %s, true, %s, %s, %s,
              %s::json, %s::json, '[]'::json,
              '["application","website","starter","template","library","plugin","developer-tool"]'::json,
              true, 65,
              '{}'::json, NOW(), NOW()
            ) RETURNING id
            """,
            (
                tech_slug,
                name or catalog_slug.replace("-", " ").title(),
                min_stars,
                include_forks,
                include_archived,
                json.dumps(search_topics or [catalog_slug]),
                json.dumps(search_keywords or []),
            ),
        )
        tid = cur.fetchone()["id"]
    conn.commit()
    # bust the cache so get_technology_id sees the new row
    _tech_cache.pop(tech_slug, None)
    return tid



def repo_counts_by_slug(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.slug, COUNT(DISTINCT r.id)::int AS n
            FROM technologies t
            JOIN repository_technologies rt ON rt.technology_id = t.id
            JOIN repositories r ON r.id = rt.repository_id
            GROUP BY t.slug
            """
        )
        rows = cur.fetchall()
    counts = {row["slug"]: row["n"] for row in rows}
    # catalog slugs like "next" map to tech slug "nextjs"
    from .domains import load_domains, technology_slug

    by_catalog: dict[str, int] = {}
    for domain in load_domains():
        slug = domain["slug"]
        by_catalog[slug] = counts.get(technology_slug(slug), 0)
    return by_catalog


# Columns needed to rebuild a GitHub-API-shaped dict for publishing when the
# repository was ingested by the madewith_github package (which stores fields as
# columns rather than under metadata.raw). Topics and languages are aggregated
# from their child tables.
_PUBLISH_COLUMNS = """
    r.metadata, r.name, r.full_name, r.description, r.stars, r.owner_login, r.owner_avatar_url,
    r.homepage_url, r.repository_url, r.license_spdx, r.pushed_at, r.primary_language, r.fork, r.archived,
    COALESCE((SELECT array_agg(tp.topic) FROM repository_topics tp WHERE tp.repository_id = r.id), '{}') AS topics,
    COALESCE((SELECT json_agg(json_build_object('name', l.language, 'pct', l.percentage, 'size', l.bytes)
              ORDER BY l.bytes DESC NULLS LAST) FROM repository_languages l WHERE l.repository_id = r.id), '[]') AS langs,
    -- Forks and open issues are captured at scrape time but used to stop here;
    -- the detail hero renders them beside the star count. Each column takes its
    -- most recent NON-ZERO snapshot: not every scrape path fills these in, and
    -- the zero it writes would otherwise erase a count we already had.
    json_build_object(
      'forks', (SELECT m.forks FROM repository_metrics m
                 WHERE m.repository_id = r.id AND m.forks > 0
                 ORDER BY m.captured_at DESC LIMIT 1),
      'issues', (SELECT m.open_issues FROM repository_metrics m
                  WHERE m.repository_id = r.id AND m.open_issues > 0
                  ORDER BY m.captured_at DESC LIMIT 1),
      'watchers', (SELECT m.watchers FROM repository_metrics m
                    WHERE m.repository_id = r.id AND m.watchers > 0
                    ORDER BY m.captured_at DESC LIMIT 1)
    ) AS metrics
"""


def _row_to_raw(row: dict) -> dict | None:
    """Return the legacy full GitHub payload (metadata.raw) if present, else
    synthesise the same shape from the repository columns + topics/languages.

    `repositories.pushed_at` is always overlaid onto the payload: it stores the
    default-branch tip commit date (not GitHub's any-branch `pushedAt`).
    """
    meta = row.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = None
    raw: dict | None = None
    if meta and meta.get("raw"):
        raw = dict(meta["raw"])
    elif row.get("full_name"):
        raw = {
            "name": row.get("name"),
            "full_name": row.get("full_name"),
            "description": row.get("description"),
            "stargazers_count": row.get("stars") or 0,
            "owner": {"login": row.get("owner_login"), "avatar_url": row.get("owner_avatar_url")},
            "owner_login": row.get("owner_login"),
            "language": row.get("primary_language"),
            "primary_language": row.get("primary_language"),
            "topics": list(row.get("topics") or []),
            "license": {"spdx_id": row["license_spdx"]} if row.get("license_spdx") else None,
            "homepage": row.get("homepage_url"),
            "html_url": row.get("repository_url"),
            "fork": bool(row.get("fork")),
            "archived": bool(row.get("archived")),
            "_langs": list(row.get("langs") or []),
        }
    else:
        return None
    pushed = row.get("pushed_at")
    if pushed is not None:
        raw["pushed_at"] = pushed.isoformat() if hasattr(pushed, "isoformat") else pushed
    # repository_languages is the canonical language breakdown and the only
    # source that carries percentages. A legacy `raw._langs` payload holds just
    # name+size, so a repo re-scraped through that path published languages with
    # no pct — the detail page then rendered a bare "%" and a zero-width bar.
    row_langs = row.get("langs")
    if isinstance(row_langs, str):
        try:
            row_langs = json.loads(row_langs)
        except json.JSONDecodeError:
            row_langs = None
    if row_langs:
        raw["_langs"] = row_langs
    # The discovery worker's LLM-written description lives beside `raw` in
    # metadata (so a re-scrape overwriting `raw` can't wipe it). Surface it
    # into the payload normalise() sees, which prefers it over the templated
    # long1/long2.
    if meta and meta.get("generated_description"):
        raw["_generated_description"] = meta["generated_description"]
    if meta and meta.get("generated_abstract"):
        raw["_generated_abstract"] = meta["generated_abstract"]
    # Latest repository_metrics snapshot (see _PUBLISH_COLUMNS). Only fills gaps:
    # a legacy `raw` payload that already carries the counts keeps its own.
    metrics = row.get("metrics")
    if isinstance(metrics, str):
        try:
            metrics = json.loads(metrics)
        except json.JSONDecodeError:
            metrics = None
    if isinstance(metrics, dict):
        if not raw.get("forks_count") and (metrics.get("forks") or 0) > 0:
            raw["forks_count"] = int(metrics["forks"])
        if not raw.get("open_issues") and (metrics.get("issues") or 0) > 0:
            raw["open_issues"] = int(metrics["issues"])
        # Real subscriber count. NOT GitHub REST's `watchers_count`, which is an
        # alias for stars — the scrape stores subscribers_count in this column.
        if not raw.get("subscribers_count") and (metrics.get("watchers") or 0) > 0:
            raw["subscribers_count"] = int(metrics["watchers"])
    return raw


def load_repos_for_slug(conn, slug: str) -> list[dict]:
    tech_slug = technology_slug(slug)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT {_PUBLISH_COLUMNS}
            FROM repositories r
            JOIN repository_technologies rt ON rt.repository_id = r.id
            JOIN technologies t ON t.id = rt.technology_id
            WHERE t.slug = %s
            ORDER BY r.stars DESC NULLS LAST
            """,
            (tech_slug,),
        )
        rows = cur.fetchall()
        if not rows:
            cur.execute(
                f"""
                SELECT {_PUBLISH_COLUMNS} FROM repositories r
                WHERE r.metadata->>'catalog_slug' = %s
                   OR (r.metadata::jsonb->'catalog_slugs') ? %s
                ORDER BY r.stars DESC NULLS LAST
                """,
                (slug, slug),
            )
            rows = cur.fetchall()
    return [raw for row in rows if (raw := _row_to_raw(row))]


def record_publish(conn, slug: str, count: int, ecosystem: int) -> None:
    tech_id = get_technology_id(conn, slug)
    if not tech_id:
        return
    scrape_meta = {
        "ecosystem_total": ecosystem,
        "last_published_at": datetime.now(timezone.utc).isoformat(),
        "last_published_count": count,
    }
    with conn.cursor() as cur:
        cur.execute("SELECT metadata FROM technologies WHERE id = %s", (tech_id,))
        row = cur.fetchone()
        meta = row["metadata"] if row else {}
        if isinstance(meta, str):
            meta = json.loads(meta)
        meta = dict(meta or {})
        meta["scrape"] = scrape_meta
        cur.execute(
            "UPDATE technologies SET metadata = %s, updated_at = NOW() WHERE id = %s",
            (json.dumps(meta), tech_id),
        )
    conn.commit()
