"""Postgres persistence for YouTube video catalog."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .domains import technology_slug

YT_PREFIX = "yt:"
_tech_cache: dict[str, int | None] = {}
_migration_done = False


def correlation_id(slug: str) -> str:
    return f"{YT_PREFIX}{slug}"


def connect():
    from .db import database_url

    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    conn = psycopg.connect(url, row_factory=dict_row)
    ensure_schema(conn)
    return conn


def ensure_schema(conn) -> None:
    global _migration_done
    if _migration_done:
        return
    sql_path = Path(__file__).resolve().parents[1] / "migrations" / "001_youtube_videos.sql"
    if sql_path.exists():
        with conn.cursor() as cur:
            cur.execute(sql_path.read_text(encoding="utf-8"))
        conn.commit()
    _migration_done = True


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


def video_counts_by_slug(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT catalog_slug AS slug, COUNT(*)::int AS n
            FROM youtube_videos
            GROUP BY catalog_slug
            """
        )
        rows = cur.fetchall()
    return {row["slug"]: row["n"] for row in rows}


def is_domain_done(conn, slug: str, refresh_days: int = 14) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, finished_at, accepted_count
            FROM youtube_search_runs WHERE correlation_id = %s
            """,
            (correlation_id(slug),),
        )
        row = cur.fetchone()
    if not row or row["status"] != "completed":
        return False
    # Zero results — always retry (quality gate may have been too strict)
    if (row.get("accepted_count") or 0) == 0:
        return False
    # refresh_days=0 disables cooldown (re-scrape everything that has results)
    if refresh_days <= 0:
        return False
    finished = row["finished_at"]
    if not finished:
        return False
    if finished.tzinfo is None:
        finished = finished.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - finished) < timedelta(days=refresh_days)


def mark_run_running(conn, slug: str, query: str) -> None:
    cid = correlation_id(slug)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM youtube_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE youtube_search_runs
                SET status = 'running', query = %s, started_at = %s, finished_at = NULL,
                    error = NULL, candidate_count = 0, accepted_count = 0, updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (query, now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO youtube_search_runs (
                  technology_id, catalog_slug, correlation_id, status, query,
                  started_at, created_at, updated_at
                ) VALUES (%s, %s, %s, 'running', %s, %s, NOW(), NOW())
                """,
                (tech_id, slug, cid, query, now),
            )
    conn.commit()


def mark_run_completed(conn, slug: str, query: str, candidates: int, accepted: int) -> None:
    cid = correlation_id(slug)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM youtube_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE youtube_search_runs SET
                  technology_id = COALESCE(%s, technology_id),
                  status = 'completed', query = %s, candidate_count = %s, accepted_count = %s,
                  finished_at = %s, error = NULL, updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (tech_id, query, candidates, accepted, now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO youtube_search_runs (
                  technology_id, catalog_slug, correlation_id, status, query,
                  candidate_count, accepted_count, started_at, finished_at, created_at, updated_at
                ) VALUES (%s, %s, %s, 'completed', %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                (tech_id, slug, cid, query, candidates, accepted, now, now),
            )
    conn.commit()


def mark_run_failed(conn, slug: str, error: str) -> None:
    cid = correlation_id(slug)
    tech_id = get_technology_id(conn, slug)
    now = datetime.now(timezone.utc)
    err = json.dumps({"message": str(error)[:500]})
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM youtube_search_runs WHERE correlation_id = %s", (cid,))
        if cur.fetchone():
            cur.execute(
                """
                UPDATE youtube_search_runs
                SET status = 'failed', error = %s::json, finished_at = %s, updated_at = NOW()
                WHERE correlation_id = %s
                """,
                (err, now, cid),
            )
        else:
            cur.execute(
                """
                INSERT INTO youtube_search_runs (
                  technology_id, catalog_slug, correlation_id, status, error,
                  finished_at, created_at, updated_at
                ) VALUES (%s, %s, %s, 'failed', %s::json, %s, NOW(), NOW())
                """,
                (tech_id, slug, cid, err, now),
            )
    conn.commit()


def upsert_video(conn, catalog_slug: str, video: dict) -> None:
    tech_id = get_technology_id(conn, catalog_slug)
    vid = video["youtube_video_id"]
    now = datetime.now(timezone.utc)
    metadata = json.dumps({"source": "youtube-api", "reject_reason": video.get("_reject_reason")})
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO youtube_videos (
              youtube_video_id, technology_id, catalog_slug, title, description,
              channel_id, channel_title, channel_subscriber_count, published_at,
              duration_seconds, view_count, like_count, comment_count,
              default_language, definition, thumbnail_url, video_url, quality_score,
              metadata, discovered_at, created_at, updated_at
            ) VALUES (
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::json,%s,%s,%s
            )
            ON CONFLICT (youtube_video_id) DO UPDATE SET
              technology_id = EXCLUDED.technology_id,
              catalog_slug = EXCLUDED.catalog_slug,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              channel_id = EXCLUDED.channel_id,
              channel_title = EXCLUDED.channel_title,
              channel_subscriber_count = EXCLUDED.channel_subscriber_count,
              published_at = EXCLUDED.published_at,
              duration_seconds = EXCLUDED.duration_seconds,
              view_count = EXCLUDED.view_count,
              like_count = EXCLUDED.like_count,
              comment_count = EXCLUDED.comment_count,
              default_language = EXCLUDED.default_language,
              definition = EXCLUDED.definition,
              thumbnail_url = EXCLUDED.thumbnail_url,
              video_url = EXCLUDED.video_url,
              quality_score = EXCLUDED.quality_score,
              metadata = EXCLUDED.metadata,
              updated_at = EXCLUDED.updated_at
            """,
            (
                vid,
                tech_id,
                catalog_slug,
                video.get("title"),
                video.get("description"),
                video.get("channel_id"),
                video.get("channel_title"),
                video.get("channel_subscriber_count") or 0,
                video.get("published_at"),
                video.get("duration_seconds") or 0,
                video.get("view_count") or 0,
                video.get("like_count") or 0,
                video.get("comment_count") or 0,
                video.get("default_language"),
                video.get("definition"),
                video.get("thumbnail_url"),
                video.get("video_url"),
                video.get("quality_score") or 0,
                metadata,
                now,
                now,
                now,
            ),
        )
    conn.commit()


def load_videos_for_slug(conn, slug: str, limit: int = 24) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT youtube_video_id, title, description, channel_id, channel_title,
                   channel_subscriber_count, published_at, duration_seconds, view_count,
                   like_count, thumbnail_url, video_url, quality_score, definition
            FROM youtube_videos
            WHERE catalog_slug = %s
            ORDER BY quality_score DESC, view_count DESC
            LIMIT %s
            """,
            (slug, limit),
        )
        return list(cur.fetchall())
