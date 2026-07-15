from __future__ import annotations

from itemadapter import ItemAdapter

from . import db
from .items import (
    RepoItem,
    ShardCompleteItem,
    ShardFailedItem,
)


class PostgresPipeline:
    def open_spider(self, spider=None):
        self.conn = db.connect()

    def close_spider(self, spider=None):
        self.conn.close()

    def process_item(self, item, spider=None):
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
        return item
