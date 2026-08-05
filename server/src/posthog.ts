/**
 * Server-side PostHog capture — mirrors every stored newsletter subscriber and
 * project submission into PostHog so the records are queryable there (SQL /
 * insights), independent of client-side capture and ad blockers.
 * Unconfigured (no token) it degrades to a no-op so dev/test never need PostHog.
 */
import { PostHog } from "posthog-node";

export interface Analytics {
  /** Fire-and-forget; must never throw into request handling. */
  capture(event: string, distinctId: string, properties?: Record<string, unknown>): void;
  /** Flush pending events; called from Runtime.close() on shutdown. */
  shutdown(): Promise<void>;
}

export const noopAnalytics: Analytics = {
  capture() {},
  async shutdown() {},
};

export function createAnalytics(token?: string, host?: string): Analytics {
  if (!token) return noopAnalytics;
  // flushAt 1: form traffic is sparse, so send each event immediately rather
  // than holding a batch that a daemon restart could drop.
  const client = new PostHog(token, { host: host || "https://us.i.posthog.com", flushAt: 1 });
  return {
    capture(event, distinctId, properties) {
      try {
        client.capture({ event, distinctId, properties });
      } catch (e) {
        console.log(`posthog capture failed: ${(e as Error).message}`);
      }
    },
    shutdown: () => client.shutdown(),
  };
}
