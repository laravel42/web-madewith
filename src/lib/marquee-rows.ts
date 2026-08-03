/** Pad a marquee row so short sections still have enough cards to scroll. */
export function expandForMarquee<T>(row: T[], min = 4): T[] {
  if (row.length === 0) return [];
  const out = [...row];
  while (out.length < min) out.push(...row);
  return out;
}

export function marqueeDuration(count: number): string {
  return `${Math.max(18, count * 5)}s`;
}
