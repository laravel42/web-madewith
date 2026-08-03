---
title: "EspoCRM architecture analysis: modular PHP CRM with SPA frontend"
description: "An evidence-grounded architecture analysis of EspoCRM (espocrm/espocrm): modules, extension points, scaling boundaries, and what public repo metadata does and doesn't reveal."
excerpt: "A technical analysis of EspoCRM's architecture based on the public repository (espocrm/espocrm). Includes modules, extension points, operational implications, scaling boundaries, and explicit inferences and limitations."
slug: "espocrm-architecture-analysis"
date: "2026-07-21"
updated: "2026-07-21"
author: "MWW Editorial Team"
category: "Architecture Analysis"
primaryTechnology: "EspoCRM"
searchIntent: "informational"
primaryKeyphrase: "EspoCRM architecture"
secondaryKeyphrases:
  - "espocrm"
  - "CRM architecture"
  - "PHP REST API"
  - "single-page application"
  - "metadata-driven CRM"
  - "open-source CRM"
tags:
  - "EspoCRM"
  - "CRM / ERP"
  - "Architecture Analysis"
  - "GitHub"
  - "Open Source"
canonical: "https://madewithwhat.net/blog/espocrm-architecture-analysis"
image: "/assets/2026/07/21/architecture-analysis-espocrm-36-cover.jpg"
openGraph:
  title: "EspoCRM architecture analysis: modular PHP CRM with SPA frontend"
  description: "An evidence-grounded architecture analysis of EspoCRM (espocrm/espocrm): modules, extension points, scaling boundaries, and what public repo metadata does and doesn't reveal."
  image: "/assets/2026/07/21/architecture-analysis-espocrm-36-cover.jpg"
  type: article
jsonLd: "{\"@context\":\"https://schema.org\",\"@type\":\"TechArticle\",\"headline\":\"EspoCRM architecture analysis: modular PHP CRM with SPA frontend\",\"description\":\"An evidence-grounded architecture analysis of EspoCRM (espocrm/espocrm): modules, extension points, scaling boundaries, and what public repo metadata does and doesn't reveal.\",\"datePublished\":\"2026-07-21\",\"dateModified\":\"2026-07-21\",\"author\":{\"@type\":\"Organization\",\"name\":\"MWW Editorial Team\"},\"publisher\":{\"@type\":\"Organization\",\"name\":\"MadeWithWhat\"},\"mainEntityOfPage\":\"https://madewithwhat.net/blog/espocrm-architecture-analysis\",\"image\":\"https://madewithwhat.net/assets/2026/07/21/architecture-analysis-espocrm-36-cover.jpg\",\"keywords\":[\"EspoCRM\",\"CRM / ERP\",\"Architecture Analysis\",\"GitHub\",\"Open Source\"],\"about\":[{\"@type\":\"Thing\",\"name\":\"EspoCRM\"}]}"
---
![EspoCRM cover image](/assets/2026/07/21/architecture-analysis-espocrm-36-cover.jpg)

Executive summary

EspoCRM is an open-source CRM platform implemented as a PHP-based REST API backend paired with a single-page application (SPA) frontend. The public repository (espocrm/espocrm) identifies a metadata-driven architecture, dependency injection in the backend, a custom frontend framework partially written in TypeScript, and support for MySQL/MariaDB and PostgreSQL. Repository metadata (stars, branches, license) and the README provide concrete facts about supported runtimes, project orientation, and recent releases; this analysis relies only on that public evidence and labeled inferences where the repository structure suggests design decisions.

Operationally, EspoCRM appears designed for on-premise or self-hosted deployments with extensibility via metadata, custom entities, and a plugin/extension approach. The architecture supports separation of concerns: a PHP REST API, a metadata layer driving entities and forms, and an SPA frontend. Scalability implications and operational boundaries (connection pooling, horizontal scaling behavior, caching, and performance characteristics) are inferred where the public repo structure hints at them, and limitations are explicitly identified where public metadata does not allow firm conclusions.

Table of contents

- [Key repository facts (evidence)](#key-repository-facts-evidence)
- [High-level architecture and data flow](#high-level-architecture-and-data-flow)
- [Module and directory mapping (evidence + inferences)](#module-and-directory-mapping-evidence--inferences)
- [Extension points and customization model](#extension-points-and-customization-model)
- [Operational implications and scaling boundaries](#operational-implications-and-scaling-boundaries)
- [What cannot be concluded from public metadata](#what-cannot-be-concluded-from-public-metadata)
- [Decision checklist / Action checklist](#decision-checklist--action-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [Sources](#sources)
- [FAQs](#faqs)


## Table of contents

- [Key repository facts (evidence)](#key-repository-facts-evidence)
- [High-level architecture and data flow](#high-level-architecture-and-data-flow)
- [Module and directory mapping (evidence + inferences)](#module-and-directory-mapping-evidence-inferences)
- [Extension points and customization model](#extension-points-and-customization-model)
- [Operational implications and scaling boundaries](#operational-implications-and-scaling-boundaries)
- [What cannot be concluded from public metadata](#what-cannot-be-concluded-from-public-metadata)
- [Decision checklist / Action checklist](#decision-checklist-action-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [Visual data excerpt](#visual-data-excerpt)
- [Two summary tables](#two-summary-tables)
- [Implementation and integration notes (practical guidance)](#implementation-and-integration-notes-practical-guidance)
- [FAQs](#faqs)

## Key repository facts (evidence)

The following table summarizes verifiable repository metadata taken from the project's public GitHub repository and latest release. Data retrieval/generation date: 2026-07-13T02:11:31.647300+00:00.

| Attribute | Value | Source / notes |
|---|---:|---|
| Repository | espocrm/espocrm | [GitHub repository](https://github.com/espocrm/espocrm) |
| Primary language | PHP | repo metadata |
| License | AGPL-3.0 | repo metadata and LICENSE file |
| Stars (signal) | 3,134 | repo metadata (interest signal; not usage) |
| Forks | 897 | repo metadata |
| Open issues | 59 | repo metadata (signal; not defect count) |
| Default branch | master | repo metadata |
| Latest release tag | 10.0.2 (published 2026-07-10) | [release notes](https://github.com/espocrm/espocrm/releases/tag/10.0.2) |
| Supported runtimes (README) | PHP 8.3–8.5; MySQL 8.0+, MariaDB 10.3+, PostgreSQL 15+ | README in repository |
| Frontend model (README) | Single-page application (SPA); custom frontend framework; core partially TypeScript | README |
| Backend model (README) | REST API in PHP; metadata-driven; DI and SOLID principles | README |

> [!NOTE]
> These are direct facts pulled from the repository metadata and README. GitHub stars and open issues are interest signals, not measures of production usage or code quality.


## High-level architecture and data flow

The README clearly states the architecture pattern: a PHP REST API backend and an SPA frontend. From those facts we can synthesize a canonical request flow:

- Browser (SPA) issues HTTP requests to backend REST API endpoints.
- Backend authenticates, validates, executes business logic, and persists to relational database (MySQL/MariaDB/PostgreSQL supported).
- A metadata layer describes entities, fields, relationships, and UI layout; that metadata informs both backend behavior and frontend forms/views.

Mermaid diagram (inferred interactions labeled where appropriate):

```mermaid
flowchart LR
  Browser[Browser / SPA frontend]
  API[PHP REST API (backend)]
  Metadata[Metadata layer (JSON Schema)]
  DB[(Relational DB: MySQL / MariaDB / PostgreSQL)]
  Extensions[(Extensions / Customizations)]
  Browser -->|XHR / fetch| API
  API -->|reads/writes| DB
  API -->|loads| Metadata
  Browser -->|renders using| Metadata
  Extensions -->|hook into| API
  Extensions -->|augment| Metadata
  note right of Metadata: README: metadata described with JSON Schema
```

> [!TIP]
> The README indicates the metadata is expressed as JSON Schema; this enables IDE autocompletion and is a strong signal the platform treats metadata as first-class configuration for entities and forms.


## Module and directory mapping (evidence + inferences)

The repository's README and the project's description indicate certain high-level modules: backend PHP code, frontend SPA code, metadata, and developer docs. The table below maps expected directories/areas to responsibilities and states which items are direct evidence (explicit in README or repo metadata) vs. inferred from structure or README prose.

| Module / Directory (likely) | Responsibility (synthesized) | Evidence in repo/README | Inference label |
|---|---|---:|---|
| backend/ or application/ (PHP codebase) | REST API endpoints, business logic, DI, services, authentication | README: "REST API backend written in PHP"; mentions DI and SOLID | Inferred: exact top-level directory names and internal packages from typical PHP projects (not confirmed) |
| frontend/ or client/ (SPA) | Single-page application, nested views, form/field views, some TypeScript | README: "frontend is an SPA built on a custom framework... core partially written in TypeScript" | Inferred: directory layout and build tools (e.g., webpack) not provided in README |
| metadata/ (JSON Schema files) | Entity and UI metadata expressed as JSON Schema; drives forms and autocompletion | README: "All possible parameters are described with a JSON Schema" | Evidence: metadata exists; structure inferred |
| docs/ and developer docs | Documentation for administrators, users, developers | README links to https://docs.espocrm.com | Evidence: public docs site referenced |
| translations/ (POEditor integration) | Localization strings, translations managed via POEditor | README mentions POEditor project | Inferred: repository contains translation files synchronized from POEditor (not verified here) |
| extensions/ or custom/ | Custom entities, fields, integrations, extensions | README: "You can develop features, create custom entities..." | Inferred: mechanism for installing/packaging extensions (composer packages, modules) not specified in README |

> Explicit inference examples:
> - Inference: directory names (backend/, frontend/) are not quoted in README; they are inferred because the README describes the backend and frontend responsibilities but does not list paths. This is an explicit inference.


## Extension points and customization model

Direct evidence from the README:

- "Custom entities, fields, relationships, buttons" and "EspoCRM is a platform for building custom business applications." (README)
- "Metadata plays an integral role... described with a JSON Schema" (README)
- The README recommends reading the Dependency Injection article in the docs and calls out service DI in the frontend.

Interpretation (inferred; labeled):

- Inference: The metadata JSON Schema is the primary extension surface that defines entities and UI. Because metadata is machine-readable JSON Schema, it is reasonable to infer that both the backend and frontend read the same metadata structures to render forms and validate data.

- Inference: Dependency Injection (DI) and interfaces in the backend imply a plugin-friendly service architecture where implementations can be swapped or extended by registering new services. The README's recommendation to read the DI documentation supports this but the exact extension registration mechanism (e.g., service provider files, configuration keys, or container bootstrap) is not shown in the README and thus is inferred.

- Inference: The frontend's "nested views" and "form and field view implementations" suggest a component-like view system where developers extend or override existing view classes to customize UI behavior. The exact API for adding frontend plugins or overriding views is not provided in the README and is therefore an inference.

Practical extension operations (inferred):

- Add new entity: likely involves adding JSON metadata, optional PHP backend model/service, and optional frontend field/view definitions.
- Add new field type: likely requires frontend view/renderer and backend storage/validation hooks.


## Operational implications and scaling boundaries

What the repository and README tell us (evidence):

- Supported databases: MySQL 8.0+, MariaDB 10.3+, PostgreSQL 15+.
- PHP runtime: 8.3–8.5.
- The application is an SPA talking to a PHP REST API (stateless request/response pattern implied but not explicitly stated).

Inference-labeled operational implications:

- Inference: Because the backend is a REST API, horizontal scaling of the API servers behind a load balancer is likely feasible. However, the README does not specify session management strategy (server-side sessions, JWT, stateless cookies), so whether load-balanced instances require sticky sessions cannot be concluded from public metadata.

- Inference: Supported relational databases indicate transactional consistency for CRM operations. However, the README does not describe native clustering, sharding, or multi-node database topology—those remain operational design choices for deployers.

- Inference: Metadata-driven runtime suggests configuration and UI changes can be deployed without code recompilation for the frontend if the frontend can load metadata at runtime. The README does not confirm whether the SPA fetches metadata dynamically or if metadata is compiled into frontend bundles.

- Inference: The README's mention of Docker and Traefik examples indicates official or community-supported container-based deployment patterns exist; this suggests ease of containerization but does not provide performance characteristics or recommended resource allocations.

Limitations (evidence-backed):

- The public repository and README do not contain performance benchmarks, recommended CPU/memory sizing, or guidance on concurrency limits. Any capacity planning must be derived from load testing in your environment.

> [!WARNING]
> Do not assume that presence of Docker examples equals production-hardening: containerized deployment examples often prioritize reproducible deployment over tuned production defaults.


## What cannot be concluded from public metadata

This section lists operational, performance, and internal implementation details that are not determinable from the public repository README and metadata alone.

- Exact runtime behavior for authentication/session management (token formats, expiration, session storage) — not specified.
- Database schema details beyond the fact that relational DBs are supported — table layout, indices, and query patterns require code inspection and runtime profiling.
- Specific horizontal-scaling constraints like whether background job processing or real-time features (e.g., WebSockets) are built-in and how they scale — README does not enumerate async job workers or real-time subsystems.
- Third-party service integration readiness (rate-limiting, retry behavior, circuit breakers) — not specified in public metadata.
- Security posture beyond license and public code: e.g., known vulnerabilities, CVE statuses, or patch frequency — cannot be inferred solely from stars, commits, or release cadence.
- Exact extension packaging and deployment lifecycle for custom modules — README references extensions but does not provide the packaging mechanism in the README text.

> [!NOTE]
> The README includes helpful design guidance (DI, JSON Schema metadata, SPA frontend). However, determining production suitability requires inspection of code paths, testing, and reading developer docs beyond the README.


## Decision checklist / Action checklist

Use this checklist when planning to evaluate or adopt EspoCRM for production use.

- [ ] Read the full developer documentation at https://docs.espocrm.com for DI patterns, extension APIs, and deployment guidance. (evidence: README links to docs)
- [ ] Inspect the repository's backend code and container examples to confirm session strategy and any implemented caching layers. (inference: README references Docker)
- [ ] Run integration tests and load tests against a representative deployment to measure resource usage and concurrency behavior. (limitation: no performance data in repo)
- [ ] Review the metadata JSON Schema files (in repo) to understand extension surface and automate entity creation. (evidence: README states metadata is JSON Schema)
- [ ] Verify database schema and index strategy from repository or by creating a sample dataset and profiling queries. (limitation: schema not in README)
- [ ] Evaluate upgrade/migration approach by testing upgrades from a staging instance using the repo's releases. (evidence: releases exist)
- [ ] Check licensing (AGPL-3.0) for compliance with intended deployment and distribution model. (evidence: README and license)


## Evidence, assumptions, and limitations

Evidence (explicit public facts):

- The repository espocrm/espocrm on GitHub is public and licensed under AGPL-3.0. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))
- README states: PHP 8.3–8.5 required; MySQL 8.0+, MariaDB 10.3+, PostgreSQL 15+. It describes a REST API backend and an SPA frontend; it states metadata is described with JSON Schema; it mentions DI and SOLID principles. (README) [data retrieval date: 2026-07-13]
- Latest release tag available at time of analysis: 10.0.2 (published 2026-07-10). (release page) [data retrieval date: 2026-07-13]

Assumptions and explicit inferences (labeled):

- Inference: Directory layout and implementation patterns (e.g., exact folder names for backend/frontend) are typical for similar projects; the README does not enumerate folders. This is an inference.
- Inference: Metadata-driven UI implies frontend and backend read common metadata structures; the README confirms metadata existence but not whether the SPA fetches metadata at runtime or builds it into bundles. This is an inference.
- Inference: DI and SOLID principles imply extension-friendly service registration. The README suggests DI is used but the registration mechanics are not documented in the README; thus this is an inference.

Limitations (what public metadata cannot show):

- The internal implementation details, performance characteristics, and operational trade-offs require code-level review, profiling, and real deployments.
- Security posture and vulnerability exposure require dedicated security scanning and cannot be assumed from repo metadata alone.


## Visual data excerpt

![EspoCRM repository data](/assets/2026/07/21/architecture-analysis-espocrm-36-data.jpg)


## Two summary tables

Table A — Project metadata and release cadence (facts only)

| Item | Value |
|---|---|
| Repository | espocrm/espocrm |
| License | AGPL-3.0 |
| Stars (GitHub) | 3,134 |
| Forks | 897 |
| Open issues | 59 |
| Default branch | master |
| Latest tag | 10.0.2 (published 2026-07-10) |
| README language | English |

Table B — Architectural claims and provenance (evidence vs inference)

| Claim | Provenance | Labeled as |
|---|---:|---|
| Backend is a PHP REST API | README explicitly states this | Evidence |
| Frontend is an SPA built on a custom framework | README explicitly states this | Evidence |
| Metadata described with JSON Schema | README explicitly states this | Evidence |
| Uses Dependency Injection and SOLID design | README explicitly states this | Evidence |
| Frontend core partially TypeScript | README explicitly states this | Evidence |
| Horizontal scaling is feasible | Inferred from stateless REST API pattern; not explicitly documented | Inference |
| Extension registration mechanism (how to install extensions) | Not documented in README | Cannot conclude |
| Session storage approach (stateless vs sticky sessions) | Not documented | Cannot conclude |


## Implementation and integration notes (practical guidance)

- Inspect the developer documentation linked from the README before implementing customizations; the README directs developers to the DI article in docs, suggesting there are documented best practices. (evidence: README -> docs)

- Because metadata is expressed with JSON Schema, tooling to edit metadata (IDE autocompletion, validation) can be integrated into development workflows. (evidence: README)

- License implications: AGPL-3.0 may impose obligations for network-distributed modifications; consult legal counsel if you plan to redistribute a modified instance. (evidence: LICENSE in repo)


## Sources

- EspoCRM canonical repository: https://github.com/espocrm/espocrm
- EspoCRM latest GitHub release: https://github.com/espocrm/espocrm/releases/tag/10.0.2


## FAQs

1. Q: Does EspoCRM provide a REST API backend and an SPA frontend?
   A: Yes. The README explicitly states the backend is a REST API written in PHP and the frontend is a single-page application using a custom framework. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))

2. Q: What runtimes and databases are supported?
   A: The README lists PHP 8.3–8.5 and relational databases: MySQL 8.0+, MariaDB 10.3+, and PostgreSQL 15+. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))

3. Q: Can I extend EspoCRM with custom entities and fields?
   A: The README explicitly says you can develop features and create custom entities, fields, relationships, and buttons. It also notes metadata is described in JSON Schema to support these extensions. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))

4. Q: Is there an official Docker deployment path?
   A: The README references installation with Docker and Traefik, suggesting containerized deployment examples exist (see docs). For production hardening and resource sizing, consult the documentation and test in your environment. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))

5. Q: What license governs EspoCRM?
   A: EspoCRM is licensed under GNU AGPLv3 as stated in the repository. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))

6. Q: Where can I find developer guidance on DI and metadata?
   A: The README recommends the Dependency Injection article and developer documentation available at https://docs.espocrm.com. ([EspoCRM canonical repository](https://github.com/espocrm/espocrm))


---

Open Graph, canonical, and article schema (for reference)

Canonical URL: https://madewithwhat.net/espocrm-architecture-analysis

Open Graph fields (suggested):
```
og:title: EspoCRM architecture analysis: modular PHP CRM with SPA frontend
og:description: An evidence-grounded architecture analysis of EspoCRM (espocrm/espocrm): modules, extension points, scaling boundaries, and what public repo metadata does and doesn't reveal.
og:url: https://madewithwhat.net/espocrm-architecture-analysis
og:image: https://madewithwhat.net/assets/2026/07/21/architecture-analysis-espocrm-36-cover.jpg
og:type: article
```

Article schema (JSON-LD)

```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "EspoCRM architecture analysis: modular PHP CRM with SPA frontend",
  "description": "An evidence-grounded architecture analysis of EspoCRM (espocrm/espocrm): modules, extension points, scaling boundaries, and what public repo metadata does and doesn't reveal.",
  "author": {
    "@type": "Organization",
    "name": "MadeWithWhat"
  },
  "publisher": {
    "@type": "Organization",
    "name": "MadeWithWhat",
    "url": "https://madewithwhat.net"
  },
  "datePublished": "2026-07-21",
  "url": "https://madewithwhat.net/espocrm-architecture-analysis"
}
```

## FAQ

### Does EspoCRM provide a REST API backend and an SPA frontend?

Yes. The project's README explicitly states the backend is a REST API written in PHP and the frontend is a single-page application using a custom framework. (Source: repository README)

### What runtimes and databases are supported?

The README lists PHP 8.3–8.5 and relational databases: MySQL 8.0+, MariaDB 10.3+, and PostgreSQL 15+. (Source: repository README)

### Can I extend EspoCRM with custom entities and fields?

Yes. The README specifies that custom entities, fields, relationships, and buttons can be developed, and that metadata is described with JSON Schema to support customization. (Source: repository README)

### Is there an official Docker deployment path?

The README references installation with Docker and Traefik, indicating containerized deployment examples are documented; consult the project docs for details. (Source: repository README)

### What license governs EspoCRM?

EspoCRM is licensed under the GNU AGPLv3 as stated in the repository. (Source: repository LICENSE and README)

### Where can I find developer guidance on dependency injection and metadata?

The README recommends the Dependency Injection article and directs developers to the documentation at https://docs.espocrm.com for developer-oriented guidance. (Source: repository README)
