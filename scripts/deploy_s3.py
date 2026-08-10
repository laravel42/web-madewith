#!/usr/bin/env python3
"""Sync dist/ to S3, uploading only files that actually changed.

    python3 scripts/deploy_s3.py --dry-run
    python3 scripts/deploy_s3.py
    python3 scripts/deploy_s3.py --delete          # also remove stale remote keys

Why not just re-upload everything: dist/ is ~34k files and ~1.5 GB, and a
normal rebuild changes a handful of them. Change detection is one paginated
LIST of the bucket (~34 requests) followed by a local size/ETag comparison, so
an unchanged deploy costs a few seconds and no PUTs.

ETag comparison handles both upload shapes. S3 sets ETag to the MD5 hex digest
for a single-part PUT, but to "<md5-of-part-md5s>-<part count>" for a multipart
upload — and this site ships several HTML pages over the 8 MB threshold, so
both cases are live. The thresholds below are the ones passed to boto3, which
is what makes the recomputed ETag match.

Requires boto3 (`pip install boto3`) and credentials from the usual sources:
AWS_PROFILE, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or an instance role.

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
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

try:
    import boto3
    from boto3.s3.transfer import TransferConfig
    from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
except ImportError:  # pragma: no cover - depends on the local environment
    sys.exit("boto3 is required: pip install boto3")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIST = ROOT / "dist"
DEFAULT_BUCKET = "web-madewith-static-site"

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bucket", default=os.getenv("S3_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--prefix", default="", help="Key prefix inside the bucket.")
    parser.add_argument("--profile", default=os.getenv("AWS_PROFILE"))
    parser.add_argument("--region", default=os.getenv("AWS_REGION"))
    parser.add_argument(
        "--endpoint-url",
        default=os.getenv("S3_ENDPOINT_URL"),
        help="For S3-compatible storage such as Cloudflare R2.",
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
    client = session.client("s3", endpoint_url=args.endpoint_url)

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

    if args.dry_run:
        print("\ndry run — nothing uploaded or deleted")
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

    print(
        f"\ndone: {human(len(plan.uploads))} uploaded, "
        f"{human(plan.unchanged)} unchanged, {human(len(plan.deletions))} deleted"
    )
    return 0


def fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
