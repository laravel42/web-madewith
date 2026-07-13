import rules from "../config/video-relevance.json";

export interface VideoLike {
  title: string;
  description: string;
  channel?: string;
}

function compile(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function techPatterns(slug: string, techName: string): RegExp[] {
  const aliases = (rules.techAliases as Record<string, string[]>)[slug] ?? [];
  const raw = [techName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ...aliases, slug.replace(/-/g, "[ -]?")];
  return raw.map((pattern) => new RegExp(pattern, "i"));
}

function videoHaystack(video: VideoLike): string {
  return `${video.title} ${video.description.slice(0, 1200)} ${video.channel ?? ""}`.toLowerCase();
}

export function isRelevantVideo(slug: string, techName: string, video: VideoLike): boolean {
  const hay = videoHaystack(video);
  const globalReject = compile(rules.globalReject);
  if (matchesAny(globalReject, hay)) return false;

  const strict = (rules.strictSlugs as Record<string, { reject?: string[]; requireAny?: string[] }>)[slug];
  if (strict) {
    if (strict.reject && matchesAny(compile(strict.reject), hay)) return false;
    if (strict.requireAny && !matchesAny(compile(strict.requireAny), hay)) return false;
    return true;
  }

  if (!matchesAny(techPatterns(slug, techName), hay)) return false;
  if (!matchesAny(compile(rules.programmingContext), hay)) return false;
  return true;
}

export function filterRelevantVideos<T extends VideoLike>(slug: string, techName: string, videos: T[]): T[] {
  return videos.filter((video) => isRelevantVideo(slug, techName, video));
}
