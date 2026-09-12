/**
 * Server-side PostHog capture — same contract as server/src/posthog.ts,
 * duplicated here so the Lambda bundle doesn't pull in server/'s pg/ioredis
 * dependency tree for one shared function.
 */
import { PostHog } from "posthog-node";

export interface Analytics {
  capture(event: string, distinctId: string, properties?: Record<string, unknown>): void;
  /**
   * Await this before the handler returns. Lambda freezes the execution
   * environment as soon as the response goes out — an unawaited async
   * capture() can get frozen mid-flight and silently never reach PostHog,
   * which is exactly the failure mode this Lambda replaces.
   */
  flush(): Promise<void>;
}

export const noopAnalytics: Analytics = {
  capture() {},
  async flush() {},
};

// Reused across warm invocations (module scope), so don't shut it down per
// request — just flush.
let cached: PostHog | undefined;

export function createAnalytics(token?: string, host?: string): Analytics {
  if (!token) return noopAnalytics;
  if (!cached) cached = new PostHog(token, { host: host || "https://us.i.posthog.com", flushAt: 1 });
  const client = cached;
  return {
    capture(event, distinctId, properties) {
      try {
        client.capture({ event, distinctId, properties });
      } catch (e) {
        console.log(`posthog capture failed: ${(e as Error).message}`);
      }
    },
    async flush() {
      try {
        await client.flush();
      } catch (e) {
        console.log(`posthog flush failed: ${(e as Error).message}`);
      }
    },
  };
}
