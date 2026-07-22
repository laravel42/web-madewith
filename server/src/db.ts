/** Postgres accessors for the admin store (submissions, approved entries, overrides).
 *  Same public surface as the old D1 `Db` class — only the internals changed
 *  (`?`→`$n`, RETURNING id, real BOOLEANs, `pool.query`). */
import type { Pool } from "pg";
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
  constructor(private pool: Pool) {}

  private async rows<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(text, params as any[]);
    return r.rows as T[];
  }

  // ---- submissions ----
  async insertSubmission(s: Omit<Submission, "id" | "status" | "decided_at" | "decided_by" | "note">): Promise<number> {
    const rows = await this.rows<{ id: string }>(
      `INSERT INTO submissions (slug, repo_url, name, description, category, demo_url, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
      [s.slug, s.repo_url, s.name, s.description, s.category, s.demo_url, s.created_at],
    );
    return Number(rows[0].id);
  }

  async listSubmissions(status?: string): Promise<Submission[]> {
    return status
      ? this.rows<Submission>(`SELECT * FROM submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 500`, [status])
      : this.rows<Submission>(`SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500`);
  }

  async getSubmission(id: number): Promise<Submission | null> {
    return (await this.rows<Submission>(`SELECT * FROM submissions WHERE id = $1`, [id]))[0] ?? null;
  }

  async decideSubmission(id: number, status: "approved" | "rejected", by: string, note: string | null, at: string): Promise<void> {
    await this.pool.query(
      `UPDATE submissions SET status = $1, decided_by = $2, note = $3, decided_at = $4 WHERE id = $5`,
      [status, by, note, at, id],
    );
  }

  async countPending(): Promise<number> {
    const rows = await this.rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM submissions WHERE status = 'pending'`);
    return rows[0]?.n ?? 0;
  }

  // ---- newsletter subscribers ----
  async upsertNewsletterSubscriber(input: {
    email: string;
    scope: "network" | "domain";
    slug: string;
    created_at: string;
  }): Promise<"subscribed" | "already_subscribed" | "reactivated"> {
    const existing = (
      await this.rows<{ status: string }>(
        `SELECT status FROM newsletter_subscribers WHERE email = $1 AND scope = $2 AND slug = $3`,
        [input.email, input.scope, input.slug],
      )
    )[0];

    if (!existing) {
      await this.pool.query(
        `INSERT INTO newsletter_subscribers (email, scope, slug, status, created_at) VALUES ($1, $2, $3, 'active', $4)`,
        [input.email, input.scope, input.slug, input.created_at],
      );
      return "subscribed";
    }

    if (existing.status === "active") return "already_subscribed";

    await this.pool.query(
      `UPDATE newsletter_subscribers SET status = 'active', unsubscribed_at = NULL, created_at = $1
       WHERE email = $2 AND scope = $3 AND slug = $4`,
      [input.created_at, input.email, input.scope, input.slug],
    );
    return "reactivated";
  }

  async listNewsletterSubscribers(
    filter: { status?: string; slug?: string } = {},
    limit = 500,
  ): Promise<Array<{ id: number; email: string; scope: string; slug: string; status: string; created_at: string; unsubscribed_at: string | null }>> {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (filter.status) { binds.push(filter.status); where.push(`status = $${binds.length}`); }
    if (filter.slug) { binds.push(filter.slug); where.push(`slug = $${binds.length}`); }
    binds.push(limit);
    const sql =
      `SELECT id, email, scope, slug, status, created_at, unsubscribed_at FROM newsletter_subscribers` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at DESC LIMIT $${binds.length}`;
    return this.rows(sql, binds);
  }

  async newsletterStats(): Promise<{ active: number; unsubscribed: number; network: number; domains: Array<{ slug: string; n: number }> }> {
    const [active, unsub, network, perSlug] = await Promise.all([
      this.rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE status = 'active'`),
      this.rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE status != 'active'`),
      this.rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE status = 'active' AND scope = 'network'`),
      this.rows<{ slug: string; n: number }>(
        `SELECT slug, COUNT(*)::int AS n FROM newsletter_subscribers WHERE status = 'active' AND scope = 'domain' GROUP BY slug ORDER BY n DESC`,
      ),
    ]);
    return { active: active[0]?.n ?? 0, unsubscribed: unsub[0]?.n ?? 0, network: network[0]?.n ?? 0, domains: perSlug };
  }

  // ---- approved entries ----
  async upsertApproved(slug: string, project: Project, at: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO approved_entries (slug, github_id, data, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug, github_id) DO UPDATE SET data = excluded.data`,
      [slug, project.githubId, JSON.stringify(project), at],
    );
  }

  async approvedFor(slug: string): Promise<Project[]> {
    const rows = await this.rows<{ data: string }>(`SELECT data FROM approved_entries WHERE slug = $1`, [slug]);
    return rows.map((r) => JSON.parse(r.data) as Project);
  }

  // ---- overrides ----
  async overridesFor(slug: string): Promise<Override[]> {
    const rows = await this.rows(`SELECT * FROM entry_overrides WHERE slug = $1`, [slug]);
    return rows.map(rowToOverride);
  }

  async upsertOverride(o: Override): Promise<void> {
    await this.pool.query(
      `INSERT INTO entry_overrides (slug, github_id, hidden, featured, name, description, category, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug, github_id) DO UPDATE SET
         hidden=excluded.hidden, featured=excluded.featured, name=excluded.name,
         description=excluded.description, category=excluded.category,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      [o.slug, o.github_id, o.hidden, o.featured, o.name, o.description, o.category, o.updated_at, o.updated_by],
    );
  }

  // ---- domain page settings ----
  async getDomainSettings(slug: string): Promise<import("./domain-settings").DomainSettingsPayload | null> {
    const row = (await this.rows<{ data: string }>(`SELECT data FROM domain_settings WHERE slug = $1`, [slug]))[0];
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  async upsertDomainSettings(slug: string, data: import("./domain-settings").DomainSettingsPayload, by: string, at: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO domain_settings (slug, data, updated_at, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [slug, JSON.stringify(data), at, by],
    );
  }

  async listDomainSettings(): Promise<Array<{ slug: string; data: import("./domain-settings").DomainSettingsPayload }>> {
    const rows = await this.rows<{ slug: string; data: string }>(`SELECT slug, data FROM domain_settings`);
    return rows.map((r) => ({ slug: r.slug, data: JSON.parse(r.data) }));
  }
}

function rowToOverride(r: any): Override {
  return {
    slug: r.slug,
    github_id: Number(r.github_id), // BIGINT comes back as string from pg
    hidden: !!r.hidden,
    featured: !!r.featured,
    name: r.name ?? null,
    description: r.description ?? null,
    category: r.category ?? null,
    updated_at: r.updated_at ?? null,
    updated_by: r.updated_by ?? null,
  };
}
