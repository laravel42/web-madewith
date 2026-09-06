---
title: "Twenty: Open CRM ecosystem guide and evaluation"
description: "A technical ecosystem map for Twenty (twentyhq/twenty): core repo, integration patterns, maintenance signals, licensing notes, and a practical discovery workflow."
excerpt: "A practical, evidence-grounded ecosystem guide for Twenty (twentyhq/twenty). Core repo snapshot, inferred architecture, integration patterns, evaluation checklist and maintenance signals."
slug: "twenty-open-crm-ecosystem-guide"
date: "2026-07-24"
updated: "2026-07-24"
author: "MWW Editorial Team"
category: "Ecosystem Guide"
primaryTechnology: "Twenty"
searchIntent: "informational"
primaryKeyphrase: "Twenty CRM"
secondaryKeyphrases:
  - "open-source CRM"
  - "twentyhq/twenty"
  - "self-hosting CRM"
  - "twenty SDK"
  - "CRM integration patterns"
  - "CRM evaluation checklist"
tags:
  - "Twenty"
  - "CRM / ERP"
  - "Ecosystem Guide"
  - "GitHub"
  - "Open Source"
canonical: "https://madewithwhat.net/blog/twenty-open-crm-ecosystem-guide"
image: "/assets/2026/07/24/ecosystem-guide-twenty-2-cover.jpg"
openGraph:
  title: "Twenty: Open CRM ecosystem guide and evaluation"
  description: "A technical ecosystem map for Twenty (twentyhq/twenty): core repo, integration patterns, maintenance signals, licensing notes, and a practical discovery workflow."
  image: "/assets/2026/07/24/ecosystem-guide-twenty-2-cover.jpg"
  type: article
jsonLd: "[{\"@context\":\"https://schema.org\",\"@type\":\"TechArticle\",\"headline\":\"Twenty: Open CRM ecosystem guide and evaluation\",\"description\":\"A technical ecosystem map for Twenty (twentyhq/twenty): core repo, integration patterns, maintenance signals, licensing notes, and a practical discovery workflow.\",\"datePublished\":\"2026-07-24\",\"dateModified\":\"2026-07-24\",\"author\":{\"@type\":\"Organization\",\"name\":\"MWW Editorial Team\"},\"publisher\":{\"@type\":\"Organization\",\"name\":\"MadeWithWhat\"},\"mainEntityOfPage\":\"https://madewithwhat.net/blog/twenty-open-crm-ecosystem-guide\",\"image\":\"https://madewithwhat.net/assets/2026/07/24/ecosystem-guide-twenty-2-cover.jpg\",\"keywords\":[\"Twenty\",\"CRM / ERP\",\"Ecosystem Guide\",\"GitHub\",\"Open Source\"],\"about\":[{\"@type\":\"Thing\",\"name\":\"Twenty\"}]},{\"@context\":\"https://schema.org\",\"@type\":\"FAQPage\",\"mainEntityOfPage\":\"https://madewithwhat.net/blog/twenty-open-crm-ecosystem-guide\",\"mainEntity\":[{\"@type\":\"Question\",\"name\":\"What is the authoritative source of truth for Twenty's code and releases?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"The canonical repository is [twentyhq/twenty on GitHub](https://github.com/twentyhq/twenty). Releases are published in the repository's Releases section; the latest release at the time of this guide is sdk/v2.37.0 (published 2026-08-28).\"}},{\"@type\":\"Question\",\"name\":\"Can I use Twenty in production immediately?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"This guide does not make deployment decisions. Before production use, verify license terms (the GitHub license field is NOASSERTION), validate a production-ready deployment in staging, and confirm support and upgrade plans with maintainers or vendors.\"}},{\"@type\":\"Question\",\"name\":\"Is Twenty actively maintained?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Repository timestamps show recent pushes and updates (pushed_at 2026-09-05, updated_at 2026-09-06) and a recent release (sdk/v2.37.0). These are positive maintenance signals but should be supplemented by reviewing commit and PR activity for the specific subsystems you plan to use.\"}},{\"@type\":\"Question\",\"name\":\"What infrastructure does Twenty expect?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"The project lists PostgreSQL and Redis and uses NestJS and BullMQ in the stack description. Use those as initial infrastructure targets for any self-hosted deployment, then confirm exact version and sizing requirements from the project's docs.\"}},{\"@type\":\"Question\",\"name\":\"How should I handle the \\\"NOASSERTION\\\" license field?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"Search the repository for an explicit LICENSE or licensing statement. If none is present, contact the maintainers to request license clarification before incorporating the code into commercial products.\"}},{\"@type\":\"Question\",\"name\":\"Where can I find more documentation and help?\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"The README includes links to the project's website, documentation site, roadmap, Discord, and Figma assets. Use those channels for product docs and community support; see the repository links for exact destinations.\"}}]}]"
---
![descriptive alt text](/assets/2026/07/24/ecosystem-guide-twenty-2-cover.jpg)

## Table of contents

- [Executive answer](#executive-answer)
- [Repository snapshot (evidence)](#repository-snapshot-evidence)
- [Core repository and inferred architecture](#core-repository-and-inferred-architecture)
- [Project categories and integration patterns](#project-categories-and-integration-patterns)
- [Evaluation criteria: how to vet Twenty for your project](#evaluation-criteria-how-to-vet-twenty-for-your-project)
- [Maintenance signals and what they mean](#maintenance-signals-and-what-they-mean)
- [Licensing considerations](#licensing-considerations)
- [Practical discovery and evaluation workflow (step-by-step)](#practical-discovery-and-evaluation-workflow-step-by-step)
- [Action checklist](#action-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Sources](#sources)

## Executive answer

Twenty (repository: twentyhq/twenty) is an open-source CRM codebase and platform intended as an alternative to proprietary CRMs. The project provides a full-stack monorepo (TypeScript, React front end and NestJS-based backend) with documentation, a published SDK/release cycle, and explicit paths for cloud and self-hosted deployments. The repository shows active maintenance signals (recent releases and recent pushes) and community activity, but its license status is listed as "NOASSERTION" in the GitHub metadata and should be reviewed before production use.

If you are evaluating Twenty for integration or self-hosting, treat the repo as a building block: assess compatibility with your infrastructure (PostgreSQL, Redis), verify license and acceptable usage, validate the SDK and APIs in a small proof-of-concept, and adopt clear maintenance criteria (release cadence, issue/PR activity, and upgrade paths) before entrusting critical business logic to the codebase. Data in this guide was retrieved from the repository and release pages on 2026-09-06; see the Sources section for links.

## Repository snapshot (evidence)

The table below condenses facts taken from the canonical repository and its latest release (data retrieved 2026-09-06). All entries are taken from the project's GitHub metadata and release notes; interpret quantitative signals (stars, issues) as indicators, not absolutes.

| Item | Value |
|---|---:|
| Repository | [twentyhq/twenty](https://github.com/twentyhq/twenty) |
| Description (repo) | The open alternative to Salesforce, designed for AI. |
| Primary language | TypeScript |
| Stars | 56,309 |
| Forks | 8,939 |
| Watchers | 225 |
| Open issues (GitHub) | 166 |
| License (GitHub field) | NOASSERTION |
| Topics (selected) | crm, graphql, monorepo, nestjs, postgresql, react, typescript |
| Created at | 2022-12-01T13:04:40Z |
| Latest push (pushed_at) | 2026-09-05T22:12:25Z |
| Latest update (updated_at) | 2026-09-06T01:20:31Z |
| Default branch | main |
| Homepage | https://twenty.com |
| Archived | false |
| Latest published release | sdk/v2.37.0 (published 2026-08-28) |

Source: [Twenty canonical repository](https://github.com/twentyhq/twenty) and [Twenty latest GitHub release](https://github.com/twentyhq/twenty/releases/tag/sdk/v2.37.0).

> [!NOTE]
> Stars and forks are interest signals, not measures of production usage. Open issues are not a defect count; they reflect the repo's tracking state at the snapshot time (2026-09-06).

## Core repository and inferred architecture

What the repo advertises and the signals visible in metadata and README-derived summaries indicate a modern, monorepo approach with a full-stack codebase and separation between server and client concerns.

- Observable facts (from the repository metadata and README): the codebase is TypeScript-based, references Nx and NestJS in its stack list, uses PostgreSQL and Redis, and includes React for the front-end. The project publishes an SDK/release series (latest tag sdk/v2.37.0) and documents cloud and self-hosted deployment options.

- Inferred architectural conclusions (explicitly labeled inference):
  - Inference: The repository layout and mention of "monorepo" in topics plus multiple packages shown in README indicate a monorepo structure hosting server, client, SDKs, and website packages. This is inferred from README and topics, not from an exhaustive code scan in this guide.
  - Inference: The use of NestJS, BullMQ, PostgreSQL, and Redis suggests a server architecture that uses queues and relational storage for business objects and background processing; this inference is based on technologies listed in the README and topics.

These elements together point to an extensible platform that exposes primitives for apps, objects, workflows, and agent/AI features (as described in the project's documentation links). The repo surface includes developer-facing artifacts: docs links, a CLI scaffolding reference, and a release changelog.

### Visual: high-level component map

```mermaid
flowchart TB
  subgraph Repo[twofold: twentyhq/twenty]
    SDK[SDK & Manifests]
    Server[Server (NestJS + BullMQ)]
    Client[Client (React)]
    Tools[CLI, Docs, Website]
  end

  DB[PostgreSQL]
  Cache[Redis]
  Cloud[Cloud-hosted workspace]
  SelfHost[Self-host (Docker Compose)]

  SDK --> Server
  Client --> SDK
  Server --> DB
  Server --> Cache
  Server -->|publishes| Cloud
  Server -->|deploys| SelfHost
  Tools -->|scaffold| Client
  Tools -->|publish| SDK
```

> [!TIP]
> The diagram is an inferred, high-level view based on stack declarations and README-supplied deployment paths. Confirm concrete package boundaries and dependency graphs by inspecting the repository locally before major integration work.

## Project categories and integration patterns

Twenty presents multiple integration touchpoints. Below are pragmatic patterns you will encounter and when to use them.

| Integration pattern | What it connects | When to use | Evidence from repo/readme |
|---|---|---|---|
| Cloud workspace (hosted) | Twenty cloud workspaces and hosted instances | Fast evaluation, avoid infra overhead, teams wanting managed upgrades | README references a cloud signup path at twenty.com and a zero-infra demo route (README content paraphrased). |
| Self-host (Docker Compose) | Your infrastructure (DB, Redis, background workers) | You need data residency, custom infra, or deeper control | README points to self-hosting via Docker Compose and local setup documentation. |
| App/SDK extension | In-repo SDKs, manifest enums, apps published to workspace | Extend objects, views, agents; version control of CRM behavior | README describes apps and an SDK; release notes include SDK and manifest typing changes. |
| API/GraphQL integration | External systems calling Twenty APIs | Real-time integrations, BI, external syncs | Topics include graphql; SDK/release notes discuss API and client-sdk types. |
| UI embedding / headless | Front-end embedding or customizing views | If you want custom UI or embed parts in another product | Project uses React and offers app/view primitives (README references UI primitives). |

> [!WARNING]
> Do not treat the GitHub topics or README as a complete integration contract. Verify API stability and migration paths via the repository's changelog and release notes before building production integrations.

## Evaluation criteria: how to vet Twenty for your project

Use the checklist below to transform repository signals into a go/no-go assessment. Each item references repository facts or reasonable verification steps.

Table: Evaluation criteria and how to measure them

| Criterion | Why it matters | How to verify (practical step) |
|---|---|---|
| License clarity | Legal and compliance constraints determine allowable use and redistribution | The GitHub license field is "NOASSERTION" — confirm actual license in repo files or contact maintainers. Do not proceed without explicit license terms. See Sources. |
| Release cadence & changelog | Predictable upgrades and visible breaking-change communication reduce upgrade risk | Check latest release (sdk/v2.37.0 published 2026-08-28) and review previous tags and changelogs in the Releases UI to understand frequency and breaking-change announcements. |
| Active maintenance | Fresh commits, recent pushes, merged PRs indicate ongoing maintenance | Repository pushed_at and updated_at show activity as of 2026-09-05/2026-09-06. Inspect commit history and PR merge rates for the subsystems you're using. |
| Security posture | Vulnerability reporting, advisories, or disclosed CVEs matter for production use | Look for a SECURITY.md, vuln disclosures, and GitHub Advisory entries. In absence, treat as unknown and plan for independent audits. |
| API/SDK stability | Compatibility guarantees for SDKs and manifests are needed for long-lived integrations | The release notes mention changes to SDK types and manifest enums; run a small POC using the SDK manifest types to detect breaking changes. |
| Operational dependencies | Required infra (PostgreSQL, Redis, BullMQ) affects hosting and SRE burden | README lists PostgreSQL and Redis. Validate your capacity to run these components and the resource limits they imply. |
| Community & contribution flow | A healthy backlog of contributors and a clear roadmap reduces integration risk | Repo lists docs, roadmap links, Discord and community channels. Check contribution guidelines and open discussions. |

## Maintenance signals and what they mean

Interpret these GitHub signals cautiously and always corroborate with code-level checks and test runs.

- Release activity: The repo has a recent release tag (sdk/v2.37.0, published 2026-08-28). Use Releases to review breaking changes and migration notes before upgrading.
- Push/update timestamps: pushed_at 2026-09-05 and updated_at 2026-09-06 indicate recent activity at the time this guide was generated (2026-09-06). Recent pushes imply active development but also potential churn.
- Stars and forks: 56,309 stars and 8,939 forks are strong interest signals. Treat them as indicators of community attention, not confirmation of production-grade usage for your specific workload.
- Open issues: 166 open issues reflect current tracking; do not assume they are defects — some may be feature requests or roadmap items.
- License field: NOASSERTION requires explicit review; a missing or ambiguous license on GitHub is a gating factor for commercial deployment.

> [!TIP]
> Track the repository for a few release cycles and monitor a small fork or pinned commit before upgrading a production instance. Evaluate the upgrade path from one SDK/release tag to the next on a staging environment.

![descriptive alt text](/assets/2026/07/24/ecosystem-guide-twenty-2-data.jpg)

## Licensing considerations

The repository's GitHub license field is set to "NOASSERTION" in the metadata snapshot taken 2026-09-06. "NOASSERTION" means GitHub's metadata does not assert a detected license; it does not specify what license the project authors intend.

Actionable steps:
- Do not infer permissive or copyleft rights from the GitHub metadata alone. Search the repository for a LICENSE file or statements in the docs; if none exist, contact maintainers for clarification.
- If you cannot obtain a clear license, treat the codebase as legally unclear and avoid embedding it into products with restrictive IP policies.

## Practical discovery and evaluation workflow (step-by-step)

1. Snapshot metadata (local): clone the repository at the tag you plan to evaluate and record default_branch, latest tag, published_at, and commit hash.
2. Confirm license: look for a LICENSE file, contributor covenant, or explicit license in repository files. If GitHub shows NOASSERTION, escalate to maintainers or legal counsel.
3. Run a smoke deployment: follow the project's local-setup or Docker Compose instructions (README references Docker Compose for self-hosting). Validate DB migrations, background workers, and web UI in an isolated environment.
4. Validate APIs: use the published SDK or GraphQL endpoints to exercise read/write operations for sample objects. Confirm API shapes against the SDK manifest typing mentioned in the release notes.
5. Test upgrade path: simulate an upgrade by moving between two consecutive SDK/release tags in a staging environment. Evaluate migration scripts and schema changes.
6. Audit dependencies: scan for known-vulnerable dependencies and check for a vulnerability disclosure or SECURITY.md.
7. Operationalize: plan backups, job queue monitoring (BullMQ), DB maintenance, and rate limits. The release notes mention usage-limit entities and API rate-limiting features; review those entries for operational configuration.

Decision checklist (condensed)

- [ ] Verified license and acceptable terms
- [ ] Successful local deployment with DB and Redis
- [ ] SDK/API functional for intended integration flows
- [ ] Upgrade path tested in staging
- [ ] Security scan completed and acceptable risk
- [ ] Monitoring and backups planned for self-hosted deployment

## Action checklist

- Fork the repo and pin to a commit or tag for your POC.
- Run a Docker Compose self-hosted instance (README indicates such an option) in a sandbox account.
- Confirm manifest and SDK types used by your app components; the release notes mention typing improvements to the SDK manifest enums.
- Perform a dependency vulnerability scan and request or check for a SECURITY.md.
- If deploying to production, obtain explicit license confirmation and an SLA/operational plan if using the cloud offering.

## Evidence, assumptions, and limitations

Evidence used in this guide
- Repository metadata (stars, forks, language, topics, created_at, pushed_at, updated_at, default_branch, homepage, archived) and README-derived stack descriptions are sourced from the canonical GitHub repository snapshot. Source: [Twenty canonical repository](https://github.com/twentyhq/twenty).
- Release-level details (latest release tag sdk/v2.37.0, published_at 2026-08-28, release notes) are taken from the project's Releases UI. Source: [Twenty latest GitHub release](https://github.com/twentyhq/twenty/releases/tag/sdk/v2.37.0).
- Data retrieval/generation date: 2026-09-06 (see generated_at in the editorial payload). Use that date when interpreting freshness.

Explicit assumptions and labeled inferences
- Inference: Monorepo structure and package separation are inferred from README references to a multi-package layout and the "monorepo" topic. This guide did not perform a full codebase dependency graph; that must be confirmed during local inspection.
- Inference: Server-side architecture (NestJS, BullMQ, PostgreSQL, Redis) is deduced from the stack list in the README and topics. The precise coupling and module boundaries require a code-level review.

## Limitations
- This guide relies solely on the supplied repository metadata and release notes. It does not include proprietary documentation, internal support contracts, or runtime telemetry from deployed instances.
- Licensing status is uncertain (GitHub shows NOASSERTION). This is a gating factor and outside the scope of purely technical vetting.
- No independent security audit was performed. Any claims about security posture are limited to whether the repo includes visible security documentation and whether a public release exists.

## FAQ

### What is the authoritative source of truth for Twenty's code and releases?
The canonical repository is [twentyhq/twenty on GitHub](https://github.com/twentyhq/twenty). Releases are published in the repository's Releases section; the latest release at the time of this guide is sdk/v2.37.0 (published 2026-08-28).

### Can I use Twenty in production immediately?
This guide does not make deployment decisions. Before production use, verify license terms (the GitHub license field is NOASSERTION), validate a production-ready deployment in staging, and confirm support and upgrade plans with maintainers or vendors.

### Is Twenty actively maintained?
Repository timestamps show recent pushes and updates (pushed_at 2026-09-05, updated_at 2026-09-06) and a recent release (sdk/v2.37.0). These are positive maintenance signals but should be supplemented by reviewing commit and PR activity for the specific subsystems you plan to use.

### What infrastructure does Twenty expect?
The project lists PostgreSQL and Redis and uses NestJS and BullMQ in the stack description. Use those as initial infrastructure targets for any self-hosted deployment, then confirm exact version and sizing requirements from the project's docs.

### How should I handle the "NOASSERTION" license field?
Search the repository for an explicit LICENSE or licensing statement. If none is present, contact the maintainers to request license clarification before incorporating the code into commercial products.

### Where can I find more documentation and help?
The README includes links to the project's website, documentation site, roadmap, Discord, and Figma assets. Use those channels for product docs and community support; see the repository links for exact destinations.

## Sources

- Twenty canonical repository: https://github.com/twentyhq/twenty
- Twenty latest GitHub release: https://github.com/twentyhq/twenty/releases/tag/sdk/v2.37.0
