from __future__ import annotations

from itemadapter import ItemAdapter

from . import db
from . import youtube_db
from .items import (
    RepoItem,
    ShardCompleteItem,
    ShardFailedItem,
    YoutubeRunCompleteItem,
    YoutubeRunFailedItem,
    YoutubeVideoItem,
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


class YoutubePipeline:
    def open_spider(self, spider=None):
        self.conn = youtube_db.connect()

    def close_spider(self, spider=None):
        self.conn.close()

    def process_item(self, item, spider=None):
        adapter = ItemAdapter(item)
        if isinstance(item, YoutubeVideoItem):
            youtube_db.upsert_video(self.conn, adapter["catalog_slug"], adapter["video"])
        elif isinstance(item, YoutubeRunCompleteItem):
            youtube_db.mark_run_completed(
                self.conn,
                adapter["catalog_slug"],
                adapter["query"],
                adapter["candidate_count"],
                adapter["accepted_count"],
            )
        elif isinstance(item, YoutubeRunFailedItem):
            youtube_db.mark_run_failed(self.conn, adapter["catalog_slug"], adapter["error"])
        return item
