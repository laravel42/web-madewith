import type { Theme } from "../config/domains";
import { DOMAINS, getResolvedTheme, GROUP_META, type DomainGroup } from "../config/domains";
import type { CatalogData, Project } from "./catalog";
import { getCatalog, rankedProjects } from "./catalog";

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
      const desc = `${p.desc} · ${p.stars.toLocaleString()} GitHub stars · by ${p.author}`;
      return `    <item>
      <title>${escapeXml(p.name)}</title>
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
      return `- [${p.name}](${link}): ${p.desc} (${p.stars.toLocaleString()} stars, ${p.category})`;
    }),
    "",
    "## Useful links",
    "",
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

/** RSS 2.0 feed aggregating top projects across the MadeWithWhat network. */
export function buildNetworkRssXml(site: URL, limit = 50): string {
  const base = new URL("/", site).href;
  const projects = networkProjectEntries()
    .sort((a, b) => b.project.stars - a.project.stars)
    .slice(0, limit);
  const updated = new Date(networkLatestScrapedAt()).toUTCString();
  const items = projects
    .map(({ domainSlug, techName, project: p }) => {
      const link = projectUrl(site, domainSlug, p);
      const desc = `${p.desc} · ${p.stars.toLocaleString()} GitHub stars · Made with ${techName} · by ${p.author}`;
      return `    <item>
      <title>${escapeXml(p.name)} (${escapeXml(techName)})</title>
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
    <title>MadeWithWhat network</title>
    <link>${escapeXml(base)}</link>
    <description>${escapeXml(NETWORK_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${updated}</lastBuildDate>
    <generator>MadeWithWhat catalog</generator>
${items}
  </channel>
</rss>`;
}

/** Plain-text llms.txt for the MadeWithWhat network homepage. */
export function buildNetworkLlmsTxt(site: URL, topLimit = 30, perDomainLimit = 5): string {
  const base = new URL("/", site).href;
  const groups: DomainGroup[] = ["frameworks", "frontend", "backend", "cms-crm", "commerce", "ai-llm"];
  const galleryLines: string[] = [];

  for (const group of groups) {
    const sites = DOMAINS.filter((d) => getResolvedTheme(d.slug).group === group);
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
  for (const theme of DOMAINS) {
    const resolved = getResolvedTheme(theme.slug);
    const data = getCatalog(resolved.slug);
    const top = rankedProjects(data).slice(0, perDomainLimit);
    if (!top.length) continue;
    perDomainHighlights.push(`### Made with ${resolved.techName}`, "");
    for (const p of top) {
      const link = projectUrl(site, resolved.slug, p);
      perDomainHighlights.push(`- [${p.name}](${link}): ${p.desc} (${p.stars.toLocaleString()} stars)`);
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
    `- Galleries: ${DOMAINS.length} technologies`,
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
      return `- [${p.name}](${link}): ${p.desc} (${p.stars.toLocaleString()} stars, Made with ${techName})`;
    }),
    "",
    "## Highlights by gallery",
    "",
    ...perDomainHighlights,
    "## Useful links",
    "",
    `- RSS feed: ${new URL("/rss.xml", site).href}`,
    `- Blog: ${new URL("/blog/", site).href}`,
    `- Blog RSS: ${new URL("/blog/rss.xml", site).href}`,
    `- Newsletter: ${new URL("/newsletter/", site).href}`,
    `- LLM context: ${new URL("/llm/", site).href}`,
    "",
    "## Optional",
    "",
    "Each gallery ranks open-source projects by GitHub stars for a specific technology. Project pages include description, stack, languages, license, and related projects.",
  ];
  return lines.join("\n");
}

/** RSS 2.0 feed for the MadeWithWhat blog. */
export function buildBlogRssXml(
  articles: Array<{ slug: string; title: string; description: string; date: string; category: string; primaryTechnology: string }>,
  site: URL,
): string {
  const base = new URL("/blog/", site).href;
  const feedUrl = new URL("/blog/rss.xml", site).href;
  const updated = articles[0]?.date
    ? new Date(`${articles[0].date}T09:00:00Z`).toUTCString()
    : new Date().toUTCString();

  const items = articles
    .map((article) => {
      const link = new URL(`/blog/${article.slug}/`, site).href;
      return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <description>${escapeXml(article.description)}</description>
      <category>${escapeXml(article.primaryTechnology)}</category>
      <pubDate>${new Date(`${article.date}T09:00:00Z`).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The MadeWithWhat Blog</title>
    <link>${escapeXml(base)}</link>
    <description>Guides, patterns and performance deep-dives across 69 web stacks.</description>
    <language>en-us</language>
    <lastBuildDate>${updated}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <generator>MadeWithWhat blog</generator>
${items}
  </channel>
</rss>`;
}
