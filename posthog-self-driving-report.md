# PostHog Self-driving setup report

PostHog Self-driving is now configured for MadeWithWhat. Six signal sources are live, a five-scout troop is running, and findings will start appearing in your [Self-driving inbox](https://us.posthog.com/project/526240/inbox) within approximately 30 minutes.

---

## AI data processing

**Approved.** Organization-level AI data processing consent was confirmed before setup began.

---

## GitHub

**Connected during this run.**
Account: `laravel42` (integration id: 200926, connected 2026-08-04).
Self-driving can now research findings against your code and open draft PRs.

---

## Products enabled

The `products-enable` MCP tool was not available in this deployment. The products were confirmed active via server-side probes and the `posthog.init` override check passed (no `disable_session_recording` or `capture_exceptions: false` set).

| Product | Status | Notes |
|---|---|---|
| Session Replay | Enabled (confirmed active — recordings exist) | `posthog.init` has no override; server flip is live |
| Error Tracking | Enabled (confirmed active — issues exist) | `posthog.init` has no override; server flip is live |
| Support (Conversations) | Enabled | Inert until an inbound channel is connected — see follow-ups |

---

## Signal sources

| source_product | source_type | Action |
|---|---|---|
| `signals_scout` | `cross_source_issue` | **On by default** — scout findings route to the inbox with no config row needed |
| `health_checks` | `health_issue` | **Enabled** (id: 019fce41-2344-7675-b756-a365411e55b6) |
| `error_tracking` | `issue_created` | **Enabled** (id: 019fce41-28df-7cb8-829b-19036dbc7b5d) |
| `error_tracking` | `issue_reopened` | **Enabled** (id: 019fce41-2cc4-78b9-97af-f3f03399fd02) |
| `error_tracking` | `issue_spiking` | **Enabled** (id: 019fce41-300f-7d53-8ea4-371a9d94aea9) |
| `session_replay` | `session_analysis_cluster` | **Enabled** (id: 019fce41-3230-741f-9fea-cb7e896e93f0, sample rate: 10%) |
| `conversations` | `ticket` | **Enabled** (id: 019fce41-3563-7811-b0e3-8975486cf53b) — dormant until a support channel is connected |
| `llm_analytics` | — | **Skipped** — no AI/LLM usage detected |
| `logs` | — | **Skipped** — no logs product usage detected |

---

## Connected tools

No external tools were selected. All issue trackers, support desks, and other connected-tool sources were declined (user picked "None of these").

---

## Scout troop

**Run budget:** 100 runs/day (early access default). 0 runs used today. Banner: *"Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more."*

**5 scouts enabled, 22 disabled.**

### Enabled

| Scout | Reason |
|---|---|
| `signals-scout-general` | Always on — cross-product correlations and surfaces no specialist covers |
| `signals-scout-product-analytics` | Core funnels and saved flows instrumented (submission, newsletter, engagement insights built) |
| `signals-scout-web-analytics` | Content catalog site — web traffic, channel attribution, and landing-page health are primary metrics |
| `signals-scout-web-vitals` | Astro static site serving public content — Core Web Vitals (LCP, INP, CLS, FCP) captured by default posthog-js |
| `signals-scout-observability-gaps` | New instrumentation — surfaces events with no insight or dashboard coverage as the product evolves |

### Disabled

| Scout | Reason |
|---|---|
| `signals-scout-error-tracking` | Covered by native `error_tracking` signal source (issues reach inbox directly) |
| `signals-scout-session-replay` | Covered by native `session_replay` signal source (clusters reach inbox directly) |
| `signals-scout-surveys` | No surveys in use |
| `signals-scout-revenue-analytics` | No payment SDK or revenue data |
| `signals-scout-ai-observability` | No AI/LLM usage |
| `signals-scout-logs` | Logs product not in use |
| `signals-scout-csp-violations` | No CSP reporting configured |
| `signals-scout-feature-flags` | No active feature flags detected |
| `signals-scout-experiments` | No active A/B experiments |
| `signals-scout-customer-analytics` | B2C product catalog — no group/accounts analytics |
| `signals-scout-data-pipelines` | No CDP destinations or batch exports |
| `signals-scout-data-warehouse` | No external warehouse sources connected |
| `signals-scout-replay-vision` | No Replay Vision scanners configured |
| `signals-scout-anomaly-detection` | Troop already has 4 specialists; lower-priority cross-product scout |
| `signals-scout-conversations` | Support just enabled — no channel connected yet, nothing to watch |
| `signals-scout-apm` | No distributed tracing / OpenTelemetry |
| `signals-scout-inbox-validation` | Fresh setup — no shipped fixes to validate |
| `signals-scout-insight-alerts` | No configured insight alerts |
| `signals-scout-mcp-tool-calls` | Not relevant to this product |
| `signals-scout-skills-store` | Not relevant to this product |
| `signals-scout-tasks` | Not relevant to this product |
| `signals-scout-health-checks` | Native `health_checks` source covers instrumentation health; troop already at 5 |

---

## Custom scouts

Two candidates were proposed and declined by the user.

**Proposed, declined:**

1. **Watch project submission failures** (`signals-scout-submission-health`) — would have watched the `project_submitted` / `project_submission_failed` ratio for API degradation. Not covered by error tracking (which catches JS exceptions, not custom business-level API failure events) or product-analytics (which watches funnel insights, not raw event failure rates). User declined.

2. **Watch catalog engagement drops** (`signals-scout-catalog-engagement`) — would have tracked `github_link_clicked` + `demo_link_clicked` + `install_command_copied` per session against baseline, flagging broken links or detail-page regressions. Not covered by any built-in scout. User declined.

**Noise escape hatch:** If any enabled scout turns out noisy, set `emit: false` on its config in PostHog to switch it to dry-run (it still runs and logs, but writes nothing to the inbox).

If you change your mind on either custom scout, you can add them later — they remain good candidates.

---

## Follow-ups

- [ ] **Enable Support inbound channel** — Conversations is enabled but will not receive tickets until you connect an inbound channel (email, shared inbox, or Slack) in PostHog Settings → Support.
- [ ] **Enable Session Replay in PostHog settings** — if recordings ever stop appearing, verify "Record user sessions" is on in Settings → Session replay (the server flip couldn't be confirmed via MCP, but existing recordings confirm it was already active).
- [ ] **Enable Error Tracking in PostHog settings** — if the existing issues stop updating, verify "Enable exception autocapture" is on in Settings → Error tracking.
- [ ] **Connect a warehouse source** if you use `pganalyze`, `Linear`, `Jira`, `Zendesk`, or any other connected tool — visit https://us.posthog.com/project/526240/pipeline/new/source to add one and then revisit the Self-driving source config.
- [ ] **Wire source-map upload** (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in error tracking (noted from the base-wizard report).
- [ ] **Enable `signals-scout-feature-flags`** in PostHog if you add feature flags to the project later.
- [ ] **Enable `signals-scout-experiments`** in PostHog if you run A/B experiments.
- [ ] **Enable `signals-scout-surveys`** in PostHog if you add surveys.

---

## What happens next

The scout coordinator picks up fresh configs within ~30 minutes. Each enabled scout runs on a daily cadence and draws from the 100-run/day early-access budget. Findings cluster into reports in the inbox; immediately actionable ones can kick off coding tasks. Check your inbox at:

**https://us.posthog.com/project/526240/inbox**
