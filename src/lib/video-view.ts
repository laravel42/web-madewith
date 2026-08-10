import { GROUP_META, getResolvedTheme, type DomainGroup } from "../config/domains";
import { blogTechFor } from "./blog-tech";
import { formatBlogDate } from "./blog-dates";
import { videoDisplayDescription, videoDisplayTitle, truncatePreviewText, stripIcons, videoDescriptionParagraphs } from "./preview-text";
import { allVideoEntries, type Video, type VideoEntry } from "./videos";

export interface VideoCardItem {
  slug: string;
  /** When the video entered our catalog (discovered_at); drives list order. */
  addedIso: string;
  href: string;
  title: string;
  excerpt: string;
  description: string;
  descriptionParagraphs: string[];
  chapters: VideoChapter[];
  techName: string;
  techSlug: string;
  /** Raw brand colour — fills, borders, gradient starts. Never text. */
  accent: string;
  accentInk: string;
  /** The accent as text on a light surface (tech labels, chapter timecodes). */
  accentOnLight: string;
  /** The accent as a solid surface carrying `accentInk` (avatars, watch button). */
  accentSolid: string;
  /** Light end of a cover gradient that white text sits on. */
  accentCover: string;
  galleryHref: string;
  group: DomainGroup;
  groupLabel: string;
  channel: string;
  channelInitial: string;
  views: number;
  viewsLabel: string;
  dateIso: string;
  dateLabel: string;
  duration: string;
  durationSeconds: number;
  kind: string;
  thumbnail: string;
  videoUrl: string;
  videoId: string;
}

export function slugifyVideo(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable, readable, unique per-video slug (title + YouTube id tail). */
export function videoSlug(v: Video): string {
  const base = slugifyVideo(v.title).slice(0, 60).replace(/-+$/, "");
  return `${base || "video"}-${v.id}`;
}

/** 218_000 -> "218K", 1_400_000 -> "1.4M". */
export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Coarse content type derived from runtime — gives cards a bit of variety. */
export function videoKind(seconds: number): string {
  if (seconds <= 15 * 60) return "Clip";
  if (seconds <= 45 * 60) return "Tutorial";
  if (seconds <= 90 * 60) return "Talk";
  return "Deep-dive";
}

/** Seconds -> ISO 8601 duration for schema.org VideoObject (e.g. PT1H42M10S). */
export function isoDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let out = "PT";
  if (h) out += `${h}H`;
  if (m) out += `${m}M`;
  if (sec || (!h && !m)) out += `${sec}S`;
  return out;
}

export interface VideoChapter {
  /** Display label, e.g. "1:18:05". */
  time: string;
  seconds: number;
  label: string;
}

/** Seconds -> compact timestamp: "0:00", "6:40", "1:18:05". */
function formatTimestamp(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Leading timestamp on a line: optional H:, then M:SS. */
const CHAPTER_LINE = /^[\s\-–—•·*]*\(?\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\)?\s*[-–—:|)\].]*\s*(.+)$/;

function timestampToSeconds(ts: string): number {
  const parts = ts.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return -1;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Parse YouTube-style chapters from a raw description. Any line beginning with
 * a timestamp counts; we surface the list whenever there are >= 2 of them.
 */
export function parseChapters(description: string, durationSeconds = 0): VideoChapter[] {
  if (!description) return [];
  const out: VideoChapter[] = [];
  const seen = new Set<number>();
  for (const rawLine of description.split(/\r?\n/)) {
    const match = rawLine.trim().match(CHAPTER_LINE);
    if (!match) continue;
    const seconds = timestampToSeconds(match[1]);
    if (seconds < 0) continue;
    if (durationSeconds && seconds > durationSeconds + 5) continue;
    if (seen.has(seconds)) continue;
    const label = stripIcons(match[2]).replace(/^[\s\-–—:|)\].]+/, "").trim();
    if (!label) continue;
    seen.add(seconds);
    out.push({ time: formatTimestamp(seconds), seconds, label });
  }
  out.sort((a, b) => a.seconds - b.seconds);
  if (out.length < 2) return [];
  return out;
}

function toItem(entry: VideoEntry): VideoCardItem {
  const { domainSlug, techName, video } = entry;
  const theme = getResolvedTheme(domainSlug);
  const tech = blogTechFor(techName);
  const group = theme.group;
  const slug = videoSlug(video);
  return {
    slug,
    href: `/video/${slug}/`,
    title: videoDisplayTitle(video.title, video.description, techName),
    excerpt: truncatePreviewText(videoDisplayDescription(video.description, video.title), 130),
    description: videoDisplayDescription(video.description, video.title),
    descriptionParagraphs: videoDescriptionParagraphs(video.description, video.title),
    chapters: parseChapters(video.description, video.durationSeconds),
    techName,
    techSlug: tech.slug,
    accent: tech.accent,
    accentInk: tech.accentInk,
    accentOnLight: tech.accentOnLight,
    accentSolid: tech.accentSolid,
    accentCover: tech.accentCover,
    galleryHref: tech.galleryHref,
    group,
    groupLabel: GROUP_META[group].label,
    channel: video.channel,
    channelInitial: (video.channel || "?").charAt(0).toUpperCase(),
    views: video.views,
    viewsLabel: formatViews(video.views),
    dateIso: video.publishedAt,
    addedIso: video.discoveredAt ?? video.publishedAt,
    dateLabel: formatBlogDate(video.publishedAt),
    duration: video.duration,
    durationSeconds: video.durationSeconds,
    kind: videoKind(video.durationSeconds),
    thumbnail: video.thumbnail,
    videoUrl: video.url,
    videoId: video.id,
  };
}

let CARDS: VideoCardItem[] | null = null;

/** Every relevant video as a card item, newest first. */
export function allVideoCards(): VideoCardItem[] {
  if (!CARDS) {
    CARDS = allVideoEntries()
      .map(toItem)
      // Newest in OUR catalog first: a decade-old classic scraped today should
      // lead, so sort by when we discovered it, not the YouTube publish date.
      .sort((a, b) => Date.parse(b.addedIso) - Date.parse(a.addedIso) || Date.parse(b.dateIso) - Date.parse(a.dateIso));
  }
  return CARDS;
}

/** Videos for one stack slug (e.g. "laravel"), newest first. */
export function videoCardsForDomain(techSlug: string): VideoCardItem[] {
  return allVideoCards().filter((c) => c.techSlug === techSlug);
}

export interface VideoGroupChip {
  group: DomainGroup;
  label: string;
  icon: string;
  color: string;
  /** AA-safe label colour; `color` only tints the chip background. */
  ink: string;
  count: number;
}

/** Group filter chips (only groups that actually have videos), network order. */
export function videoGroupChips(items: VideoCardItem[]): VideoGroupChip[] {
  const order: DomainGroup[] = ["frameworks", "frontend", "backend", "cms-crm", "commerce", "ai-llm"];
  return order
    .map((group) => ({
      group,
      label: GROUP_META[group].label,
      icon: GROUP_META[group].icon,
      color: GROUP_META[group].color,
      ink: GROUP_META[group].ink,
      count: items.filter((i) => i.group === group).length,
    }))
    .filter((g) => g.count > 0);
}

export interface VideoDetail {
  item: VideoCardItem;
  related: VideoCardItem[];
}

export function getVideoDetail(slug: string): VideoDetail | null {
  const all = allVideoCards();
  const item = all.find((c) => c.slug === slug);
  if (!item) return null;
  const sameTech = all.filter((c) => c.slug !== slug && c.techName === item.techName);
  const sameGroup = all.filter((c) => c.slug !== slug && c.group === item.group && c.techName !== item.techName);
  const related = [...sameTech, ...sameGroup].slice(0, 6);
  return { item, related };
}
