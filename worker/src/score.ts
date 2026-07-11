/**
 * Weighted quality score with penalties (workflow 05 model). Used to rank the
 * discovered candidates before keeping the top N per domain. Popularity alone
 * (stars) is dampened with a log so a fresher, well-maintained mid-size repo can
 * out-rank a huge but stale one.
 */
export interface ScoreInput {
  stars: number;
  pushedAt: string | null;
  hasHomepage: boolean;
  hasLicense: boolean;
  topicCount: number;
  hasDescription: boolean;
}

const DAY = 86_400_000;

export function qualityScore(r: ScoreInput, now: number): number {
  // Popularity: log-scaled stars, ~0..1 across 1 → 200k stars.
  const popularity = Math.min(1, Math.log10(r.stars + 1) / Math.log10(200_000));

  // Recency: 1.0 if pushed today, decaying to ~0 over a year.
  const ageDays = r.pushedAt ? Math.max(0, (now - Date.parse(r.pushedAt)) / DAY) : 3650;
  const recency = Math.max(0, 1 - ageDays / 365);

  // Completeness: signals a real, documented project.
  const completeness =
    (r.hasHomepage ? 0.4 : 0) +
    (r.hasLicense ? 0.25 : 0) +
    (r.hasDescription ? 0.2 : 0) +
    Math.min(0.15, r.topicCount * 0.03);

  let score = 0.6 * popularity + 0.25 * recency + 0.15 * completeness;

  // Penalties.
  if (ageDays > 730) score -= 0.15; // untouched 2y+
  if (!r.hasDescription) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}
