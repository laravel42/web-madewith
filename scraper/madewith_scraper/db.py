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
    from dotenv import load_dotenv

    load_dotenv()
    return os.environ.get("SCRAPE_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""


def correlation_id(slug: str, shard: str) -> str:
    return f"{RUN_PREFIX}{slug}:{shard}"


def connect():
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    return psycopg.connect(url, row_factory=dict_row)


def reset_spawn_runs(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM github_search_runs WHERE correlation_id LIKE %s", (f"{RUN_PREFIX}%",))
    conn.commit()


def is_shard_done(conn, slug: str, shard: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status FROM github_search_runs WHERE correlation_id = %s",
            (correlation_id(slug, shard),),
        )
        row = cur.fetchone()
    return row and row["status"] == "completed"


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


def load_repos_for_slug(conn, slug: str) -> list[dict]:
    tech_slug = technology_slug(slug)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.metadata, r.stars
            FROM repositories r
            JOIN repository_technologies rt ON rt.repository_id = r.id
            JOIN technologies t ON t.id = rt.technology_id
            WHERE t.slug = %s
            ORDER BY r.stars DESC
            """,
            (tech_slug,),
        )
        rows = cur.fetchall()
        if not rows:
            cur.execute(
                """
                SELECT metadata, stars FROM repositories
                WHERE metadata->>'catalog_slug' = %s
                   OR (metadata::jsonb->'catalog_slugs') ? %s
                ORDER BY stars DESC
                """,
                (slug, slug),
            )
            rows = cur.fetchall()
    repos = []
    for row in rows:
        meta = row["metadata"]
        if isinstance(meta, str):
            meta = json.loads(meta)
        raw = meta.get("raw") if meta else None
        if raw:
            repos.append(raw)
    return repos


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
