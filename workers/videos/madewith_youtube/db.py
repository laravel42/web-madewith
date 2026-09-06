"""Minimal database helper shared by the YouTube persistence layer."""
from __future__ import annotations

import os

from dotenv import load_dotenv


def database_url() -> str:
    load_dotenv()
    return os.environ.get("SCRAPE_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
