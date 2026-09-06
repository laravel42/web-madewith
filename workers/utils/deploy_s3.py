#!/usr/bin/env python3
"""Sync dist/ to S3 and invalidate Cloudflare for exactly what changed.

    pnpm deploy:s3 --dry-run
    pnpm deploy:s3
    pnpm deploy:s3 --delete          # also remove stale remote keys

Uploads only files whose content differs, then purges the Cloudflare cache for
the URLs those files serve — the upload plan is the invalidation list, so a
deploy that changed three pages purges three URLs instead of the whole zone.

Why not just re-upload everything: dist/ is ~34k files and ~1.5 GB, and a
normal rebuild changes a handful of them. Change detection is one paginated
LIST of the bucket (~34 requests) followed by a local size/ETag comparison, so
an unchanged deploy costs a few seconds and no PUTs.

ETag comparison handles both upload shapes. S3 sets ETag to the MD5 hex digest
for a single-part PUT, but to "<md5-of-part-md5s>-<part count>" for a multipart
upload — and this site ships several HTML pages over the 8 MB threshold, so
both cases are live. The thresholds below are the ones passed to boto3, which
is what makes the recomputed ETag match.

Requires boto3 and credentials from the usual sources: AWS_PROFILE,
AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or an instance role. Cloudflare purging
needs CLOUDFLARE_API_TOKEN (a token with the zone-scoped "Cache Purge"
permission) plus CLOUDFLARE_ZONE_ID; without them the upload still runs and the
purge is skipped with a warning. Configuration is read from the repo .env.

Caveat on headers: S3 only returns a fixed set of metadata headers, so the
Cache-Control and Content-Type rules below are applied per object, but the
X-Content-Type-Options and Referrer-Policy entries in public/_headers cannot
be. Those need a CloudFront response-headers policy (or equivalent) in front
of the bucket.
"""

from __future__ import annotations

import argparse
import hashlib
import mimetypes
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path
from urllib.parse import urlparse

try:
    import boto3
    import requests
    from boto3.s3.transfer import TransferConfig
    from botocore.config import Config as BotoConfig
    from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
    from dotenv import load_dotenv
except ImportError as exc:  # pragma: no cover - depends on the local environment
    sys.exit(f"missing dependency ({exc}) — run: workers/.venv/bin/pip install -r workers/requirements.txt")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIST = ROOT / "dist"
load_dotenv(ROOT / ".env")

DEFAULT_BUCKET = "web-madewith-static-site"

# Cloudflare caps every purge request at 100 operations, on all plans.
CF_PURGE_BATCH = 100
CF_API = "https://api.cloudflare.com/client/v4"
# Above this many changed URLs, one blanket purge beats dozens of batched
# requests fighting the per-plan rate limit (5/min on Free), and on CloudFront
# it collapses a per-path charge into a single "/*" path.
DEFAULT_PURGE_MAX_URLS = 200
# CloudFront accepts at most 3,000 paths in one invalidation; a terminal "/*"
# counts as a single path and covers everything.
CF_MAX_INVALIDATION_PATHS = 3000

# Must match what boto3 uses, or recomputed multipart ETags will not line up.
MULTIPART_THRESHOLD = 8 * 1024 * 1024
MULTIPART_CHUNKSIZE = 8 * 1024 * 1024
TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=MULTIPART_THRESHOLD,
    multipart_chunksize=MULTIPART_CHUNKSIZE,
    use_threads=False,  # this script parallelises across files instead
)

# Never publish these, whatever the build leaves lying around.
DEFAULT_EXCLUDES = (".DS_Store", "Thumbs.db", "*.map.gz", "__MACOSX/*")

# Extensions where the guessed type is wrong, missing, or lacks a charset.
CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
}

# Mirrors public/_headers. First matching rule wins; the last entry is the
# catch-all. Edit here and in public/_headers together.
CACHE_RULES: tuple[tuple[str, str], ...] = (
    ("_astro/*", "public, max-age=31536000, immutable"),
    ("assets/*", "public, max-age=31536000, immutable"),
    ("favicon*.svg", "public, max-age=86400"),
    ("icons/*", "public, max-age=86400"),
    ("*", "public, max-age=0, s-maxage=3600, must-revalidate"),
)


@dataclass
class LocalFile:
    key: str
    path: Path
    size: int


@dataclass
class Plan:
    uploads: list[LocalFile]
    unchanged: int
    deletions: list[str]
    remote_count: int


def content_type_for(key: str) -> str:
    suffix = Path(key).suffix.lower()
    if suffix in CONTENT_TYPES:
        return CONTENT_TYPES[suffix]
    guessed, _ = mimetypes.guess_type(key)
    return guessed or "application/octet-stream"


def cache_control_for(key: str) -> str:
    name = Path(key).name
    for pattern, value in CACHE_RULES:
        if fnmatch(key, pattern) or fnmatch(name, pattern):
            return value
    return CACHE_RULES[-1][1]


def file_etag(path: Path, size: int) -> str:
    """Reproduce the ETag S3 would store for this file."""
    if size < MULTIPART_THRESHOLD:
        digest = hashlib.md5()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    part_digests: list[bytes] = []
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(MULTIPART_CHUNKSIZE), b""):
            part_digests.append(hashlib.md5(chunk).digest())
    if not part_digests:
        part_digests = [hashlib.md5(b"").digest()]
    combined = hashlib.md5(b"".join(part_digests)).hexdigest()
    return f"{combined}-{len(part_digests)}"


def is_excluded(key: str, patterns: tuple[str, ...]) -> bool:
    name = Path(key).name
    return any(fnmatch(key, p) or fnmatch(name, p) for p in patterns)


def walk_dist(dist: Path, prefix: str, excludes: tuple[str, ...]) -> list[LocalFile]:
    files: list[LocalFile] = []
    for path in sorted(dist.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(dist).as_posix()
        if is_excluded(relative, excludes):
            continue
        files.append(
            LocalFile(key=f"{prefix}{relative}", path=path, size=path.stat().st_size)
        )
    return files


def list_remote(client, bucket: str, prefix: str) -> dict[str, tuple[str, int]]:
    """One paginated LIST instead of a HEAD per file — 34k HEADs would dominate
    the runtime of an otherwise no-op deploy."""
    remote: dict[str, tuple[str, int]] = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            remote[item["Key"]] = (item["ETag"].strip('"'), item["Size"])
    return remote


def build_plan(
    local_files: list[LocalFile],
    remote: dict[str, tuple[str, int]],
    *,
    want_deletions: bool,
) -> Plan:
    uploads: list[LocalFile] = []
    unchanged = 0
    for item in local_files:
        match = remote.get(item.key)
        # Size is a free first pass; only same-size files need to be hashed.
        if match is None or match[1] != item.size:
            uploads.append(item)
            continue
        if match[0] != file_etag(item.path, item.size):
            uploads.append(item)
            continue
        unchanged += 1

    deletions: list[str] = []
    if want_deletions:
        local_keys = {item.key for item in local_files}
        deletions = sorted(key for key in remote if key not in local_keys)
    return Plan(uploads, unchanged, deletions, len(remote))


def upload_all(client, bucket: str, uploads: list[LocalFile], workers: int) -> list[str]:
    failures: list[str] = []
    lock = threading.Lock()
    done = 0

    def send(item: LocalFile) -> None:
        nonlocal done
        try:
            client.upload_file(
                str(item.path),
                bucket,
                item.key,
                ExtraArgs={
                    "ContentType": content_type_for(item.key),
                    "CacheControl": cache_control_for(item.key),
                },
                Config=TRANSFER_CONFIG,
            )
        except (BotoCoreError, ClientError, OSError) as exc:
            with lock:
                failures.append(f"{item.key}: {exc}")
            return
        with lock:
            done += 1
            if done % 100 == 0 or done == len(uploads):
                print(f"  uploaded {done}/{len(uploads)}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(send, uploads))
    return failures


def delete_all(client, bucket: str, keys: list[str]) -> list[str]:
    failures: list[str] = []
    for start in range(0, len(keys), 1000):  # DeleteObjects caps at 1000 keys
        batch = keys[start:start + 1000]
        response = client.delete_objects(
            Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True}
        )
        failures.extend(
            f"{e.get('Key')}: {e.get('Message')}" for e in response.get("Errors", [])
        )
    return failures


def human(count: int) -> str:
    return f"{count:,}"


def public_url(key: str, prefix: str, site_url: str) -> str:
    """Map an S3 key to the URL a visitor requests.

    The bucket prefix is a storage folder, not part of the public path, so it is
    stripped. `a/b/index.html` is served at `/a/b/` — purging the index.html URL
    would miss the directory URL that is actually in Cloudflare's cache, so the
    directory form is the one emitted.
    """
    path = key[len(prefix):] if prefix and key.startswith(prefix) else key
    if path == "index.html":
        path = ""
    elif path.endswith("/index.html"):
        path = path[: -len("index.html")]
    return f"{site_url.rstrip('/')}/{path}"


def url_path(url: str) -> str:
    """CloudFront invalidates by path, not absolute URL."""
    path = urlparse(url).path or "/"
    return path if path.startswith("/") else f"/{path}"


def invalidate_cloudfront(
    urls: list[str],
    *,
    distribution_id: str,
    invalidate_everything: bool,
    dry_run: bool,
    client=None,
) -> list[str]:
    """Create a CloudFront invalidation. Returns a list of failure messages."""
    if invalidate_everything:
        paths = ["/*"]
    else:
        paths = sorted({url_path(u) for u in urls})
        if len(paths) > CF_MAX_INVALIDATION_PATHS:
            paths = ["/*"]

    label = "/* (everything)" if paths == ["/*"] else f"{human(len(paths))} path(s)"
    if dry_run:
        print(f"  would invalidate {distribution_id}: {label}")
        for path in paths[:10]:
            print(f"    {path}")
        return []

    print(f"  invalidating {distribution_id}: {label}")
    client = client or boto3.client("cloudfront")
    reference = f"deploy-{int(time.time())}-{hashlib.md5(''.join(paths).encode()).hexdigest()[:8]}"
    try:
        client.create_invalidation(
            DistributionId=distribution_id,
            InvalidationBatch={
                "Paths": {"Quantity": len(paths), "Items": paths},
                "CallerReference": reference,
            },
        )
    except (BotoCoreError, ClientError) as exc:
        return [f"cloudfront: {exc}"]
    return []


def purge_cloudflare(
    urls: list[str],
    *,
    zone_id: str,
    token: str,
    purge_everything: bool,
    dry_run: bool,
) -> list[str]:
    """Purge the Cloudflare edge cache. Returns a list of failure messages."""
    endpoint = f"{CF_API}/zones/{zone_id}/purge_cache"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if purge_everything:
        batches: list[dict[str, object]] = [{"purge_everything": True}]
        label = "purge_everything"
    else:
        unique = sorted(set(urls))
        batches = [
            {"files": unique[i:i + CF_PURGE_BATCH]}
            for i in range(0, len(unique), CF_PURGE_BATCH)
        ]
        label = f"{human(len(unique))} URL(s) in {len(batches)} request(s)"

    if dry_run:
        print(f"  would purge: {label}")
        for url in (batches[0].get("files") or [])[:10] if not purge_everything else []:
            print(f"    {url}")
        return []

    print(f"  purging: {label}")
    failures: list[str] = []
    for index, payload in enumerate(batches, start=1):
        for attempt in range(5):
            try:
                response = requests.post(endpoint, headers=headers, json=payload, timeout=30)
            except requests.RequestException as exc:
                failures.append(f"batch {index}: {exc}")
                break
            if response.status_code == 429:
                # Free plans allow 5 purges/minute; respect the server's pacing.
                delay = int(response.headers.get("Retry-After", min(60, 2 ** attempt * 5)))
                print(f"    rate limited, retrying batch {index} in {delay}s")
                time.sleep(delay)
                continue
            if response.ok and response.json().get("success"):
                break
            detail = response.text[:300].replace("\n", " ")
            failures.append(f"batch {index}: HTTP {response.status_code} {detail}")
            break
        else:
            failures.append(f"batch {index}: still rate limited after 5 attempts")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # AWS_* names are the ones already in .env; S3_* are accepted as aliases.
    parser.add_argument(
        "--bucket",
        default=os.getenv("AWS_BUCKET") or os.getenv("S3_BUCKET") or DEFAULT_BUCKET,
    )
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument(
        "--prefix",
        default=os.getenv("S3_PREFIX", ""),
        help="Folder inside the bucket to deploy into (env: S3_PREFIX). "
        "Stripped when building purge URLs.",
    )
    parser.add_argument("--profile", default=os.getenv("AWS_PROFILE"))
    parser.add_argument("--region", default=os.getenv("AWS_REGION"))
    parser.add_argument(
        "--endpoint-url",
        default=os.getenv("AWS_ENDPOINT") or os.getenv("S3_ENDPOINT_URL"),
        help="For S3-compatible storage such as Cloudflare R2 (env: AWS_ENDPOINT).",
    )
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Remove remote keys that no longer exist in dist/.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt guarding a large --delete.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Extra glob to skip; repeatable. Added to the built-in excludes.",
    )
    parser.add_argument("--site-url", default=os.getenv("SITE_URL", ""),
                        help="Public origin used to build purge URLs (env: SITE_URL).")
    parser.add_argument("--zone-id", default=os.getenv("CLOUDFLARE_ZONE_ID"),
                        help="Cloudflare zone to purge (env: CLOUDFLARE_ZONE_ID).")
    parser.add_argument("--cf-token", default=os.getenv("CLOUDFLARE_API_TOKEN"),
                        help="Token with the zone 'Cache Purge' permission (env: CLOUDFLARE_API_TOKEN).")
    parser.add_argument("--distribution-id", default=os.getenv("AWS_CLOUDFRONT_DISTRIBUTION_ID"),
                        help="CloudFront distribution to invalidate (env: AWS_CLOUDFRONT_DISTRIBUTION_ID).")
    parser.add_argument("--no-purge", action="store_true",
                        help="Upload without invalidating any CDN.")
    parser.add_argument("--purge-everything", action="store_true",
                        help="Purge the whole zone instead of just the changed URLs.")
    parser.add_argument(
        "--purge-max-urls",
        type=int,
        default=int(os.getenv("CF_PURGE_MAX_URLS", DEFAULT_PURGE_MAX_URLS)),
        help=f"Above this many changed URLs, purge the whole zone instead "
        f"(default {DEFAULT_PURGE_MAX_URLS}).",
    )
    args = parser.parse_args()

    if not args.dist.is_dir():
        return fail(f"{args.dist} does not exist — run `pnpm build` first")
    if args.concurrency < 1:
        return fail("--concurrency must be at least 1")
    prefix = f"{args.prefix.strip('/')}/" if args.prefix.strip("/") else ""
    excludes = DEFAULT_EXCLUDES + tuple(args.exclude)

    local_files = walk_dist(args.dist, prefix, excludes)
    if not local_files:
        return fail(f"no publishable files under {args.dist}")
    total_bytes = sum(item.size for item in local_files)
    print(
        f"local: {human(len(local_files))} files, {total_bytes / 1_048_576:.1f} MB "
        f"→ s3://{args.bucket}/{prefix}"
    )

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    endpoint = args.endpoint_url or None
    # A bucket-scoped AWS endpoint (https://<bucket>.s3.<region>.amazonaws.com)
    # is what upload libraries want, but boto3 derives its own endpoint from the
    # region and would append the bucket again — https://bucket.s3…/bucket/key.
    # Only genuinely third-party endpoints (R2, MinIO) should be passed through.
    if endpoint and "amazonaws.com" in urlparse(endpoint).netloc:
        print(f"note: ignoring AWS_ENDPOINT ({endpoint}) — boto3 derives the AWS endpoint from the region")
        endpoint = None
    path_style = os.getenv("AWS_S3_FORCE_PATH_STYLE", "").lower() in {"1", "true", "yes"}
    client = session.client(
        "s3",
        endpoint_url=endpoint,
        # Path style is required by most S3-compatible services and deprecated
        # on AWS itself, so only apply it when talking to a third party.
        config=BotoConfig(s3={"addressing_style": "path"}) if (path_style and endpoint) else None,
    )

    try:
        remote = list_remote(client, args.bucket, prefix)
    except NoCredentialsError:
        return fail("no AWS credentials found (set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)")
    except ClientError as exc:
        return fail(f"cannot list s3://{args.bucket}: {exc}")
    print(f"remote: {human(len(remote))} objects")

    plan = build_plan(local_files, remote, want_deletions=args.delete)
    print(
        f"plan: {human(len(plan.uploads))} to upload, "
        f"{human(plan.unchanged)} unchanged, {human(len(plan.deletions))} to delete"
    )
    upload_bytes = sum(item.size for item in plan.uploads)
    if plan.uploads:
        print(f"  upload size: {upload_bytes / 1_048_576:.1f} MB")
        for item in plan.uploads[:10]:
            print(f"    + {item.key}")
        if len(plan.uploads) > 10:
            print(f"    ... and {human(len(plan.uploads) - 10)} more")
    for key in plan.deletions[:10]:
        print(f"    - {key}")
    if len(plan.deletions) > 10:
        print(f"    ... and {human(len(plan.deletions) - 10)} more")

    # Deletions matter too: a removed page must stop being served from cache.
    changed_keys = [item.key for item in plan.uploads] + plan.deletions
    purge_urls = sorted({public_url(k, prefix, args.site_url) for k in changed_keys}) if args.site_url else []
    purge_everything = args.purge_everything or len(purge_urls) > args.purge_max_urls

    if args.dry_run:
        print("\ncdn:")
        run_cdn(args, purge_urls, purge_everything, dry_run=True)
        print("\ndry run — nothing uploaded, deleted, or invalidated")
        return 0
    if not plan.uploads and not plan.deletions:
        print("\nnothing to do — bucket already matches dist/")
        return 0

    # A deletion sweep this large usually means the wrong prefix or a partial
    # build, not an intentional removal.
    if plan.deletions and not args.yes:
        share = len(plan.deletions) / max(plan.remote_count, 1)
        if share > 0.25:
            print(
                f"\nrefusing to delete {human(len(plan.deletions))} of "
                f"{human(plan.remote_count)} objects ({share:.0%}). "
                "Re-run with --yes if that is intended.",
                file=sys.stderr,
            )
            return 1

    failures: list[str] = []
    if plan.uploads:
        print(f"\nuploading {human(len(plan.uploads))} files...")
        failures += upload_all(client, args.bucket, plan.uploads, args.concurrency)
    if plan.deletions:
        print(f"deleting {human(len(plan.deletions))} stale objects...")
        failures += delete_all(client, args.bucket, plan.deletions)

    if failures:
        print(f"\n{len(failures)} operation(s) failed:", file=sys.stderr)
        for line in failures[:20]:
            print(f"  {line}", file=sys.stderr)
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more", file=sys.stderr)
        return 1

    print("\ncdn:")
    if run_cdn(args, purge_urls, purge_everything, dry_run=False):
        # The upload already succeeded; only the edge cache is stale.
        return 1

    print(
        f"\ndone: {human(len(plan.uploads))} uploaded, "
        f"{human(plan.unchanged)} unchanged, {human(len(plan.deletions))} deleted"
    )
    return 0


def run_cdn(
    args: argparse.Namespace,
    urls: list[str],
    everything: bool,
    *,
    dry_run: bool,
) -> bool:
    """Invalidate every configured CDN. Returns True if anything failed.

    Both are supported at once: during a Cloudflare-to-CloudFront migration the
    old edge keeps serving until DNS flips, so purging only the new one would
    leave visitors on stale content.
    """
    if args.no_purge:
        print("  skipped (--no-purge)")
        return False
    if not args.site_url:
        print("  SKIPPED — SITE_URL is unset, cannot build invalidation paths",
              file=sys.stderr if not dry_run else sys.stdout)
        return not dry_run

    cloudflare_ready = bool(args.zone_id and args.cf_token)
    cloudfront_ready = bool(args.distribution_id)
    if not cloudflare_ready and not cloudfront_ready:
        print("  SKIPPED — set AWS_CLOUDFRONT_DISTRIBUTION_ID, or "
              "CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN",
              file=sys.stderr if not dry_run else sys.stdout)
        return not dry_run
    if not urls and not everything:
        print("  nothing to invalidate")
        return False
    if everything and not args.purge_everything:
        print(f"  {human(len(urls))} changed URLs exceeds --purge-max-urls "
              f"{args.purge_max_urls} — invalidating everything")

    failures: list[str] = []
    if cloudfront_ready:
        failures += invalidate_cloudfront(
            urls,
            distribution_id=args.distribution_id,
            invalidate_everything=everything,
            dry_run=dry_run,
        )
    if cloudflare_ready:
        failures += purge_cloudflare(
            urls,
            zone_id=args.zone_id,
            token=args.cf_token,
            purge_everything=everything,
            dry_run=dry_run,
        )
    for line in failures[:10]:
        print(f"  FAILED {line}", file=sys.stderr)
    if not failures and not dry_run:
        print("  invalidated")
    return bool(failures)


def fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
