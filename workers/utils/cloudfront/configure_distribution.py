#!/usr/bin/env python3
"""Point the CloudFront distribution at the static site correctly.

    workers/.venv/bin/python workers/utils/cloudfront/configure_distribution.py --dry-run
    workers/.venv/bin/python workers/utils/cloudfront/configure_distribution.py --apply

Two fixes, both required before any DNS cutover:

1. Attach the `madewith-directory-index` viewer-request function. An S3 REST
   origin has no directory-index behaviour, so /blog/ requests the key "blog/",
   which does not exist. Without the rewrite every directory URL falls through
   to the error page.

2. Repoint the custom error responses. They currently map 403 and 404 to
   /index.html with status 200, so a missing page serves the homepage and tells
   crawlers it is fine. Both should serve /404.html with a real 404. 403 is
   included because an S3 REST origin returns 403 (not 404) for a missing key
   when the OAC policy grants only GetObject.

Idempotent: re-running when the config already matches changes nothing.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")

FUNCTION_NAME = "madewith-directory-index"
ERROR_RESPONSES = [
    {"ErrorCode": 403, "ResponsePagePath": "/404.html", "ResponseCode": "404", "ErrorCachingMinTTL": 10},
    {"ErrorCode": 404, "ResponsePagePath": "/404.html", "ResponseCode": "404", "ErrorCachingMinTTL": 10},
]


def describe(config: dict) -> None:
    functions = [
        f["FunctionARN"].split("/")[-1]
        for f in config["DefaultCacheBehavior"].get("FunctionAssociations", {}).get("Items", [])
    ]
    print(f"    viewer-request functions : {functions or '(none)'}")
    for item in config.get("CustomErrorResponses", {}).get("Items", []):
        print(
            f"    error {item['ErrorCode']} -> {item.get('ResponsePagePath')} "
            f"(status {item.get('ResponseCode')})"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--distribution-id", default=None,
                        help="Defaults to AWS_CLOUDFRONT_DISTRIBUTION_ID from .env.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Show the change without applying it.")
    group.add_argument("--apply", action="store_true", help="Apply the change.")
    args = parser.parse_args()

    import os
    distribution_id = args.distribution_id or os.getenv("AWS_CLOUDFRONT_DISTRIBUTION_ID")
    if not distribution_id:
        print("ERROR: set AWS_CLOUDFRONT_DISTRIBUTION_ID or pass --distribution-id", file=sys.stderr)
        return 1

    cf = boto3.client("cloudfront")
    try:
        published = cf.describe_function(Name=FUNCTION_NAME, Stage="LIVE")
        arn = published["FunctionSummary"]["FunctionMetadata"]["FunctionARN"]
    except ClientError as exc:
        print(f"ERROR: {FUNCTION_NAME} is not published to LIVE ({exc.response['Error']['Code']}). "
              "Create and publish it first.", file=sys.stderr)
        return 1

    got = cf.get_distribution_config(Id=distribution_id)
    config, etag = got["DistributionConfig"], got["ETag"]
    print(f"distribution {distribution_id}")
    print("  before:")
    describe(config)

    config["DefaultCacheBehavior"]["FunctionAssociations"] = {
        "Quantity": 1,
        "Items": [{"EventType": "viewer-request", "FunctionARN": arn}],
    }
    config["CustomErrorResponses"] = {"Quantity": len(ERROR_RESPONSES), "Items": ERROR_RESPONSES}

    print("  after:")
    describe(config)

    if args.dry_run:
        print("\ndry run — nothing changed")
        return 0

    try:
        result = cf.update_distribution(Id=distribution_id, IfMatch=etag, DistributionConfig=config)
    except (BotoCoreError, ClientError) as exc:
        print(f"ERROR: update failed: {exc}", file=sys.stderr)
        return 1

    print(f"\napplied — status {result['Distribution']['Status']}")
    print("Propagation takes a few minutes. Then verify against the distribution "
          "domain (not the live host):")
    print(f"  curl -sI https://{result['Distribution']['DomainName']}/blog/   # expect 200, blog index")
    print(f"  curl -sI https://{result['Distribution']['DomainName']}/nope/   # expect 404")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
