from __future__ import annotations

import logging

import psycopg
from itemadapter import ItemAdapter
from scrapy.exceptions import DropItem

from . import db
from .items import (
    RepoItem,
    ShardCompleteItem,
    ShardFailedItem,
)

logger = logging.getLogger(__name__)


class PostgresPipeline:
    def open_spider(self, spider=None):
        self.conn = db.connect()

    def close_spider(self, spider=None):
        conn = getattr(self, "conn", None)
        if conn is not None and not conn.closed:
            conn.close()

    def process_item(self, item, spider=None):
        try:
            self._write(item)
        except psycopg.Error as exc:
            # Roll back (and reconnect if the connection died) so one bad item
            # doesn't leave the shared connection in an aborted transaction —
            # otherwise every later item fails with InFailedSqlTransaction.
            self._recover()
            logger.error("DB write failed for %s: %s", self._item_label(item), exc)
            raise DropItem(f"db write failed: {exc}") from exc
        return item

    def _write(self, item):
        adapter = ItemAdapter(item)
        if isinstance(item, RepoItem):
            db.upsert_repository(self.conn, adapter["catalog_slug"], adapter["repo"])
        elif isinstance(item, ShardCompleteItem):
            db.mark_shard_completed(
                self.conn,
                adapter["catalog_slug"],
                adapter["shard_id"],
                adapter["query"],
                adapter["total"],
                adapter["repo_count"],
            )
        elif isinstance(item, ShardFailedItem):
            db.mark_shard_failed(self.conn, adapter["catalog_slug"], adapter["shard_id"], adapter["error"])

    def _recover(self):
        try:
            self.conn.rollback()
        except psycopg.Error:
            pass
        if self.conn.closed:
            self.conn = db.connect()

    @staticmethod
    def _item_label(item) -> str:
        adapter = ItemAdapter(item)
        if isinstance(item, RepoItem):
            repo = adapter.get("repo") or {}
            return f"repo {repo.get('full_name')!r} ({adapter.get('catalog_slug')})"
        return f"{type(item).__name__} {adapter.get('catalog_slug')}:{adapter.get('shard_id')}"
