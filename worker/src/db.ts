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
