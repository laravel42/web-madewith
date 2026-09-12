#!/usr/bin/env python3
"""Wire the newsletter/submit/chat Lambdas into the existing CloudFront
distribution as same-origin /api/* routes.

    workers/.venv/bin/python workers/utils/cloudfront/add_api_origins.py --dry-run
    workers/.venv/bin/python workers/utils/cloudfront/add_api_origins.py --apply

Run this AFTER `pnpm --dir infra run deploy` — it reads the HTTP API and chat
Function URL domains from that stack's CloudFormation outputs, so the API
must already exist.

Adds two origins + two cache behaviors to the distribution used by
AWS_CLOUDFRONT_DISTRIBUTION_ID (the same distribution configure_distribution.py
points at):

1. `/api/chat` -> the chat Lambda's Function URL. The Function URL is public
   (AuthType NONE) — Origin Access Control (SigV4) on a Function URL with
   InvokeMode RESPONSE_STREAM never reached the function in testing (403
   before invocation despite a correct IAM resource policy) — so this origin
   instead sends CHAT_ORIGIN_SECRET (from .env) as a custom header, and the
   Lambda rejects any request missing/mismatching it. Must be listed before
   the catch-all so its exact match wins.
2. `/api/*` -> the HTTP API (API Gateway) fronting the newsletter/submit
   Lambda. Catches every other /api/* route.

Both use CachingDisabled (dynamic POSTs, nothing to cache) and
AllViewerExceptHostHeader (forwards IP/content-type/body to the Lambda without
CloudFront trying to rewrite the Host header itself).

Idempotent: re-running when the config already matches changes nothing.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
INFRA_DIR = ROOT / "infra"
load_dotenv(ROOT / ".env")

CHAT_ORIGIN_ID = "madewith-chat-lambda"
API_ORIGIN_ID = "madewith-http-api"
CHAT_SECRET_HEADER = "X-Chat-Origin-Secret"

# CloudFront managed policies (same IDs in every account/region).
CACHING_DISABLED_POLICY_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID = "b689b0a8-53d0-40ab-baf2-68738e2966ac"


def stack_outputs() -> dict[str, str]:
    """Read MadeWithApiStack's CloudFormation outputs via the CDK CLI's own
    AWS session, so this script needs no separate stack-name/region guessing."""
    result = subprocess.run(
        ["aws", "cloudformation", "describe-stacks", "--stack-name", "MadeWithApiStack"],
        capture_output=True, text=True, cwd=INFRA_DIR,
    )
    if result.returncode != 0:
        print(f"ERROR: could not read MadeWithApiStack outputs — deploy it first (pnpm --dir infra run deploy)\n{result.stderr}",
              file=sys.stderr)
        sys.exit(1)
    stacks = json.loads(result.stdout)["Stacks"]
    outputs = {o["OutputKey"]: o["OutputValue"] for o in stacks[0]["Outputs"]}
    return outputs


def domain_of(url: str) -> str:
    return urlparse(url).netloc


def build_origins(chat_domain: str, api_domain: str, chat_origin_secret: str) -> list[dict]:
    return [
        {
            "Id": CHAT_ORIGIN_ID,
            "DomainName": chat_domain,
            "OriginPath": "",
            "CustomHeaders": {
                "Quantity": 1,
                "Items": [{"HeaderName": CHAT_SECRET_HEADER, "HeaderValue": chat_origin_secret}],
            },
            "CustomOriginConfig": {
                "HTTPPort": 80,
                "HTTPSPort": 443,
                "OriginProtocolPolicy": "https-only",
                "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
                "OriginReadTimeout": 60,
                "OriginKeepaliveTimeout": 5,
            },
            "ConnectionAttempts": 3,
            "ConnectionTimeout": 10,
        },
        {
            "Id": API_ORIGIN_ID,
            "DomainName": api_domain,
            "OriginPath": "",
            "CustomHeaders": {"Quantity": 0},
            "CustomOriginConfig": {
                "HTTPPort": 80,
                "HTTPSPort": 443,
                "OriginProtocolPolicy": "https-only",
                "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
                "OriginReadTimeout": 30,
                "OriginKeepaliveTimeout": 5,
            },
            "ConnectionAttempts": 3,
            "ConnectionTimeout": 10,
        },
    ]


def behavior(path_pattern: str, target_origin_id: str) -> dict:
    return {
        "PathPattern": path_pattern,
        "TargetOriginId": target_origin_id,
        "TrustedSigners": {"Enabled": False, "Quantity": 0},
        "TrustedKeyGroups": {"Enabled": False, "Quantity": 0},
        "ViewerProtocolPolicy": "https-only",
        "AllowedMethods": {
            "Quantity": 7,
            "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
            "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
        },
        "SmoothStreaming": False,
        "Compress": True,
        "LambdaFunctionAssociations": {"Quantity": 0},
        "FunctionAssociations": {"Quantity": 0},
        "FieldLevelEncryptionId": "",
        "CachePolicyId": CACHING_DISABLED_POLICY_ID,
        "OriginRequestPolicyId": ALL_VIEWER_EXCEPT_HOST_HEADER_POLICY_ID,
        "GrpcConfig": {"Enabled": False},
    }


def describe(config: dict) -> None:
    for o in config["Origins"]["Items"]:
        print(f"    origin {o['Id']:<24} -> {o['DomainName']}")
    behaviors = [config["DefaultCacheBehavior"]] + config.get("CacheBehaviors", {}).get("Items", [])
    for b in behaviors:
        pattern = b.get("PathPattern", "(default)")
        print(f"    behavior {pattern:<20} -> {b['TargetOriginId']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--distribution-id", default=None,
                        help="Defaults to AWS_CLOUDFRONT_DISTRIBUTION_ID from .env.")
    parser.add_argument("--http-api-domain", default=None,
                        help="HTTP API domain (e.g. abc123.execute-api.us-east-1.amazonaws.com). "
                             "Skips the CloudFormation describe-stacks lookup — needed because the "
                             ".env IAM user used for CloudFront tooling isn't granted "
                             "cloudformation:DescribeStacks (by design: narrowly scoped).")
    parser.add_argument("--chat-function-url-domain", default=None,
                        help="Chat Lambda Function URL domain (e.g. xyz.lambda-url.us-east-1.on.aws). "
                             "See --http-api-domain.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Show the change without applying it.")
    group.add_argument("--apply", action="store_true", help="Apply the change.")
    args = parser.parse_args()

    import os
    distribution_id = args.distribution_id or os.getenv("AWS_CLOUDFRONT_DISTRIBUTION_ID")
    if not distribution_id:
        print("ERROR: set AWS_CLOUDFRONT_DISTRIBUTION_ID or pass --distribution-id", file=sys.stderr)
        return 1
    chat_origin_secret = os.getenv("CHAT_ORIGIN_SECRET")
    if not chat_origin_secret:
        print("ERROR: set CHAT_ORIGIN_SECRET in .env (shared secret with the chat Lambda)", file=sys.stderr)
        return 1

    if args.http_api_domain and args.chat_function_url_domain:
        api_domain = args.http_api_domain
        chat_domain = args.chat_function_url_domain
    else:
        outputs = stack_outputs()
        chat_domain = domain_of(outputs["ChatFunctionUrl"])
        api_domain = domain_of(outputs["HttpApiUrl"])
    print(f"chat Lambda Function URL : {chat_domain}")
    print(f"HTTP API (newsletter/submit): {api_domain}")

    cf = boto3.client("cloudfront")

    got = cf.get_distribution_config(Id=distribution_id)
    config, etag = got["DistributionConfig"], got["ETag"]
    print(f"\ndistribution {distribution_id}")
    print("  before:")
    describe(config)

    new_origins = build_origins(chat_domain, api_domain, chat_origin_secret)
    existing_ids = {o["Id"] for o in config["Origins"]["Items"]}
    kept_origins = [o for o in config["Origins"]["Items"] if o["Id"] not in {CHAT_ORIGIN_ID, API_ORIGIN_ID}]
    config["Origins"]["Items"] = kept_origins + new_origins
    config["Origins"]["Quantity"] = len(config["Origins"]["Items"])

    new_behaviors = [behavior("/api/chat", CHAT_ORIGIN_ID), behavior("/api/*", API_ORIGIN_ID)]
    kept_behaviors = [
        b for b in config.get("CacheBehaviors", {}).get("Items", [])
        if b.get("PathPattern") not in {"/api/chat", "/api/*"}
    ]
    # /api/chat must precede /api/* — CloudFront evaluates CacheBehaviors in list order.
    config["CacheBehaviors"] = {"Items": new_behaviors + kept_behaviors, "Quantity": len(new_behaviors) + len(kept_behaviors)}

    print("\n  after:")
    describe(config)
    if not existing_ids.isdisjoint({CHAT_ORIGIN_ID, API_ORIGIN_ID}):
        print("\n  (origins already present — this is an update, not a first-time add)")

    if args.dry_run:
        print("\ndry run — nothing changed")
        return 0

    try:
        result = cf.update_distribution(Id=distribution_id, IfMatch=etag, DistributionConfig=config)
    except (BotoCoreError, ClientError) as exc:
        print(f"ERROR: update failed: {exc}", file=sys.stderr)
        return 1

    print(f"\napplied — status {result['Distribution']['Status']}")
    print("Propagation takes a few minutes. Then verify:")
    print(f"  curl -X POST https://madewithwhat.net/api/newsletter -d '{{\"email\":\"you@example.com\",\"scope\":\"network\"}}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
