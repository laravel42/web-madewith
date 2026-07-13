import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

BOT_NAME = "madewith_scraper"

SPIDER_MODULES = ["madewith_scraper.spiders"]
NEWSPIDER_MODULE = "madewith_scraper.spiders"

ROBOTSTXT_OBEY = False

CONCURRENT_REQUESTS = 1
DOWNLOAD_DELAY = 5
RANDOMIZE_DOWNLOAD_DELAY = True

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 5
AUTOTHROTTLE_MAX_DELAY = 60
AUTOTHROTTLE_TARGET_CONCURRENCY = 0.5

RETRY_ENABLED = True
RETRY_TIMES = 6
RETRY_HTTP_CODES = [403, 429, 500, 502, 503, 504]

LOG_LEVEL = os.environ.get("SCRAPY_LOG_LEVEL", "INFO")

ITEM_PIPELINES = {
    "madewith_scraper.pipelines.PostgresPipeline": 300,
}

DEFAULT_REQUEST_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "madewith-scrapy-github",
}

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
