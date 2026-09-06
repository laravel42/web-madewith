---
title: "Twenty CRM Ecosystem Guide — Integration, Eval, Workflows"
description: "Practical ecosystem map for Twenty (twentyhq/twenty): core repo, extensions, integration patterns, maintenance signals, licensing, and a discovery workflow."
excerpt: "A focused, evidence-grounded map of the Twenty (twentyhq/twenty) ecosystem that covers the core repository, project categories, common integration patterns, evaluation signals, licensing posture, and a practical discovery checklist."
slug: "twenty-crm-ecosystem-guide-integration-eval-workflows"
date: "2026-07-26"
updated: "2026-07-26"
author: "MWW Editorial Team"
category: "Ecosystem Guide"
primaryTechnology: "Twenty"
searchIntent: "informational"
primaryKeyphrase: "Twenty CRM"
secondaryKeyphrases:
  - "open-source CRM"
  - "twentyhq"
  - "twenty-sdk"
  - "self-hosting"
  - "integration patterns"
  - "CRM extensions"
tags:
  - "Twenty"
  - "CRM / ERP"
  - "Ecosystem Guide"
  - "GitHub"
  - "Open Source"
canonical: "https://madewithwhat.net/blog/twenty-crm-ecosystem-guide-integration-eval-workflows"
image: "/assets/2026/07/26/ecosystem-guide-twenty-2-cover.jpg"
openGraph:
  title: "Twenty CRM Ecosystem Guide — Integration, Eval, Workflows"
  description: "Practical ecosystem map for Twenty (twentyhq/twenty): core repo, extensions, integration patterns, maintenance signals, licensing, and a discovery workflow."
  image: "/assets/2026/07/26/ecosystem-guide-twenty-2-cover.jpg"
  type: article
jsonLd: "[{\"@context\":\"https://schema.org\",\"@type\":\"TechArticle\",\"headline\":\"Twenty CRM Ecosystem Guide — Integration, Eval, Workflows\",\"description\":\"Practical ecosystem map for Twenty (twentyhq/twenty): core repo, extensions, integration patterns, maintenance signals, licensing, and a discovery workflow.\",\"datePublished\":\"2026-07-26\",\"dateModified\":\"2026-07-26\",\"author\":{\"@type\":\"Organization\",\"name\":\"MWW Editorial Team\"},\"publisher\":{\"@type\":\"Organization\",\"name\":\"MadeWithWhat\"},\"mainEntityOfPage\":\"https://madewithwhat.net/blog/twenty-crm-ecosystem-guide-integration-eval-workflows\",\"image\":\"https://madewithwhat.net/assets/2026/07/26/ecosystem-guide-twenty-2-cover.jpg\",\"keywords\":[\"Twenty\",\"CRM / ERP\",\"Ecosystem Guide\",\"GitHub\",\"Open Source\"],\"about\":[{\"@type\":\"Thing\",\"name\":\"Twenty\"}]},{\"@context\":\"https://schema.org\",\"@type\":\"FAQPage\",\"mainEntityOfPage\":\"https://madewithwhat.net/blog/twenty-crm-ecosystem-guide-integration-eval-workflows\",\"mainEntity\":[{\"@type\":\"Question\",\"name\":\"What is the single authoritative source for Twenty?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"The canonical project repository on GitHub (twentyhq/twenty) is the primary technical source; it links out to the website and documentation. See the repository for code, README guidance, and links to docs and community channels. [Twenty canonical repository].\"}},{\"@type\":\"Question\",\"name\":\"Is Twenty available as a cloud service and for self-hosting?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Yes. The README references a cloud pathway via twenty.com and also points to self-hosting options (Docker Compose and local setup doc links). Inspect the README and docs linked from the repository to follow those flows. [Twenty canonical repository].\"}},{\"@type\":\"Question\",\"name\":\"How should I treat the repository's license field marked as NOASSERTION?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Treat NOASSERTION as a pointer to perform a manual license check: search the repository for a LICENSE file, consult contribution docs, or contact maintainers. Do not assume permissions from the metadata alone. [Twenty canonical repository].\"}},{\"@type\":\"Question\",\"name\":\"What do the GitHub star and fork counts mean here?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"They are indicators of interest and visibility for the project (stars: 56,310; forks: 8,939 in the repository metadata snapshot). They are not measures of production adoption or market share. [Twenty canonical repository].\"}},{\"@type\":\"Question\",\"name\":\"Where can I find the release notes and breaking changes?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"The releases page for the repository contains the latest release notes; the most recent release used in this guide is sdk/v2.37.0, published 2026-08-28, which includes breaking changes and migration items. Review the changelog for upgrade planning. [Twenty latest GitHub release].\"}},{\"@type\":\"Question\",\"name\":\"How do I evaluate the SDK and app-publishing workflow?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Follow the README examples that import from the SDK and use the CLI scaffolding to create a minimal app; publish it to a test workspace (the README demonstrates a private app publish command). This practical test validates the developer experience. [Twenty canonical repository].\"}},{\"@type\":\"Question\",\"name\":\"Who should I contact for licensing questions or contribution guidance?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Use the repository's community channels and contribution guide links—README includes links to Discord, discussions, and contribution docs to engage maintainers and community members. [Twenty canonical repository].\"}}]}]"
---
![Twenty CRM cover image](/assets/2026/07/26/ecosystem-guide-twenty-2-cover.jpg)

## Table of contents

- [Executive answer](#executive-answer)
- [What the core repository contains (evidence-based)](#what-the-core-repository-contains-evidence-based)
- [Inferred from README/repo structure: the repository appears organized as a monorepo containing multiple packages (server, client, SDK, website) and developer tooling (CLI, SDK manifests). The README includes examples for scaffolding an app and for publishing with a CLI, which implies a designed developer workflow for extensions and apps.](#inferred-from-readme-repo-structure-the-repository-appears-organized-as-a-monorepo-containing-multiple-packages-server-client-sdk-website-and-developer-tooling-cli-sdk-manifests-the-readme-includes-examples-for-scaffolding-an-app-and-for-publishing-with-a-cli-which-implies-a-designed-developer-workflow-for-extensions-and-apps)
- [Ecosystem map: core repo, project categories, and responsibilities](#ecosystem-map-core-repo-project-categories-and-responsibilities)
- [Integration patterns you will encounter](#integration-patterns-you-will-encounter)
- [Inferred from README/repo structure: GraphQL focus is suggested by the repository topics; combined with TypeScript and SDK artifacts this implies a typical pattern of typed APIs and generated client bindings (label as inferred).](#inferred-from-readme-repo-structure-graphql-focus-is-suggested-by-the-repository-topics-combined-with-typescript-and-sdk-artifacts-this-implies-a-typical-pattern-of-typed-apis-and-generated-client-bindings-label-as-inferred)
- [Evaluation criteria and signals (tables)](#evaluation-criteria-and-signals-tables)
- [Maintenance signals and how to interpret them](#maintenance-signals-and-how-to-interpret-them)
- [Licensing considerations](#licensing-considerations)
- [Practical discovery and evaluation workflow (step-by-step)](#practical-discovery-and-evaluation-workflow-step-by-step)
- [Action checklist (decision checklist)](#action-checklist-decision-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [Assumptions and inferred conclusions (explicitly labelled):](#assumptions-and-inferred-conclusions-explicitly-labelled)
- [Limitations](#limitations)
- [Sources](#sources)
- [FAQ](#faq)

## Executive answer

Twenty's canonical repository (twentyhq/twenty) is a large, TypeScript-based CRM monorepo with an SDK and developer tooling that supports both cloud-hosted and self-hosted workflows. This guide maps the repository's role in an ecosystem, categories of complementary projects you will encounter, common integration approaches, practical evaluation signals you can measure from the repo, licensing considerations (the repository shows a NOASSERTION license flag on GitHub), and a step-by-step discovery workflow you can follow to assess suitability for production or customization.

All factual statements below are drawn from the project's public repository and its latest release metadata; see the Sources section for links. Where conclusions are drawn from README content or repository structure they are explicitly labelled as "Inferred from README/repo structure." Retrieval date for repository metadata used in this article: 2026-09-06 (generated_at in editorial data).

## What the core repository contains (evidence-based)

- Source: GitHub repository twentyhq/twenty [Twenty canonical repository]. The repo lists TypeScript as its primary language and includes topics like "monorepo", "nestjs", "react", "postgresql", and "graphql". These tags and the README content indicate the project includes both server and client components.
- Release cadence: the latest published release used for this guide is sdk/v2.37.0 (published 2026-08-28) [Twenty latest GitHub release].

## Inferred from README/repo structure: the repository appears organized as a monorepo containing multiple packages (server, client, SDK, website) and developer tooling (CLI, SDK manifests). The README includes examples for scaffolding an app and for publishing with a CLI, which implies a designed developer workflow for extensions and apps.

> [!NOTE]
> The repository's license field on GitHub is "NOASSERTION". That is a declaration from GitHub's automated license detection and should be handled carefully — see the Licensing section for guidance.

## Ecosystem map: core repo, project categories, and responsibilities

This table summarizes the primary categories you will encounter around Twenty and where they typically live relative to the core repository.

| Category | Typical location / maintainer | Evidence & where to inspect |
|---|---:|---|
| Core monorepo (server, web client, SDKs) | twentyhq/twenty (canonical repo) | Repo language: TypeScript; topics include "monorepo", "nestjs", "react"; README describes SDK and app publishing [Twenty canonical repository]. |
| Official docs and website | twenty.com and docs.twenty.com (linked from README) | README contains direct links to website and docs; website referenced as primary install path for cloud usage [Twenty canonical repository]. |
| Client SDKs / CLI | Packages inside the monorepo (e.g., twenty-sdk) | README examples import from 'twenty-sdk' and show CLI commands for creating and publishing apps (examples in README). |
| Third-party integrations / connectors | Separate repos or apps published to community marketplaces | README and README links reference apps and connection providers; inferences about connectors come from topics like "graphql" and README notes about connection providers. (Inferred from README/repo structure.) |
| Self-hosted deployment assets | Documentation and Docker Compose guides in docs and repo | README points to self-hosting with Docker Compose and local setup docs [Twenty canonical repository]. |

![Ecosystem data visual](/assets/2026/07/26/ecosystem-guide-twenty-2-data.jpg)

> [!TIP]
> Use the repository topics and README links as a short path to the most authoritative artifacts (docs, website, releases). Topics like "good-first-issue", "hacktoberfest" and "contribute" indicate active community guidance for contributors.

## Integration patterns you will encounter

Below are integration approaches the repository and README suggest or enable. Each pattern is followed by the concrete evidence available in the canonical sources.

- Embedded app development via SDK and CLI: The README includes example imports from a SDK package (for defining objects) and CLI commands (npx create-twenty-app, npx twenty app:publish), indicating a code-as-config and app-publishing flow. Evidence: code snippets and CLI examples in README [Twenty canonical repository].

- Cloud-first with optional self-hosting: README and links indicate a cloud offering at twenty.com and separate self-hosting guides (Docker Compose/local setup). Evidence: README installation section references cloud usage and self-hosting docs [Twenty canonical repository].

- Server/client separation with common types: Release notes reference shared client-sdk types and server enums, which suggests a typed contract approach between client SDK and server (release changelog lines referencing shared types). Evidence: changelog items in the latest release [Twenty latest GitHub release].

- Apps and versioned publishing: The README shows commands and a publishing workflow for apps, implying an extension marketplace or workspace-based app deployment model. Evidence: README CLI examples and links to docs for app publishing [Twenty canonical repository].

## Inferred from README/repo structure: GraphQL focus is suggested by the repository topics; combined with TypeScript and SDK artifacts this implies a typical pattern of typed APIs and generated client bindings (label as inferred).

```mermaid
flowchart LR
  Repo[twentyhq/twenty (monorepo)] -->|provides| SDK[twenty-sdk / CLI]
  Repo -->|hosts| Server[Server: NestJS, Postgres, Redis]
  Repo -->|hosts| Client[React app / Admin UI]
  SDK -->|scaffolds| App[Custom App]
  App -->|publishes to| Workspace[Cloud workspace or Self-hosted instance]
  Workspace -->|uses| Integrations[Connection providers / Connectors]
  note[right of Repo]:::inferred[Inferred structure from README & topics]
  classDef inferred fill:#fef3c7,stroke:#f59e0b
```

## Evaluation criteria and signals (tables)

This table defines practical criteria to evaluate Twenty for a specific project, mapped to observable repo signals.

| Evaluation criterion | Why it matters | Repo / release signals to check |
|---|---:|---|
| Maintenance activity | Active maintenance reduces risk of unaddressed regressions | last commit/push date (pushed_at), latest release date, open issues and PR activity [Twenty canonical repository], [Twenty latest GitHub release]. Data used here pulled on 2026-09-06. |
| Community interest | Interest can indicate user and contributor attention, and availability of help | GitHub stars and forks (treat as interest signals, not adoption metrics): stars=56,310; forks=8,939 (per repo metadata). Note: stars are interest signals, not market-share measurements. [Twenty canonical repository]. |
| Release stability & notes | Releases with clear changelogs help assess upgrade cost | Latest release: sdk/v2.37.0 published 2026-08-28 includes a structured changelog with breaking changes and migration notes. [Twenty latest GitHub release]. |
| Licensing clarity | A clear, compatible license is necessary for reuse and distribution | License field on GitHub is "NOASSERTION" — this requires follow-up and legal review. [Twenty canonical repository]. |
| Extensibility & SDK quality | Quality and ergonomics of SDK affect developer productivity | README contains an SDK import example and CLI workflows for app creation and publishing; release notes reference SDK typing alignment between server and client. [Twenty canonical repository], [Twenty latest GitHub release]. |

Second table: quick compatibility checklist for initial technical fit.

| Questions to answer in discovery | Quick check method | Expected evidence location |
|---|---:|---|
| Does the stack match our team's languages and DB preferences? | Look for tech stack mentions and Docker Compose self-host docs | README stack list (TypeScript, NestJS, Postgres, Redis, React) and self-host docs [Twenty canonical repository]. |
| Is there an SDK covering the extension surface we need? | Search the repo for 'twenty-sdk' or 'defineObject' examples | README examples and package names in monorepo [Twenty canonical repository]. |
| Are there clear upgrade/migration notes? | Inspect latest release notes for breaking changes and migration guidance | Latest release changelog (sdk/v2.37.0) [Twenty latest GitHub release]. |
| How active is the release cadence? | Compare releases and published_at timestamps | Latest release published 2026-08-28; check releases page for history [Twenty latest GitHub release]. |

> [!WARNING]
> GitHub's "open_issues" count is not a defect count; it mixes feature requests, questions, and bugs. Use issue labels and recent activity to interpret the queue.

## Maintenance signals and how to interpret them

Use these repository fields as signals, not definitive judgments. All values below are from the canonical repository snapshot (metadata retrieved 2026-09-06 unless otherwise noted).

- stars (interest): 56,310 — treatment: an indicator of community attention, not proof of production usage. [Twenty canonical repository].
- forks: 8,939 — treatment: shows how many people created a copy of the repository; useful to find third-party forks or hosted variants. [Twenty canonical repository].
- watchers: 225 — treatment: lower-level interest updates. [Twenty canonical repository].
- open_issues: 166 — treatment: not a defect count; inspect labels and recent issue activity. [Twenty canonical repository].
- created_at: 2022-12-01. pushed_at: 2026-09-05. updated_at: 2026-09-06 — treatment: recent pushes and updates indicate ongoing maintenance. [Twenty canonical repository].
- latest_release published_at: 2026-08-28 — treatment: look at the release's changelog for breaking changes and migration guidance. [Twenty latest GitHub release].

## Licensing considerations

Concrete facts:
- The GitHub repository lists the license as "NOASSERTION" in repository metadata. This is GitHub's automated output when license detection cannot assert a license.

What that means in practice (evidence-backed guidance):
- Do not assume reuse or redistribution rights from the repository metadata alone. The NOASSERTION flag requires you to inspect repository files for a LICENSE file and, if absent or ambiguous, contact the maintainers or obtain legal advice before bundling or redistributing code.
- If you plan to self-host in a commercial product or distribute modified versions, treat licensing as a gating constraint until clarified. See the repository README and the project contribution docs (links in the repo) for any licensing guidance the maintainers provide. [Twenty canonical repository].

## Practical discovery and evaluation workflow (step-by-step)

1. Quick repo scan (10–20 minutes)
   - Open the repo homepage and README. Note stack bullets (TypeScript, NestJS, React) and links to docs and website. [Twenty canonical repository].
   - Record metadata: stars, forks, pushed_at, updated_at, open_issues. Use these as raw signals (do not over-interpret). [Twenty canonical repository].
2. Releases and changelog (20–30 minutes)
   - Inspect latest release notes (sdk/v2.37.0, published 2026-08-28) for breaking changes or highlighted migrations. Save any migration steps referenced. [Twenty latest GitHub release].
3. SDK and extension surface (30–60 minutes)
   - Search the repo for 'twenty-sdk', 'defineObject', and the CLI examples to confirm the extension model and whether it matches your needs (SDK imports and CLI scaffolding are present in README). [Twenty canonical repository].
4. Licensing check (10–30 minutes)
   - Look for a LICENSE file in the repo; if GitHub shows NOASSERTION, confirm what the repository contains and, if ambiguous, open an issue or contact maintainers for clarification. [Twenty canonical repository].
5. Self-host and quick smoke (2–4 hours)
   - Follow the repo's or docs' self-host or local setup instructions (Docker Compose or local setup links in README) in an isolated environment. Note resource requirements, configuration complexity, and any missing documentation steps. (Inferred from README references to Docker Compose/local setup.)
6. Build an example app (half-day)
   - Use the CLI scaffolding and SDK example from README (npx create-twenty-app, defineObject examples) to create a minimal extension and publish it to a test workspace (per README flow). This validates the developer experience. [Twenty canonical repository].
7. Security and dependency review (1–2 days)
   - Audit dependencies and scanning outputs; examine release notes for security-related items. Use your standard internal security checklist.
8. Community and support (ongoing)
   - Evaluate community channels linked in the README (Discord, discussions) to find engagement levels and response behaviors. [Twenty canonical repository].

> [!TIP]
> When the repository metadata shows "NOASSERTION" for license, prioritize the licensing check early in your evaluation workflow.

## Action checklist (decision checklist)

- [ ] Confirm licensing status by locating a LICENSE file or contacting maintainers.
- [ ] Verify latest release changelog for breaking changes and migration guidance (sdk/v2.37.0 referenced). [Twenty latest GitHub release].
- [ ] Validate SDK ergonomics by scaffolding a small app (use the README examples). [Twenty canonical repository].
- [ ] Perform a self-host smoke test using the Docker Compose/local setup docs referenced in the README.
- [ ] Scan dependencies and run a security audit with your internal tools.
- [ ] Review issue labels and recent PR merges to understand triage practices and contributor onboarding.

## Evidence, assumptions, and limitations

Evidence used (all retrieved or present in the supplied editorial data):
- Repository metadata, README excerpts, stack list, and topics from the canonical repo [Twenty canonical repository].
- Latest release changelog and metadata for sdk/v2.37.0 (published 2026-08-28) [Twenty latest GitHub release].
- Generated_at: 2026-09-06T01:40:39.406807+00:00 (date used to note freshness of repository metadata).

## Assumptions and inferred conclusions (explicitly labelled):
- Inferred from README/repo structure: the project is organized as a monorepo containing server, client, and SDK packages and exposes a CLI for app scaffolding and publishing. This is an inference based on README examples and repository topics rather than an explicit statement of folder layout.
- Inferred from README topics and changelog mentions: the project uses typed contracts between server and client (shared enums and SDK types) and a GraphQL-capable API surface (topic: "graphql"). These are reasonable deductions from the supplied data but not direct declarations of API format.

## Limitations
- This guide uses only the supplied sources and repository metadata snapshot; it does not draw on external benchmarks, user telemetry, or third-party audits.
- The repository's license state is flagged as NOASSERTION; legal interpretation requires inspection of repository files and potentially a conversation with maintainers or counsel.
- Open issue counts and GitHub stars are treated as signals only and are not used to draw definitive conclusions about production readiness or market penetration (per editorial rules).

## Sources

- Twenty canonical repository: https://github.com/twentyhq/twenty
- Twenty latest GitHub release (sdk/v2.37.0): https://github.com/twentyhq/twenty/releases/tag/sdk/v2.37.0

## FAQ

### What is the single authoritative source for Twenty?
The canonical project repository on GitHub (twentyhq/twenty) is the primary technical source; it links out to the website and documentation. See the repository for code, README guidance, and links to docs and community channels. [Twenty canonical repository].

### Is Twenty available as a cloud service and for self-hosting?
Yes. The README references a cloud pathway via twenty.com and also points to self-hosting options (Docker Compose and local setup doc links). Inspect the README and docs linked from the repository to follow those flows. [Twenty canonical repository].

### How should I treat the repository's license field marked as NOASSERTION?
Treat NOASSERTION as a pointer to perform a manual license check: search the repository for a LICENSE file, consult contribution docs, or contact maintainers. Do not assume permissions from the metadata alone. [Twenty canonical repository].

### What do the GitHub star and fork counts mean here?
They are indicators of interest and visibility for the project (stars: 56,310; forks: 8,939 in the repository metadata snapshot). They are not measures of production adoption or market share. [Twenty canonical repository].

### Where can I find the release notes and breaking changes?
The releases page for the repository contains the latest release notes; the most recent release used in this guide is sdk/v2.37.0, published 2026-08-28, which includes breaking changes and migration items. Review the changelog for upgrade planning. [Twenty latest GitHub release].

### How do I evaluate the SDK and app-publishing workflow?
Follow the README examples that import from the SDK and use the CLI scaffolding to create a minimal app; publish it to a test workspace (the README demonstrates a private app publish command). This practical test validates the developer experience. [Twenty canonical repository].

### Who should I contact for licensing questions or contribution guidance?
Use the repository's community channels and contribution guide links—README includes links to Discord, discussions, and contribution docs to engage maintainers and community members. [Twenty canonical repository].
