# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into MadeWithWhat — a multi-domain open-source project catalog (Made with Next, Made with Nuxt, Made with Astro, etc.).

**What changed:**

- `src/components/PostHog.astro` — rewrote from npm-import to `is:inline` web snippet using `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST`. The snippet sets `window.posthog` globally so all other scripts can use it. Host corrected to `us.i.posthog.com`. Dev-mode warning added when the token is not configured.
- `src/components/SubmitForm.astro` — captures `project_submitted` on successful form submission (both with and without API backend), and `project_submission_failed` on API errors. `tech_name` property carries the catalog domain slug for per-stack segmentation.
- `src/components/NewsletterForm.astro` — captures `newsletter_subscribed` with `source: "newsletter_page"` after the domain-specific newsletter subscription succeeds.
- `src/components/SubscribeModal.astro` — captures `subscribe_modal_opened` when the network-wide modal appears, and `newsletter_subscribed` with `source: "subscribe_modal"` on success.
- `src/components/ProjectDetail.astro` — added `data-track-type` attributes to GitHub and demo link anchors in both the terminal and default variants; a delegated `click` event listener captures `github_link_clicked` and `demo_link_clicked` with the link URL.
- `src/components/InstallBox.astro` — added `data-tech` on the root element and `data-command-type` on each copy button; captures `install_command_copied` with `command_type` (clone/install) and `tech_name`.
- `src/pages/admin/login.astro` — imported the PostHog component into the standalone admin login page and captures `admin_logged_in` on successful authentication.
- `.env` — `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` set to the project values.
- `.env.example` — updated from `PUBLIC_POSTHOG_KEY` to `PUBLIC_POSTHOG_PROJECT_TOKEN`, host corrected to US cloud.

All three public layouts (`BlogLayout.astro`, `CatalogLayout.astro`, `NetworkLayout.astro`) were already importing `<PostHog />`, so analytics is active across every page.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `project_submitted` | Fired when a user successfully submits a project to the gallery. | `src/components/SubmitForm.astro` |
| `project_submission_failed` | Fired when the project submission API call returns an error. | `src/components/SubmitForm.astro` |
| `newsletter_subscribed` | Fired when a user successfully subscribes via the domain newsletter page. | `src/components/NewsletterForm.astro` |
| `newsletter_subscribed` | Fired when a user successfully subscribes via the network-wide subscribe modal. | `src/components/SubscribeModal.astro` |
| `subscribe_modal_opened` | Fired when the network-wide subscribe modal is opened by the user. | `src/components/SubscribeModal.astro` |
| `github_link_clicked` | Fired when a user clicks the View on GitHub link from a project detail page. | `src/components/ProjectDetail.astro` |
| `demo_link_clicked` | Fired when a user clicks the live demo link from a project detail page. | `src/components/ProjectDetail.astro` |
| `install_command_copied` | Fired when a user copies the install or clone command from the install box. | `src/components/InstallBox.astro` |
| `admin_logged_in` | Fired when an admin successfully signs in to the dashboard. | `src/pages/admin/login.astro` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard:** [Analytics basics (wizard)](https://us.posthog.com/project/526240/dashboard/1898246)
- [Project submissions over time](https://us.posthog.com/project/526240/insights/f7kVdfmI) — daily count of successfully submitted projects
- [Newsletter subscription funnel](https://us.posthog.com/project/526240/insights/cFMbRhzO) — conversion from modal opened → subscribed
- [Project engagement actions](https://us.posthog.com/project/526240/insights/WK4RmjXZ) — installs copied, GitHub clicks, demo clicks over time
- [Submission success vs failure](https://us.posthog.com/project/526240/insights/J0mpp4ni) — submitted vs failed API calls
- [Newsletter subscriptions by source](https://us.posthog.com/project/526240/insights/ROaFeamg) — newsletter page vs subscribe modal breakdown

## Verify before merging

- [ ] Run a full production build (`pnpm build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to any CI/CD environment secrets or deployment platform config (Ploi, Vercel, etc.) so the production build includes the token.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in PostHog error tracking.
- [ ] This project contains data sources PostHog can import (PostgreSQL, OpenAI, OpenRouter). Run `npx @posthog/wizard warehouse` to connect them to PostHog's data warehouse.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-astro-static/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
