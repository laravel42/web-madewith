"""Discover English YouTube tech tutorials via YouTube Data API v3."""
from __future__ import annotations

import json
import os
from urllib.parse import urlencode

import scrapy

from madewith_youtube import youtube_db
from madewith_youtube.domains import (
    load_domains,
    sort_domains_by_projects,
    youtube_search_query,
)
from madewith_youtube.items import YoutubeRunCompleteItem, YoutubeRunFailedItem, YoutubeVideoItem
from madewith_youtube.youtube_quality import (
    load_config,
    parse_iso8601_duration,
    passes_quality_gate,
    quality_score,
)
from madewith_youtube.youtube_relevance import passes_relevance_gate

API_BASE = "https://www.googleapis.com/youtube/v3"


class YoutubeSpider(scrapy.Spider):
    name = "youtube"

    custom_settings = {
        "CONCURRENT_REQUESTS": 1,
        "DOWNLOAD_DELAY": 1,
        "ITEM_PIPELINES": {
            "madewith_youtube.pipelines.YoutubePipeline": 300,
        },
        "DEFAULT_REQUEST_HEADERS": {
            "Accept": "application/json",
            "User-Agent": "madewith-scrapy-youtube",
        },
    }

    def __init__(
        self,
        domains: str | None = None,
        clean: str = "0",
        max_results: str = "40",
        refresh_days: str = "14",
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.filter_slugs = {s.strip() for s in domains.split(",") if s.strip()} if domains else None
        self.clean = clean in ("1", "true", "yes")
        self.max_results = min(int(max_results), 50)
        self.refresh_days = int(refresh_days)
        self.api_key = os.environ.get("YOUTUBE_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
        self.quality_cfg = load_config()
        self._reject_log_budget = 8

    async def start(self):
        if not self.api_key:
            raise RuntimeError("YOUTUBE_API_KEY is required in .env")

        conn = youtube_db.connect()
        try:
            if self.clean:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM youtube_search_runs")
                conn.commit()
                self.logger.info("Cleared youtube_search_runs")

            domains = load_domains()
            if self.filter_slugs:
                domains = [d for d in domains if d["slug"] in self.filter_slugs]

            counts = youtube_db.video_counts_by_slug(conn)
            domains = sort_domains_by_projects(domains, counts)
            order = ", ".join(f"{d['slug']}({counts.get(d['slug'], 0)})" for d in domains)
            self.logger.info("YouTube domain order (fewest videos first): %s", order)

            queued = 0
            skipped = 0
            for domain in domains:
                slug = domain["slug"]
                if youtube_db.is_domain_done(conn, slug, self.refresh_days) and not self.clean:
                    skipped += 1
                    continue
                query = youtube_search_query(domain)
                youtube_db.mark_run_running(conn, slug, query)
                queued += 1
                yield self._search_request(domain=domain, query=query, page_token=None)
            self.logger.info("Queued %s YouTube domain jobs (%s skipped — fresh within %s days)", queued, skipped, self.refresh_days)
        finally:
            conn.close()

    def _api_url(self, path: str, params: dict) -> str:
        params = {**params, "key": self.api_key}
        return f"{API_BASE}/{path}?{urlencode(params)}"

    def _search_request(self, *, domain, query, page_token):
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "order": "viewCount",
            "relevanceLanguage": "en",
            "regionCode": "US",
            "videoDuration": "medium",
            "maxResults": str(self.max_results),
            "safeSearch": "strict",
        }
        if page_token:
            params["pageToken"] = page_token
        return scrapy.Request(
            url=self._api_url("search", params),
            callback=self.parse_search,
            errback=self.errback_domain,
            meta={"domain": domain, "query": query, "page_token": page_token, "video_ids": []},
            dont_filter=True,
        )

    def parse_search(self, response):
        domain = response.meta["domain"]
        slug = domain["slug"]
        query = response.meta["query"]
        try:
            payload = response.json()
        except Exception as exc:
            yield YoutubeRunFailedItem(catalog_slug=slug, error=str(exc))
            return

        if payload.get("error"):
            msg = payload["error"].get("message", "YouTube API error")
            yield YoutubeRunFailedItem(catalog_slug=slug, error=msg)
            return

        video_ids = list(response.meta.get("video_ids") or [])
        for item in payload.get("items") or []:
            vid = (item.get("id") or {}).get("videoId")
            if vid:
                video_ids.append(vid)

        next_token = payload.get("nextPageToken")
        if next_token and len(video_ids) < self.max_results:
            yield self._search_request(domain=domain, query=query, page_token=next_token)
            return

        if not video_ids:
            yield YoutubeRunCompleteItem(
                catalog_slug=slug,
                query=query,
                candidate_count=0,
                accepted_count=0,
            )
            return

        yield scrapy.Request(
            url=self._api_url("videos", {
                "part": "snippet,contentDetails,statistics",
                "id": ",".join(video_ids[:50]),
            }),
            callback=self.parse_videos,
            errback=self.errback_domain,
            meta={"domain": domain, "query": query, "video_ids": video_ids[:50]},
            dont_filter=True,
        )

    def parse_videos(self, response):
        domain = response.meta["domain"]
        slug = domain["slug"]
        query = response.meta["query"]
        try:
            payload = response.json()
        except Exception as exc:
            yield YoutubeRunFailedItem(catalog_slug=slug, error=str(exc))
            return

        if payload.get("error"):
            yield YoutubeRunFailedItem(catalog_slug=slug, error=payload["error"].get("message", "YouTube API error"))
            return

        videos = []
        channel_ids: set[str] = set()
        for item in payload.get("items") or []:
            snippet = item.get("snippet") or {}
            stats = item.get("statistics") or {}
            content = item.get("contentDetails") or {}
            channel_id = snippet.get("channelId") or ""
            if channel_id:
                channel_ids.add(channel_id)
            thumbs = (snippet.get("thumbnails") or {}).get("medium") or {}
            videos.append({
                "youtube_video_id": item.get("id"),
                "title": snippet.get("title"),
                "description": snippet.get("description"),
                "channel_id": channel_id,
                "channel_title": snippet.get("channelTitle"),
                "published_at": snippet.get("publishedAt"),
                "default_language": snippet.get("defaultAudioLanguage") or snippet.get("defaultLanguage"),
                "default_audio_language": snippet.get("defaultAudioLanguage"),
                "duration_seconds": parse_iso8601_duration(content.get("duration")),
                "definition": content.get("definition"),
                "view_count": int(stats.get("viewCount") or 0),
                "like_count": int(stats.get("likeCount") or 0),
                "comment_count": int(stats.get("commentCount") or 0),
                "thumbnail_url": thumbs.get("url"),
                "video_url": f"https://www.youtube.com/watch?v={item.get('id')}",
            })

        if not videos:
            yield YoutubeRunCompleteItem(catalog_slug=slug, query=query, candidate_count=0, accepted_count=0)
            return

        yield scrapy.Request(
            url=self._api_url("channels", {
                "part": "statistics",
                "id": ",".join(sorted(channel_ids)),
            }),
            callback=self.parse_channels,
            errback=self.errback_domain,
            meta={"domain": domain, "query": query, "videos": videos},
            dont_filter=True,
        )

    def parse_channels(self, response):
        domain = response.meta["domain"]
        slug = domain["slug"]
        query = response.meta["query"]
        videos = response.meta["videos"]
        try:
            payload = response.json()
        except Exception as exc:
            yield YoutubeRunFailedItem(catalog_slug=slug, error=str(exc))
            return

        if payload.get("error"):
            yield YoutubeRunFailedItem(catalog_slug=slug, error=payload["error"].get("message", "YouTube API error"))
            return

        subs_by_channel = {
            item["id"]: int((item.get("statistics") or {}).get("subscriberCount") or 0)
            for item in payload.get("items") or []
        }

        accepted = 0
        for video in videos:
            video["channel_subscriber_count"] = subs_by_channel.get(video.get("channel_id"), 0)
            ok, reason = passes_quality_gate(video, self.quality_cfg)
            if not ok:
                if self._reject_log_budget > 0:
                    self.logger.debug("✗ %s — %s (%s)", slug, video.get("title", "")[:60], reason)
                    self._reject_log_budget -= 1
                continue
            ok, reason = passes_relevance_gate(slug, domain["techName"], video)
            if not ok:
                if self._reject_log_budget > 0:
                    self.logger.debug("✗ %s — relevance %s (%s)", slug, video.get("title", "")[:60], reason)
                    self._reject_log_budget -= 1
                continue
            video["quality_score"] = quality_score(video)
            accepted += 1
            yield YoutubeVideoItem(catalog_slug=slug, video=video)

        yield YoutubeRunCompleteItem(
            catalog_slug=slug,
            query=query,
            candidate_count=len(videos),
            accepted_count=accepted,
        )
        self.logger.info("✓ %s: %s/%s videos passed quality gate", slug, accepted, len(videos))

    def errback_domain(self, failure):
        meta = failure.request.meta
        yield YoutubeRunFailedItem(
            catalog_slug=meta["domain"]["slug"],
            error=str(failure.value),
        )
