/** Typed D1 accessors for the admin store (submissions, approved entries, overrides). */
import type { Project } from "./scrape";

export interface Submission {
  id: number;
  slug: string;
  repo_url: string;
  name: string;
  description: string | null;
  category: string | null;
  demo_url: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
}

export interface Override {
  slug: string;
  github_id: number;
  hidden: boolean;
  featured: boolean;
  name: string | null;
  description: string | null;
  category: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export class Db {
  constructor(private d1: D1Database) {}

  // ---- submissions ----
  async insertSubmission(s: Omit<Submission, "id" | "status" | "decided_at" | "decided_by" | "note">): Promise<number> {
    const r = await this.d1
      .prepare(`INSERT INTO submissions (slug, repo_url, name, description, category, demo_url, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(s.slug, s.repo_url, s.name, s.description, s.category, s.demo_url, s.created_at)
      .run();
    return r.meta.last_row_id as number;
  }

  async listSubmissions(status?: string): Promise<Submission[]> {
    const q = status
      ? this.d1.prepare(`SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT 500`).bind(status)
      : this.d1.prepare(`SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500`);
    return (await q.all<Submission>()).results ?? [];
  }

  async getSubmission(id: number): Promise<Submission | null> {
    return (await this.d1.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(id).first<Submission>()) ?? null;
  }

  async decideSubmission(id: number, status: "approved" | "rejected", by: string, note: string | null, at: string): Promise<void> {
    await this.d1
      .prepare(`UPDATE submissions SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?`)
      .bind(status, by, note, at, id)
      .run();
  }

  async countPending(): Promise<number> {
    const r = await this.d1.prepare(`SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'`).first<{ n: number }>();
    return r?.n ?? 0;
  }

  // ---- newsletter subscribers ----
  async upsertNewsletterSubscriber(input: {
    email: string;
    scope: "network" | "domain";
    slug: string;
    created_at: string;
  }): Promise<"subscribed" | "already_subscribed" | "reactivated"> {
    const existing = await this.d1
      .prepare(`SELECT status FROM newsletter_subscribers WHERE email = ? AND scope = ? AND slug = ?`)
      .bind(input.email, input.scope, input.slug)
      .first<{ status: string }>();

    if (!existing) {
      await this.d1
        .prepare(`INSERT INTO newsletter_subscribers (email, scope, slug, status, created_at) VALUES (?, ?, ?, 'active', ?)`)
        .bind(input.email, input.scope, input.slug, input.created_at)
        .run();
      return "subscribed";
    }

    if (existing.status === "active") return "already_subscribed";

    await this.d1
      .prepare(`UPDATE newsletter_subscribers SET status = 'active', unsubscribed_at = NULL, created_at = ? WHERE email = ? AND scope = ? AND slug = ?`)
      .bind(input.created_at, input.email, input.scope, input.slug)
      .run();
    return "reactivated";
  }

  async listNewsletterSubscribers(
    filter: { status?: string; slug?: string } = {},
    limit = 500,
  ): Promise<Array<{ id: number; email: string; scope: string; slug: string; status: string; created_at: string; unsubscribed_at: string | null }>> {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filter.status) { where.push("status = ?"); binds.push(filter.status); }
    if (filter.slug) { where.push("slug = ?"); binds.push(filter.slug); }
    const sql =
      `SELECT id, email, scope, slug, status, created_at, unsubscribed_at FROM newsletter_subscribers` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at DESC LIMIT ?`;
    const r = await this.d1.prepare(sql).bind(...binds, limit).all();
    return (r.results ?? []) as Array<{ id: number; email: string; scope: string; slug: string; status: string; created_at: string; unsubscribed_at: string | null }>;
  }

  async newsletterStats(): Promise<{ active: number; unsubscribed: number; network: number; domains: Array<{ slug: string; n: number }> }> {
    const [active, unsub, network, perSlug] = await Promise.all([
      this.d1.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'active'`).first<{ n: number }>(),
      this.d1.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status != 'active'`).first<{ n: number }>(),
      this.d1.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'active' AND scope = 'network'`).first<{ n: number }>(),
      this.d1.prepare(`SELECT slug, COUNT(*) AS n FROM newsletter_subscribers WHERE status = 'active' AND scope = 'domain' GROUP BY slug ORDER BY n DESC`).all(),
    ]);
    return {
      active: active?.n ?? 0,
      unsubscribed: unsub?.n ?? 0,
      network: network?.n ?? 0,
      domains: (perSlug.results ?? []) as Array<{ slug: string; n: number }>,
    };
  }

  // ---- approved entries ----
  async upsertApproved(slug: string, project: Project, at: string): Promise<void> {
    await this.d1
      .prepare(`INSERT INTO approved_entries (slug, github_id, data, created_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(slug, github_id) DO UPDATE SET data = excluded.data`)
      .bind(slug, project.githubId, JSON.stringify(project), at)
      .run();
  }

  async approvedFor(slug: string): Promise<Project[]> {
    const rows = (await this.d1.prepare(`SELECT data FROM approved_entries WHERE slug = ?`).bind(slug).all<{ data: string }>()).results ?? [];
    return rows.map((r) => JSON.parse(r.data) as Project);
  }

  // ---- overrides ----
  async overridesFor(slug: string): Promise<Override[]> {
    const rows = (await this.d1.prepare(`SELECT * FROM entry_overrides WHERE slug = ?`).bind(slug).all<any>()).results ?? [];
    return rows.map(rowToOverride);
  }

  async upsertOverride(o: Override): Promise<void> {
    await this.d1
      .prepare(`INSERT INTO entry_overrides (slug, github_id, hidden, featured, name, description, category, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slug, github_id) DO UPDATE SET
                  hidden=excluded.hidden, featured=excluded.featured, name=excluded.name,
                  description=excluded.description, category=excluded.category,
                  updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .bind(o.slug, o.github_id, o.hidden ? 1 : 0, o.featured ? 1 : 0, o.name, o.description, o.category, o.updated_at, o.updated_by)
      .run();
  }

  // ---- domain page settings ----
  async getDomainSettings(slug: string): Promise<import("./domain-settings").DomainSettingsPayload | null> {
    const row = await this.d1.prepare(`SELECT data FROM domain_settings WHERE slug = ?`).bind(slug).first<{ data: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  async upsertDomainSettings(slug: string, data: import("./domain-settings").DomainSettingsPayload, by: string, at: string): Promise<void> {
    await this.d1
      .prepare(`INSERT INTO domain_settings (slug, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(slug, JSON.stringify(data), at, by)
      .run();
  }

  async listDomainSettings(): Promise<Array<{ slug: string; data: import("./domain-settings").DomainSettingsPayload }>> {
    const rows = (await this.d1.prepare(`SELECT slug, data FROM domain_settings`).all<{ slug: string; data: string }>()).results ?? [];
    return rows.map((r) => ({ slug: r.slug, data: JSON.parse(r.data) }));
  }
}

function rowToOverride(r: any): Override {
  return {
    slug: r.slug,
    github_id: r.github_id,
    hidden: !!r.hidden,
    featured: !!r.featured,
    name: r.name ?? null,
    description: r.description ?? null,
    category: r.category ?? null,
    updated_at: r.updated_at ?? null,
    updated_by: r.updated_by ?? null,
  };
}
