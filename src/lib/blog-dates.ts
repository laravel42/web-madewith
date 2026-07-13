export function parseBlogDate(value: string): Date | null {
  const trimmed = value.trim().replace(/\s+UTC$/i, "");
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    const noonUtc = new Date(`${dateOnly[1]}T12:00:00Z`);
    if (!Number.isNaN(noonUtc.getTime())) return noonUtc;
  }

  return null;
}

export function formatBlogDate(iso: string): string {
  const d = parseBlogDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const ISO_TIMESTAMP =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?(?:\s+UTC)?/gi;

/** Replace raw ISO timestamps in article prose with short readable dates. */
export function humanizeIsoTimestamps(text: string): string {
  return text.replace(ISO_TIMESTAMP, (match) => formatBlogDate(match));
}
