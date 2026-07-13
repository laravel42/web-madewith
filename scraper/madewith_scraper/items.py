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


class YoutubeVideoItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    video = scrapy.Field()


class YoutubeRunCompleteItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    query = scrapy.Field()
    candidate_count = scrapy.Field()
    accepted_count = scrapy.Field()


class YoutubeRunFailedItem(scrapy.Item):
    catalog_slug = scrapy.Field()
    error = scrapy.Field()
