import scrapy

class RepoItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    repo = scrapy.Field()

class ShardCompleteItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    shard_id = scrapy.Field()
    query = scrapy.Field()
    total = scrapy.Field()
    repo_count = scrapy.Field()

class ShardFailedItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    shard_id = scrapy.Field()
    error = scrapy.Field()
