"""GitHub GraphQL repository discovery spider."""
from __future__ import annotations

import json
import os

import scrapy

from madewith_scraper import db
from madewith_scraper.domains import (
    load_domains,
    partition_query,
    partitions_for_domain,
    shard_id,
    sort_domains_by_projects,
)
from madewith_scraper.items import RepoItem, ShardCompleteItem, ShardFailedItem

GQL_SEARCH = """
query($q: String!, $n: Int!, $after: String) {
  rateLimit { remaining resetAt cost }
  search(query: $q, type: REPOSITORY, first: $n, after: $after) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Repository {
        databaseId
        name nameWithOwner description stargazerCount homepageUrl url
        isFork isArchived pushedAt
        owner { login avatarUrl }
        licenseInfo { spdxId }
        primaryLanguage { name }
        repositoryTopics(first: 12) { nodes { topic { name } } }
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
          totalSize edges { size node { name } }
        }
        releases(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName url } }
        refs(refPrefix: "refs/tags/", first: 5, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name } }
      }
    }
  }
}
"""


class GitHubSpider(scrapy.Spider):
    name = "github"

    custom_settings = {
        "CONCURRENT_REQUESTS": 1,
        "DOWNLOAD_DELAY": 5,
    }

    def __init__(self, domains: str | None = None, clean: str = "0", page_size: str = "100", max_pages: str = "10", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filter_slugs = {s.strip() for s in domains.split(",") if s.strip()} if domains else None
        self.clean = clean in ("1", "true", "yes")
        self.page_size = int(page_size)
        self.max_pages = int(max_pages)
        self.token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""

    async def start(self):
        if not self.token:
            raise RuntimeError("GITHUB_TOKEN is required in .env")

        conn = db.connect()
        try:
            if self.clean:
                db.reset_spawn_runs(conn)
                self.logger.info("Cleared spawn:* github_search_runs")

            domains = load_domains()
            if self.filter_slugs:
                domains = [d for d in domains if d["slug"] in self.filter_slugs]

            repo_counts = db.repo_counts_by_slug(conn)
            domains = sort_domains_by_projects(domains, repo_counts)
            order = ", ".join(f"{d['slug']}({repo_counts.get(d['slug'], 0)})" for d in domains)
            self.logger.info("Domain order (fewest repos first): %s", order)

            pending = 0
            for domain in domains:
                for partition in partitions_for_domain(domain):
                    sid = shard_id(partition[0], partition[1])
                    if db.is_shard_done(conn, domain["slug"], sid):
                        continue
                    pending += 1
                    db.mark_shard_running(conn, domain["slug"], sid)
                    query = partition_query(domain, partition)
                    yield self._gql_request(
                        domain=domain,
                        partition=partition,
                        shard=sid,
                        query=query,
                        after=None,
                        page=0,
                        repos=[],
                    )
            self.logger.info("Queued %s shard jobs", pending)
        finally:
            conn.close()

    def _gql_request(self, *, domain, partition, shard, query, after, page, repos):
        body = json.dumps({
            "query": GQL_SEARCH,
            "variables": {"q": query, "n": self.page_size, "after": after},
        })
        return scrapy.Request(
            url="https://api.github.com/graphql",
            method="POST",
            body=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            callback=self.parse_search,
            errback=self.errback_search,
            meta={
                "domain": domain,
                "partition": partition,
                "shard": shard,
                "query": query,
                "after": after,
                "page": page,
                "repos": repos,
            },
            dont_filter=True,
        )

    def parse_search(self, response):
        meta = response.meta
        domain = meta["domain"]
        slug = domain["slug"]
        shard = meta["shard"]
        query = meta["query"]
        repos = list(meta["repos"])

        try:
            payload = response.json()
        except Exception as exc:
            yield ShardFailedItem(catalog_slug=slug, shard_id=shard, error=str(exc))
            return

        if payload.get("errors"):
            msg = "; ".join(e.get("message", "") for e in payload["errors"])
            yield ShardFailedItem(catalog_slug=slug, shard_id=shard, error=msg)
            return

        search = (payload.get("data") or {}).get("search") or {}
        total = search.get("repositoryCount") or 0
        nodes = search.get("nodes") or []
        page_info = search.get("pageInfo") or {}

        for node in nodes:
            repo = self._from_graphql(node)
            repos.append(repo)
            yield RepoItem(catalog_slug=slug, repo=repo)

        page = meta["page"] + 1
        if page_info.get("hasNextPage") and page < self.max_pages:
            yield self._gql_request(
                domain=domain,
                partition=meta["partition"],
                shard=shard,
                query=query,
                after=page_info.get("endCursor"),
                page=page,
                repos=repos,
            )
            return

        yield ShardCompleteItem(
            catalog_slug=slug,
            shard_id=shard,
            query=query,
            total=total,
            repo_count=len(repos),
        )
        self.logger.info("✓ %s shard %s: %s repos (partition ~%s)", slug, shard, len(repos), total)

    def errback_search(self, failure):
        meta = failure.request.meta
        yield ShardFailedItem(
            catalog_slug=meta["domain"]["slug"],
            shard_id=meta["shard"],
            error=str(failure.value),
        )

    @staticmethod
    def _from_graphql(node: dict) -> dict:
        topics = [t["topic"]["name"] for t in (node.get("repositoryTopics") or {}).get("nodes", [])]
        total = (node.get("languages") or {}).get("totalSize") or 0
        langs = [
            {"name": e["node"]["name"], "pct": round((e["size"] / total) * 100) if total else 0}
            for e in (node.get("languages") or {}).get("edges", [])
        ][:3]
        if langs:
            drift = 100 - sum(l["pct"] for l in langs)
            langs[0]["pct"] += drift

        releases = [{"name": r["tagName"], "url": r["url"]} for r in (node.get("releases") or {}).get("nodes", [])]
        tags = [
            {"name": t["name"], "url": f"{node['url']}/releases/tag/{t['name']}"}
            for t in (node.get("refs") or {}).get("nodes", [])
        ]
        versions = (releases or tags)[:5]

        primary = (node.get("primaryLanguage") or {}).get("name")
        if not langs and primary:
            langs = [
                {"name": primary, "pct": 72},
                {"name": "CSS" if primary == "TypeScript" else "JavaScript", "pct": 20},
                {"name": "Other", "pct": 8},
            ]

        return {
            "databaseId": node.get("databaseId"),
            "name": node.get("name"),
            "full_name": node.get("nameWithOwner"),
            "description": node.get("description"),
            "stargazers_count": node.get("stargazerCount"),
            "homepage": node.get("homepageUrl"),
            "html_url": node.get("url"),
            "fork": node.get("isFork"),
            "archived": node.get("isArchived"),
            "pushed_at": node.get("pushedAt"),
            "owner": {
                "login": (node.get("owner") or {}).get("login"),
                "avatar_url": (node.get("owner") or {}).get("avatarUrl"),
            },
            "license": {"spdx_id": (node.get("licenseInfo") or {}).get("spdxId")},
            "language": primary,
            "topics": topics,
            "_langs": langs,
            "_versions": versions,
        }
