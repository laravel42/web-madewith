import { GitHub } from "./github";
import { classify } from "./classify";
import { qualityScore } from "./score";
import { DOMAINS, STAR_PARTITIONS, type DomainDiscovery } from "./domains";

export interface Lang { name: string; pct: number; }
export interface Project {
  githubId: number;
  slug: string; name: string; fullName: string; category: string;
  stars: number; author: string; avatar: string; desc: string;
  demo: string | null; repoUrl: string; long1: string; long2: string;
  stack: string[]; updated: string; license: string; langs: Lang[];
  topics: string[]; score: number;
  /** Set by editorial overrides at publish time. */
  featured?: boolean;
}
export interface DomainDataset {
  slug: string; scrapedAt: string; source: string; totalRepos: number; projects: Project[];
}

const SEARCH = `
query($q: String!, $n: Int!) {
  search(query: $q, type: REPOSITORY, first: $n) {
    repositoryCount
    nodes { ... on Repository {
      databaseId name nameWithOwner description stargazerCount homepageUrl url
      isFork isArchived pushedAt
      owner { login avatarUrl }
      licenseInfo { spdxId }
      primaryLanguage { name }
      repositoryTopics(first: 12) { nodes { topic { name } } }
      languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name } } }
    } }
  }
}`;

interface RepoNode {
  databaseId: number; name: string; nameWithOwner: string; description: string | null;
  stargazerCount: number; homepageUrl: string | null; url: string;
  isFork: boolean; isArchived: boolean; pushedAt: string | null;
  owner: { login: string; avatarUrl: string };
  licenseInfo: { spdxId: string | null } | null;
  primaryLanguage: { name: string } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
  languages: { totalSize: number; edges: Array<{ size: number; node: { name: string } }> };
}

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "recently";
  const days = Math.max(0, Math.round((now - Date.parse(iso)) / 86_400_000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.round(days / 365)} year${days < 730 ? "" : "s"} ago`;
}

function stackFrom(node: RepoNode): string[] {
  const skip = new Set(["hacktoberfest", "javascript", "typescript"]);
  const pretty: Record<string, string> = { nextjs: "Next.js", nuxtjs: "Nuxt", nodejs: "Node", vuejs: "Vue", reactjs: "React", tailwindcss: "Tailwind CSS", graphql: "GraphQL" };
  const topics = node.repositoryTopics?.nodes?.map((t) => t.topic.name) ?? [];
  const chips = topics.filter((t) => !skip.has(t)).slice(0, 4)
    .map((t) => pretty[t] || t.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
  const lang = node.primaryLanguage?.name;
  if (lang && !chips.some((c) => c.toLowerCase() === lang.toLowerCase())) chips.unshift(lang);
  return chips.slice(0, 5);
}

function languages(node: RepoNode): Lang[] {
  const total = node.languages?.totalSize || 0;
  let langs = (node.languages?.edges ?? []).map((e) => ({ name: e.node.name, pct: total ? Math.round((e.size / total) * 100) : 0 })).slice(0, 3);
  if (!langs.length) {
    const l = node.primaryLanguage?.name || "JavaScript";
    return [{ name: l, pct: 72 }, { name: l === "TypeScript" ? "JavaScript" : "CSS", pct: 20 }, { name: "Other", pct: 8 }];
  }
  const drift = 100 - langs.reduce((s, l) => s + l.pct, 0);
  langs[0].pct += drift;
  return langs;
}

function longCopy(node: RepoNode) {
  const desc = (node.description || "").trim().replace(/\s+/g, " ");
  const base = desc ? (desc.endsWith(".") ? desc : desc + ".") : "An open-source project built with a modern stack.";
  const topicPhrase = (node.repositoryTopics?.nodes ?? []).slice(0, 3).map((t) => t.topic.name).join(", ");
  return {
    long1: `${base} Maintained by ${node.owner.login} on GitHub, where it has earned ${node.stargazerCount.toLocaleString()} stars from the community.`,
    long2: topicPhrase
      ? `It's actively developed around ${topicPhrase}, and is a solid reference for anyone building with these tools.`
      : `It's actively developed and a solid reference for anyone building on this stack.`,
  };
}

function normalise(node: RepoNode, now: number): Project {
  const topics = node.repositoryTopics?.nodes?.map((t) => t.topic.name) ?? [];
  const { long1, long2 } = longCopy(node);
  return {
    githubId: node.databaseId,
    slug: node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || String(node.databaseId),
    name: node.name,
    fullName: node.nameWithOwner,
    category: classify({ topics, description: node.description, name: node.name }),
    stars: node.stargazerCount,
    author: node.owner.login,
    avatar: node.owner.avatarUrl,
    desc: (node.description || "A project worth exploring.").trim(),
    demo: node.homepageUrl && /^https?:\/\//.test(node.homepageUrl) ? node.homepageUrl : null,
    repoUrl: node.url,
    long1, long2,
    stack: stackFrom(node),
    updated: relativeTime(node.pushedAt, now),
    license: node.licenseInfo?.spdxId && node.licenseInfo.spdxId !== "NOASSERTION" ? node.licenseInfo.spdxId : "—",
    langs: languages(node),
    topics,
    score: qualityScore({
      stars: node.stargazerCount, pushedAt: node.pushedAt, hasHomepage: !!node.homepageUrl,
      hasLicense: !!node.licenseInfo?.spdxId, topicCount: topics.length, hasDescription: !!node.description,
    }, now),
  };
}

/** Hard noise is never acceptable — forks, archived, the framework's own core repo. */
function hardNoise(node: RepoNode, domain: DomainDiscovery): boolean {
  const excl = new Set(domain.exclude.map((s) => s.toLowerCase()));
  return (
    node.isFork || node.isArchived ||
    excl.has(node.nameWithOwner.toLowerCase()) ||
    node.name.toLowerCase() === domain.slug
  );
}

/** Soft noise (awesome-list link repos) is dropped when possible, relaxed only for tiny ecosystems. */
function softNoise(node: RepoNode): boolean {
  return /^awesome[-_]/.test(node.name.toLowerCase()) || (node.repositoryTopics?.nodes?.some((t) => t.topic.name === "awesome-list") ?? false);
}

/**
 * Discover a domain's top projects by walking star partitions (largest first)
 * and stopping once we have a comfortable candidate pool. Dedupe by GitHub
 * database id — the stable external identifier the resume rules call for.
 */
export async function scrapeDomain(gh: GitHub, domain: DomainDiscovery, now: number): Promise<DomainDataset> {
  const byId = new Map<number, RepoNode>();

  // Ecosystem headline count via REST search — ETag-cached, so the (rarely
  // changing) total returns a free 304 on most runs and burns no quota.
  let total = 0;
  try {
    const cnt = await gh.rest<{ total_count: number }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(domain.match)}&per_page=1`,
      `count:${domain.slug}`,
    );
    total = cnt.data.total_count;
  } catch { /* non-fatal — fall back to candidate count below */ }

  for (const [lo, hi] of STAR_PARTITIONS) {
    const stars = hi == null ? `stars:>=${lo}` : `stars:${lo}..${hi}`;
    const q = `${domain.match} ${stars} sort:stars-desc`;
    const { search } = await gh.graphql<{ search: { repositoryCount: number; nodes: RepoNode[] } }>(SEARCH, { q, n: 100 });
    for (const node of search.nodes) if (node?.databaseId) byId.set(node.databaseId, node);
    // Enough high-quality candidates from big partitions → skip the long tail.
    const usable = [...byId.values()].filter((n) => !hardNoise(n, domain) && !softNoise(n)).length;
    if (usable >= domain.keep * 2) break;
  }

  // Forks / archived / framework-core are always excluded; awesome-lists only
  // when enough real projects remain (tiny ecosystems relax that rule).
  const pool = [...byId.values()].filter((n) => !hardNoise(n, domain));
  let candidates = pool.filter((n) => !softNoise(n));
  if (candidates.length < 6) candidates = pool;

  const projects = candidates
    .map((n) => normalise(n, now))
    .sort((a, b) => b.score - a.score || b.stars - a.stars)
    .slice(0, domain.keep);

  return {
    slug: domain.slug,
    scrapedAt: new Date(now).toISOString(),
    source: "github-graphql",
    totalRepos: total || candidates.length,
    projects,
  };
}

export async function scrapeAll(gh: GitHub, now: number): Promise<Record<string, DomainDataset>> {
  const out: Record<string, DomainDataset> = {};
  for (const domain of DOMAINS) out[domain.slug] = await scrapeDomain(gh, domain, now);
  return out;
}

const REPO_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    databaseId name nameWithOwner description stargazerCount homepageUrl url
    isFork isArchived pushedAt
    owner { login avatarUrl }
    licenseInfo { spdxId }
    primaryLanguage { name }
    repositoryTopics(first: 12) { nodes { topic { name } } }
    languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name } } }
  }
}`;

/** Fetch + normalise a single repo (used when an admin approves a submission). */
export async function scrapeRepo(gh: GitHub, owner: string, name: string, now: number): Promise<Project | null> {
  const d = await gh.graphql<{ repository: RepoNode | null }>(REPO_QUERY, { owner, name });
  return d.repository ? normalise(d.repository, now) : null;
}

/** Parse "https://github.com/owner/repo" → { owner, name }. */
export function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], name: m[2] } : null;
}
