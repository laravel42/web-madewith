import type { Theme } from "../config/domains";
import { DOMAINS, getResolvedTheme, GROUP_META, NETWORK_DOMAINS, type DomainGroup } from "../config/domains";
import type { CatalogData, Project } from "./catalog";
import { getCatalog, rankedProjects } from "./catalog";
import {
  englishDisplayText,
  projectDisplayName,
  projectPreviewExcerpt,
  videoDisplayDescription,
  videoDisplayTitle,
} from "./preview-text";
import { allVideoEntries, latestVideoScrapedAt, type VideoEntry } from "./videos";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function projectUrl(site: URL, slug: string, project: Project): string {
  return new URL(`/${slug}/project/${project.slug}/`, site).href;
}

function catalogUrl(site: URL, slug: string): string {
  return new URL(`/${slug}/`, site).href;
}

/** RSS 2.0 feed for the top projects in a domain catalog. */
export function buildRssXml(theme: Theme, data: CatalogData, site: URL, limit = 50): string {
  const base = catalogUrl(site, theme.slug);
  const projects = rankedProjects(data).slice(0, limit);
  const updated = new Date(data.scrapedAt).toUTCString();
  const items = projects
    .map((p) => {
      const link = projectUrl(site, theme.slug, p);
      const name = projectDisplayName(p);
      const desc = `${projectPreviewExcerpt(p)} · ${p.stars.toLocaleString()} GitHub stars · by ${p.author}`;
      return `    <item>
      <title>${escapeXml(name)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(desc)}</description>
      <category>${escapeXml(p.category)}</category>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Made with ${escapeXml(theme.techName)}</title>
    <link>${escapeXml(base)}</link>
    <description>${escapeXml(theme.seoDescription)}</description>
    <language>en</language>
    <lastBuildDate>${updated}</lastBuildDate>
    <generator>MadeWithWhat catalog</generator>
${items}
  </channel>
</rss>`;
}

/** Plain-text llms.txt body for AI agents and crawlers. */
export function buildLlmsTxt(theme: Theme, data: CatalogData, site: URL, limit = 30): string {
  const base = catalogUrl(site, theme.slug);
  const projects = rankedProjects(data).slice(0, limit);
  const lines = [
    `# Made with ${theme.techName}`,
    "",
    `> ${theme.seoDescription}`,
    "",
    "## About",
    "",
    `- Gallery: ${base}`,
    `- Domain: ${theme.domain}`,
    `- Projects indexed: ${data.projects.length.toLocaleString()}`,
    `- Data source: GitHub (refreshed daily)`,
    `- Last scraped: ${data.scrapedAt}`,
    "",
    "## Top projects",
    "",
    ...projects.map((p) => {
      const link = projectUrl(site, theme.slug, p);
      return `- [${projectDisplayName(p)}](${link}): ${projectPreviewExcerpt(p)} (${p.stars.toLocaleString()} stars, ${p.category})`;
    }),
    "",
    "## Useful links",
    "",
    `- Full catalog, all ${data.projects.length.toLocaleString()} projects by category: ${new URL(`/${theme.slug}/llms-full.txt`, site).href}`,
    `- RSS feed: ${new URL(`/${theme.slug}/rss.xml`, site).href}`,
    `- Submit a project: ${new URL(`/${theme.slug}/submit/`, site).href}`,
    `- Browse categories: ${new URL(`/${theme.slug}/categories/`, site).href}`,
    `- Newsletter: ${new URL(`/${theme.slug}/newsletter/`, site).href}`,
    "",
    "## Optional",
    "",
    "This catalog ranks open-source projects by GitHub stars. Each project page includes description, stack, languages, license, and related projects.",
  ];
  return lines.join("\n");
}

/**
 * Exhaustive llms-full.txt: every indexed project, grouped by category.
 * The curated llms.txt above stays the small table-of-contents an AI crawler
 * can hold in context; this file is the long-tail surface — answer engines
 * can only cite entries that appear somewhere, and >95% of the catalog sits
 * below the top-30 cut.
 */
export function buildLlmsFullTxt(theme: Theme, data: CatalogData, site: URL): string {
  const base = catalogUrl(site, theme.slug);
  const ranked = rankedProjects(data);
  const byCategory = new Map<string, Project[]>();
  for (const p of ranked) {
    const list = byCategory.get(p.category);
    if (list) list.push(p);
    else byCategory.set(p.category, [p]);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  const lines = [
    `# Made with ${theme.techName} — full catalog`,
    "",
    `> ${theme.seoDescription}`,
    "",
    "## About",
    "",
    `- Gallery: ${base}`,
    `- Curated summary: ${new URL(`/${theme.slug}/llms.txt`, site).href}`,
    `- Projects indexed: ${data.projects.length.toLocaleString()}`,
    `- Data source: GitHub (refreshed daily)`,
    `- Last scraped: ${data.scrapedAt}`,
    "",
    ...categories.flatMap(([category, projects]) => [
      `## ${category} (${projects.length.toLocaleString()})`,
      "",
      ...projects.map((p) => {
        const link = projectUrl(site, theme.slug, p);
        const license = p.license && p.license !== "—" ? `, ${p.license}` : "";
        return `- [${projectDisplayName(p)}](${link}): ${projectPreviewExcerpt(p)} (${p.stars.toLocaleString()} stars${license})`;
      }),
      "",
    ]),
  ];
  return lines.join("\n");
}

export interface NetworkProjectEntry {
  domainSlug: string;
  techName: string;
  project: Project;
}

export function networkProjectEntries(): NetworkProjectEntry[] {
  const entries: NetworkProjectEntry[] = [];
  for (const theme of DOMAINS) {
    const resolved = getResolvedTheme(theme.slug);
    const data = getCatalog(resolved.slug);
    for (const project of rankedProjects(data)) {
      entries.push({ domainSlug: resolved.slug, techName: resolved.techName, project });
    }
  }
  return entries;
}

export function networkLatestScrapedAt(): string {
  let latest = "";
  for (const theme of DOMAINS) {
    const scrapedAt = getCatalog(theme.slug).scrapedAt;
    if (!latest || scrapedAt > latest) latest = scrapedAt;
  }
  return latest;
}

const NETWORK_DESCRIPTION =
  "A network of daily-updated showcase galleries of the best open-source projects — React, Vue, Laravel, Django, WordPress, Shopify and more — ranked by GitHub stars.";

function rssChannel(
  title: string,
  link: string,
  description: string,
  updated: string,
  selfUrl: string | null,
  items: string,
): string {
  const atomSelf = selfUrl
    ? `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${updated}</lastBuildDate>
${atomSelf}    <generator>MadeWithWhat</generator>
${items}
  </channel>
</rss>`;
}

/** RSS 2.0 feed for open-source projects across every stack. */
export function buildProjectsRssXml(site: URL, limit = 100): string {
  const base = new URL("/", site).href;
  const feedUrl = new URL("/projects/rss.xml", site).href;
  const projects = networkProjectEntries()
    .sort((a, b) => b.project.stars - a.project.stars)
    .slice(0, limit);
  const updated = new Date(networkLatestScrapedAt()).toUTCString();
  const items = projects
    .map(({ domainSlug, techName, project: p }) => {
      const link = projectUrl(site, domainSlug, p);
      const name = projectDisplayName(p);
      const desc = `${projectPreviewExcerpt(p)} · ${p.stars.toLocaleString()} GitHub stars · by ${p.author}`;
      return `    <item>
      <title>${escapeXml(name)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(desc)}</description>
      <category>${escapeXml(techName)}</category>
    </item>`;
    })
    .join("\n");

  return rssChannel(
    "MadeWithWhat projects",
    base,
    "Open-source projects from every MadeWith gallery, tagged by stack.",
    updated,
    feedUrl,
    items,
  );
}

/** RSS 2.0 feed aggregating top projects across the MadeWithWhat network. */
export function buildNetworkRssXml(site: URL, limit = 50): string {
  return buildProjectsRssXml(site, limit);
}

/** Plain-text llms.txt for the MadeWithWhat network homepage. */
export function buildNetworkLlmsTxt(site: URL, topLimit = 30, perDomainLimit = 5): string {
  const base = new URL("/", site).href;
  const groups: DomainGroup[] = ["frameworks", "frontend", "backend", "cms-crm", "commerce", "ai-llm"];
  const galleryLines: string[] = [];

  for (const group of groups) {
    const sites = NETWORK_DOMAINS.filter((d) => getResolvedTheme(d.slug).group === group);
    if (!sites.length) continue;
    galleryLines.push(`### ${GROUP_META[group].label}`, "");
    for (const theme of sites) {
      const resolved = getResolvedTheme(theme.slug);
      const data = getCatalog(resolved.slug);
      const url = catalogUrl(site, resolved.slug);
      galleryLines.push(`- [Made with ${resolved.techName}](${url}): ${data.projects.length.toLocaleString()} projects · ${resolved.domain}`);
    }
    galleryLines.push("");
  }

  const topProjects = networkProjectEntries()
    .sort((a, b) => b.project.stars - a.project.stars)
    .slice(0, topLimit);

  const perDomainHighlights: string[] = [];
  for (const theme of NETWORK_DOMAINS) {
    const resolved = getResolvedTheme(theme.slug);
    const data = getCatalog(resolved.slug);
    const top = rankedProjects(data).slice(0, perDomainLimit);
    if (!top.length) continue;
    perDomainHighlights.push(`### Made with ${resolved.techName}`, "");
    for (const p of top) {
      const link = projectUrl(site, resolved.slug, p);
      perDomainHighlights.push(`- [${projectDisplayName(p)}](${link}): ${projectPreviewExcerpt(p)} (${p.stars.toLocaleString()} stars)`);
    }
    perDomainHighlights.push("");
  }

  const lines = [
    "# MadeWithWhat network",
    "",
    `> ${NETWORK_DESCRIPTION}`,
    "",
    "## About",
    "",
    `- Network home: ${base}`,
    `- Galleries: ${NETWORK_DOMAINS.length} technologies`,
    `- Data source: GitHub (refreshed daily)`,
    `- Last scraped: ${networkLatestScrapedAt()}`,
    "",
    "## Galleries",
    "",
    ...galleryLines,
    "## Top projects (network-wide)",
    "",
    ...topProjects.map(({ domainSlug, techName, project: p }) => {
      const link = projectUrl(site, domainSlug, p);
      return `- [${projectDisplayName(p)}](${link}): ${projectPreviewExcerpt(p)} (${p.stars.toLocaleString()} stars, Made with ${techName})`;
    }),
    "",
    "## Highlights by gallery",
    "",
    ...perDomainHighlights,
    "## Useful links",
    "",
    `- Projects RSS: ${new URL("/projects/rss.xml", site).href}`,
    `- Articles RSS: ${new URL("/articles/rss.xml", site).href}`,
    `- Video RSS: ${new URL("/video/rss.xml", site).href}`,
    `- Blog: ${new URL("/blog/", site).href}`,
    `- Newsletter: ${new URL("/newsletter/", site).href}`,
    `- LLM context: ${new URL("/llm/", site).href}`,
    "",
    "## Optional",
    "",
    "Each gallery ranks open-source projects by GitHub stars for a specific technology. Project pages include description, stack, languages, license, and related projects.",
    "Every gallery also publishes a curated /<slug>/llms.txt and an exhaustive /<slug>/llms-full.txt listing all of its indexed projects by category.",
  ];
  return lines.join("\n");
}

/** RSS 2.0 feed for blog articles across every stack. */
export function buildArticlesRssXml(
  articles: Array<{ slug: string; title: string; description: string; date: string; category: string; primaryTechnology: string }>,
  site: URL,
): string {
  const base = new URL("/blog/", site).href;
  const feedUrl = new URL("/articles/rss.xml", site).href;
  const updated = articles[0]?.date
    ? new Date(`${articles[0].date}T09:00:00Z`).toUTCString()
    : new Date().toUTCString();

  const items = articles
    .map((article) => {
      const link = new URL(`/blog/${article.slug}/`, site).href;
      const title = englishDisplayText(article.title, article.description);
      const description = englishDisplayText(article.description, article.title);
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(description)}</description>
      <category>${escapeXml(article.primaryTechnology)}</category>
      <pubDate>${new Date(`${article.date}T09:00:00Z`).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  return rssChannel(
    "MadeWithWhat articles",
    base,
    "Guides, comparisons, and deep-dives across every stack in the network.",
    updated,
    feedUrl,
    items,
  );
}

/** @deprecated Use buildArticlesRssXml */
export function buildBlogRssXml(
  articles: Parameters<typeof buildArticlesRssXml>[0],
  site: URL,
): string {
  return buildArticlesRssXml(articles, site);
}

/** RSS 2.0 feed for YouTube videos across every stack. */
export function buildVideosRssXml(site: URL, limit = 100): string {
  const base = new URL("/", site).href;
  const feedUrl = new URL("/video/rss.xml", site).href;
  const videos = allVideoEntries()
    .sort((a, b) => Date.parse(b.video.publishedAt) - Date.parse(a.video.publishedAt))
    .slice(0, limit);
  const updated = new Date(latestVideoScrapedAt()).toUTCString();
  const items = videos
    .map(({ techName, video }: VideoEntry) => {
      const title = videoDisplayTitle(video.title, video.description, techName);
      const desc = `${videoDisplayDescription(video.description, video.title).slice(0, 280)} · ${video.channel} · ${video.views.toLocaleString()} views`;
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(video.url)}</link>
      <guid isPermaLink="true">${escapeXml(video.url)}</guid>
      <description>${escapeXml(desc)}</description>
      <category>${escapeXml(techName)}</category>
      <pubDate>${new Date(video.publishedAt).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  return rssChannel(
    "MadeWithWhat video",
    base,
    "Curated YouTube tutorials and talks for every stack in the network.",
    updated,
    feedUrl,
    items,
  );
}
