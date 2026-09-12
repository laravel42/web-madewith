/** Mirrors server/src/domains.ts's DOMAIN_SLUGS — same source JSON, no server/ dependency. */
import catalog from "../../../src/config/domain-catalog.json" with { type: "json" };

export const DOMAIN_SLUGS: string[] = catalog.map((d: { slug: string }) => d.slug);
