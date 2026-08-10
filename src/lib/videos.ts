import { filterRelevantVideos, isRelevantVideo } from "./video-relevance";

export interface Video {
  id: string;
  title: string;
  description: string;
  channel: string;
  channelUrl: string;
  url: string;
  thumbnail: string;
  publishedAt: string;
  /** When the video entered the catalog (DB discovered_at); absent on old datasets. */
  discoveredAt?: string;
  duration: string;
  durationSeconds: number;
  views: number;
  likes: number;
  qualityScore: number;
  definition: string;
}

export interface VideoCatalog {
  slug: string;
  techName: string;
  scrapedAt: string;
  source: string;
  videoCount: number;
  videos: Video[];
}

const files = import.meta.glob<VideoCatalog>("../data/videos/*.json", {
  eager: true,
  import: "default",
});

const BY_SLUG: Record<string, VideoCatalog> = {};
for (const path in files) {
  const data = files[path];
  const videos = filterRelevantVideos(data.slug, data.techName, data.videos);
  BY_SLUG[data.slug] = {
    ...data,
    videos,
    videoCount: videos.length,
  };
}

export function getVideoCatalog(slug: string): VideoCatalog {
  const data = BY_SLUG[slug];
  if (!data) throw new Error(`No video data for "${slug}".`);
  return data;
}

export interface VideoEntry {
  domainSlug: string;
  techName: string;
  video: Video;
}

export function allVideoEntries(): VideoEntry[] {
  const entries: VideoEntry[] = [];
  for (const catalog of Object.values(BY_SLUG)) {
    for (const video of catalog.videos) {
      if (!isRelevantVideo(catalog.slug, catalog.techName, video)) continue;
      entries.push({ domainSlug: catalog.slug, techName: catalog.techName, video });
    }
  }
  return entries;
}

export function videoCount(): number {
  return allVideoEntries().length;
}

export function latestVideoScrapedAt(): string {
  let latest = "";
  for (const catalog of Object.values(BY_SLUG)) {
    if (!latest || catalog.scrapedAt > latest) latest = catalog.scrapedAt;
  }
  return latest;
}
