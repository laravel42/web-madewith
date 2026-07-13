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


def _build_repo_metadata(catalog_slug: str, repo: dict[str, Any], existing_meta: dict | None = None) -> str:
    meta = dict(existing_meta or {})
    if isinstance(meta, str):
        meta = json.loads(meta)
    slugs = set(meta.get("catalog_slugs") or [])
    if meta.get("catalog_slug"):
        slugs.add(meta["catalog_slug"])
    slugs.add(catalog_slug)
    meta.update({
        "catalog_slug": catalog_slug,
        "catalog_slugs": sorted(slugs),
        "source": repo.get("_import_source") or meta.get("source") or "scrapy-github",
        "synthetic_github_id": not repo.get("databaseId"),
        "raw": repo,
    })
    return json.dumps(meta)


def upsert_repository(conn, catalog_slug: str, repo: dict[str, Any]) -> str:
    """Upsert by full_name. Returns 'inserted', 'updated', or 'skipped'."""
    tech_id = get_technology_id(conn, catalog_slug)
    full_name = repo.get("full_name") or repo.get("name")
    if not full_name:
        return "skipped"

    gh_id = repo.get("databaseId") or _synthetic_github_id(full_name)
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, github_repository_id, metadata FROM repositories WHERE lower(full_name) = lower(%s)",
            (full_name,),
        )
        existing = cur.fetchone()

        if existing:
            repo_id = existing["id"]
            prev_meta = existing["metadata"]
            if isinstance(prev_meta, str):
                prev_meta = json.loads(prev_meta)
            metadata = _build_repo_metadata(catalog_slug, repo, prev_meta)
            next_gh = gh_id if repo.get("databaseId") and existing["github_repository_id"] < 0 else existing["github_repository_id"]
            cur.execute(
                """
                UPDATE repositories SET
                  github_repository_id = %s, name = %s, description = %s, repository_url = %s,
                  homepage_url = %s, owner_login = %s, owner_avatar_url = %s, stars = %s,
                  fork = %s, archived = %s, primary_language = %s, license_spdx = %s,
                  pushed_at = %s,
                  metadata = (COALESCE(metadata::jsonb, '{}'::jsonb) || %s::jsonb)::json,
                  updated_at = %s
                WHERE id = %s
                """,
                (
                    next_gh,
                    repo.get("name"),
                    repo.get("description"),
                    repo.get("html_url"),
                    repo.get("homepage"),
                    (repo.get("owner") or {}).get("login"),
                    (repo.get("owner") or {}).get("avatar_url"),
                    repo.get("stargazers_count") or 0,
                    bool(repo.get("fork")),
                    bool(repo.get("archived")),
                    repo.get("language"),
                    (repo.get("license") or {}).get("spdx_id"),
                    repo.get("pushed_at"),
                    metadata,
                    now,
                    repo_id,
                ),
            )
            action = "updated"
        else:
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
                    repo.get("name"),
                    full_name,
                    repo.get("description"),
                    repo.get("html_url"),
                    repo.get("homepage"),
                    (repo.get("owner") or {}).get("login"),
                    (repo.get("owner") or {}).get("avatar_url"),
                    repo.get("stargazers_count") or 0,
                    bool(repo.get("fork")),
                    bool(repo.get("archived")),
                    repo.get("language"),
                    (repo.get("license") or {}).get("spdx_id"),
                    repo.get("pushed_at"),
                    now,
                    metadata,
                    now,
                    now,
                ),
            )
            repo_id = cur.fetchone()["id"]
            action = "inserted"

        cur.execute("DELETE FROM repository_topics WHERE repository_id = %s", (repo_id,))
        for topic in repo.get("topics") or []:
            cur.execute(
                """
                INSERT INTO repository_topics (repository_id, topic, created_at, updated_at)
                VALUES (%s, %s, NOW(), NOW()) ON CONFLICT DO NOTHING
                """,
                (repo_id, topic),
            )

        cur.execute("DELETE FROM repository_languages WHERE repository_id = %s", (repo_id,))
        for lang in repo.get("_langs") or []:
            if not lang.get("name"):
                continue
            cur.execute(
                """
                INSERT INTO repository_languages (repository_id, language, bytes, percentage, created_at, updated_at)
                VALUES (%s, %s, 0, %s, NOW(), NOW()) ON CONFLICT DO NOTHING
                """,
                (repo_id, lang["name"], lang.get("pct", 0)),
            )

        if tech_id:
            cur.execute(
                """
                INSERT INTO repository_technologies (repository_id, technology_id, confidence, status, created_at, updated_at)
                VALUES (%s, %s, 0.5, 'discovered', NOW(), NOW())
                ON CONFLICT (repository_id, technology_id) DO UPDATE SET updated_at = NOW()
                """,
                (repo_id, tech_id),
            )
    conn.commit()
    return action


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
