import scrapy


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
