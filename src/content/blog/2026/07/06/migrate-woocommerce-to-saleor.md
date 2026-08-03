---
title: "Migrate from WooCommerce to Saleor — Decision & Execution Guide"
description: "A practical migration guide from WooCommerce to Saleor: suitability, inventory, phased plan, tests, data/API concerns, rollback gates, and when not to migrate."
excerpt: "Practical decision and execution guidance for teams considering a migration from WooCommerce (WordPress plugin monorepo) to Saleor (headless GraphQL commerce)."
slug: "migrate-woocommerce-to-saleor"
date: "2026-07-06"
updated: "2026-07-06"
author: "MWW Editorial Team"
category: "Migration Guide"
primaryTechnology: "WooCommerce"
secondaryTechnology: "Saleor"
searchIntent: "commercial-investigation"
primaryKeyphrase: "migrate WooCommerce to Saleor"
secondaryKeyphrases:
  - "WooCommerce migration"
  - "Saleor migration"
  - "headless commerce migration"
  - "WooCommerce to Saleor migration plan"
  - "GraphQL commerce"
  - "WooCommerce compatibility risks"
tags:
  - "WooCommerce"
  - "Commerce"
  - "Migration Guide"
  - "Saleor"
  - "GitHub"
  - "Open Source"
canonical: "https://madewithwhat.net/blog/migrate-woocommerce-to-saleor"
image: "/assets/2026/07/06/migration-guide-woocommerce-saleor-9-cover.jpg"
openGraph:
  title: "Migrate from WooCommerce to Saleor — Decision & Execution Guide"
  description: "A practical migration guide from WooCommerce to Saleor: suitability, inventory, phased plan, tests, data/API concerns, rollback gates, and when not to migrate."
  image: "/assets/2026/07/06/migration-guide-woocommerce-saleor-9-cover.jpg"
  type: article
jsonLd: "{\"@context\":\"https://schema.org\",\"@type\":\"TechArticle\",\"headline\":\"Migrate from WooCommerce to Saleor — Decision & Execution Guide\",\"description\":\"A practical migration guide from WooCommerce to Saleor: suitability, inventory, phased plan, tests, data/API concerns, rollback gates, and when not to migrate.\",\"datePublished\":\"2026-07-06\",\"dateModified\":\"2026-07-06\",\"author\":{\"@type\":\"Organization\",\"name\":\"MWW Editorial Team\"},\"publisher\":{\"@type\":\"Organization\",\"name\":\"MadeWithWhat\"},\"mainEntityOfPage\":\"https://madewithwhat.net/blog/migrate-woocommerce-to-saleor\",\"image\":\"https://madewithwhat.net/assets/2026/07/06/migration-guide-woocommerce-saleor-9-cover.jpg\",\"keywords\":[\"WooCommerce\",\"Commerce\",\"Migration Guide\",\"Saleor\",\"GitHub\",\"Open Source\"],\"about\":[{\"@type\":\"Thing\",\"name\":\"WooCommerce\"},{\"@type\":\"Thing\",\"name\":\"Saleor\"}]}"
---
Executive summary

This guide helps engineering teams decide whether and how to migrate an existing WooCommerce store into Saleor, and provides a practical, phased execution plan with test strategy, data and API considerations, rollback gates, and explicit cases where migration is not justified. It synthesizes repository facts and architecture signals from the official repositories for WooCommerce and Saleor and maps them to typical migration concerns for product catalogs, orders, customers, extensions, and integrations.

Short answer: choose Saleor if you need a composable, API-first (GraphQL) commerce backend and are prepared to reimplement WordPress-specific plugins, theming, and PHP-based extensions. Stay with WooCommerce if your stack, extensions, or business processes are tightly coupled to WordPress, you depend on many PHP plugins that would be costly to reimplement, or you need a low-friction route for small stores without dedicated engineering resources.

Repository facts and retrieval date

- WooCommerce canonical repository: https://github.com/woocommerce/woocommerce (metadata retrieved 2026-07-13) — monorepo with plugins, PHP plus JS tooling; README documents PHP 7.4+ and a PNPM-based build flow. See the repo for details.
- WooCommerce latest release referenced: 10.9.4 (published 2026-07-07) [release page cited].
- Saleor canonical repository: https://github.com/saleor/saleor (metadata retrieved 2026-07-13) — API-first, GraphQL-native, headless commerce written in Python; README describes an API-only architecture and points to headless storefront/dashboard projects.

See Sources at the end for links to these repositories and releases.

Table of contents

- [Decision summary and suitability assessment](#decision-summary-and-suitability-assessment)
- [Inventory and discovery checklist](#inventory-and-discovery-checklist)
- [Compatibility risks and mapping matrix](#compatibility-risks-and-mapping-matrix)
- [Phased migration plan (high level) with Mermaid flow](#phased-migration-plan-high-level-with-mermaid-flow)
- [Test strategy and verification gates](#test-strategy-and-verification-gates)
- [Data, API, and integration concerns](#data-api-and-integration-concerns)
- [Rollback gates and cutover criteria](#rollback-gates-and-cutover-criteria)
- [When migration is not justified](#when-migration-is-not-justified)
- [Decision / Action checklist](#decision--action-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [Sources](#sources)
- [FAQs](#faqs)

![WooCommerce to Saleor migration cover](/assets/2026/07/06/migration-guide-woocommerce-saleor-9-cover.jpg)

> [!NOTE]
> Repository signals for WooCommerce were collected at generation time and should be re-checked before production decisions.

> [!TIP]
> Start with a narrow integration spike, then expand scope only after observability and rollback paths are in place.

> [!WARNING]
> GitHub stars, fork counts, and open-issue totals are weak proxies for security or operational readiness.

## Table of contents

- [Decision summary and suitability assessment](#decision-summary-and-suitability-assessment)
- [Inventory and discovery checklist](#inventory-and-discovery-checklist)
- [Compatibility risks and mapping matrix](#compatibility-risks-and-mapping-matrix)
- [Phased migration plan (high level) with Mermaid flow](#phased-migration-plan-high-level-with-mermaid-flow)
- [Test strategy and verification gates](#test-strategy-and-verification-gates)
- [Data, API, and integration concerns](#data-api-and-integration-concerns)
- [Rollback gates and cutover criteria](#rollback-gates-and-cutover-criteria)
- [When migration is not justified](#when-migration-is-not-justified)
- [Decision / Action checklist](#decision-action-checklist)
- [Evidence, assumptions, and limitations](#evidence-assumptions-and-limitations)
- [FAQs](#faqs)

## Decision summary and suitability assessment

Use these decision signals to decide whether to move from WooCommerce to Saleor.

Table: suitability quick-check

| Criterion | Strong signal for Saleor | Strong signal for staying on WooCommerce |
|---|---:|---|
| Desire for API-first/GraphQL backend and headless storefront(s) | Yes — Saleor is described as GraphQL-native and API-only in its README ([Saleor repo](https://github.com/saleor/saleor)). | No |
| Core business logic implemented as WordPress plugins, short-term migration budget limited | No | Yes — WooCommerce is packaged as WordPress plugins per the repo README ([WooCommerce repo](https://github.com/woocommerce/woocommerce)). |
| Need to decouple front-end and scale API endpoints independently | Yes | Maybe — WooCommerce is a plugin ecosystem running on WordPress/PHP; architecture inferred as plugin/monolith style (see section below). |
| Team expertise in Python/Django + GraphQL vs PHP/WordPress | Yes (Python + GraphQL) | Yes (PHP + WordPress) |
| Reliance on specific WooCommerce extensions/themes not replaceable | No | Yes |

[!NOTE]
This table synthesizes signals from project READMEs and repository structure. Architectural conclusions that are inferred from READMEs or repository structure are explicitly labeled where used.


Inferred architecture notes (explicitly labeled):

- From the WooCommerce README and repository structure we infer that the project is delivered as WordPress plugins within a monorepo and relies on the WordPress plugin architecture and PHP runtime. This is an inferred conclusion based on README content and repository layout.
- From the Saleor README we infer an API-only, GraphQL-first, headless architecture that separates backend, storefront, and dashboard into distinct components. This is also inferred from the README and linked storefront/dashboard repos.

Caveat: these are architectural inferences from repository documentation rather than runtime telemetry.

## Inventory and discovery checklist

Before you plan work, audit the current store. Run a discovery pass using the following inventory table; treat it as required input for sizing and timeline estimates.

Table: discovery inventory (fill during discovery)

| Category | Questions to answer | Example data points to collect |
|---|---|---|
| Platform & runtime | WordPress & WooCommerce versions, PHP version, hosting type | e.g., WordPress 6.x, WooCommerce plugin 10.9.4, PHP 7.4+ (see [WooCommerce README](https://github.com/woocommerce/woocommerce)) |
| Extensions & plugins | List of installed plugins (premium + custom) and whether source is available | plugin name, vendor, purpose, hooks used, DB tables created |
| Themes & storefront | Is storefront a custom WP theme or page-builder site? | theme files, template overrides, shortcodes, WP hooks used |
| Data volumes | Product SKUs, SKUs with variants, orders, customers, attachments | counts of products, images, orders, customer records |
| Integrations | Payment gateways, shipping, ERP, PIM, analytics | endpoints, webhooks, authentication method |
| Customizations | Any PHP code, WP filters/actions, database migrations | plugin code locations, custom DB tables |
| Operational needs | SLAs, peak traffic, multi-channel, multi-currency | traffic spike profile, scale requirements |

Collecting the inventory establishes what must be migrated (data) and what must be reimplemented (custom logic, integrations, storefronts).

[!TIP]
Export lists of active plugins and a plugin file tree from the WordPress install; that output is the canonical compatibility list for migration scoping.

## Compatibility risks and mapping matrix

The core technical gap when migrating from WooCommerce to Saleor is runtime and extension model: WooCommerce is delivered as WordPress plugins (PHP) and Saleor is an API-first Python GraphQL application. That implies risks and required rework in several areas.

Table: compatibility risk mapping

| Surface | Risk | Mitigation / Mapping strategy |
|---|---|---|
| Themes / storefront | WooCommerce storefronts are typically implemented as WordPress themes and templates; Saleor expects headless storefronts (separate repo). | Rebuild storefront using a front-end framework that consumes Saleor GraphQL APIs (Saleor provides example storefronts). Consider incremental parallel-run with headless storefront for specific channels. |
| Plugins & extensions | PHP plugins (payment, shipping, promotions) rely on WP hooks and PHP code. | For each plugin: 1) replace with existing Saleor app or integration, 2) implement custom business logic as a separate microservice or Saleor app that integrates via GraphQL, webhooks, or middleware. |
| Data model differences | Product, inventory, order schemas differ; custom product attributes in WooCommerce may map differently in Saleor. | Define canonical data model for migration; transform exports to Saleor schema; plan reconciliation for attributes, SKUs, variants, taxes. |
| Payment gateways | Some WooCommerce payment plugins may not exist as ready Saleor integrations. | Use payment gateway providers with server-side APIs; implement payment service that talks to Saleor payment flow or use Saleor's payment API extension points. |
| SEO & URLs | Existing SEO URLs and content hosted in WordPress may need redirects. | Preserve SEO by exporting slugs and mapping redirect rules at CDN/load-balancer level; implement server-side redirects for existing URLs. |
| Webhooks & integrations | Existing integrations triggered by WP actions will not fire for Saleor. | Re-implement integrations to consume Saleor events/webhooks or use middleware to forward events during cutover. |

[!WARNING]
Do not assume 1:1 mapping for plugin behavior. Any plugin that modifies order flows, tax calculations, or payments must be validated end-to-end in a test environment before cutover.

## Phased migration plan (high level) with Mermaid flow

Phases: Assess → Prototype → Parallelize → Migrate data → Cutover → Stabilize.

```mermaid
flowchart TD
  A[Assess & Inventory] --> B[Prototype key flows]
  B --> C[Build integrations & storefront]
  C --> D[Parallel validation (shadow/dual-write)]
  D --> E[Data migration dry runs]
  E --> F[Cutover decision gate]
  F --> G[Cutover & freeze writes to WooCommerce]
  G --> H[Final migration & switch traffic]
  H --> I[Post-cutover validation & monitoring]
  I --> J[Stabilize & retire old platform]
```

Phase details

1. Assess & Inventory (2–4 weeks typical for mid-sized stores)
- Complete the Inventory table above.
- Identify critical plugins and integrations; classify as Replace / Reimplement / Keep (through middleware).

2. Prototype key flows (2–6 weeks)
- Implement a minimal Saleor deployment (local or cloud) and a sample storefront that implements: product listing, product detail, checkout, order creation, and a single payment gateway integration. Saleor README points to storefront and dashboard repositories for examples ([Saleor repo](https://github.com/saleor/saleor)).
- Validate that core business flows can be implemented with Saleor APIs.

3. Build integrations & storefront (several sprints)
- Reimplement or replace plugins as apps/microservices integrating with Saleor via GraphQL/webhooks.
- Rebuild storefront or adapt an existing headless storefront.

4. Parallel validation (shadow or dual-write)
- Run Saleor in parallel: replicate catalog and simulate or mirror traffic (read-only for live orders) to validate order handling, inventory reconciliation, and webhooks.

5. Data migration dry runs
- Export product, customer, order data from WooCommerce and write transformation scripts into Saleor schema; run dry-runs in staging.

6. Cutover decision gate
- Only proceed if test scenarios, reconciliation thresholds, and performance baselines are met (see Test strategy).

7. Cutover & final migration
- Put WooCommerce into write-freeze (or enable dual-write if you have an idempotent sync layer). Run final migration for delta changes and switch storefront traffic to the new storefront.

8. Post-cutover stabilization
- Monitor errors, reconcile orders/customers, disable old cron hooks, and decommission WP-specific services on a controlled timeline.

## Test strategy and verification gates

Testing is the safety net for this migration. Organize tests into unit, integration, contract, performance smoke, and end-to-end acceptance.

Test matrix (examples)

| Test type | Scope | Acceptance criteria | Responsible |
|---|---:|---|---|
| Unit tests | Data transformation scripts | All transforms have unit coverage for edge cases | Devs |
| Integration tests | Payment gateway, shipping, ERP sync | Orders created in Saleor produce same downstream effects (ledger entries, shipping labels) as WooCommerce | Integrations team |
| Contract tests | GraphQL APIs consumed by storefront | GraphQL schema queries used by storefront return expected fields and types | API team |
| End-to-end (E2E) | Checkout, payment, order lifecycle | E2E flows succeed for sample SKUs and coupon scenarios | QA |
| Performance smoke | Catalog browse and checkout under expected load | Response latencies within agreed SLAs for critical endpoints | SRE |

Verification gates (go/no-go) for cutover

- All critical E2E scenarios pass in staging for three consecutive test runs.
- Data reconciliation: product counts, inventory totals, and sample order checks match within an agreed delta threshold.
- Integrations are verified with production sandboxes (payment, shipping) and webhooks are delivered reliably.
- Monitoring and alerting are in place for errors and latency post-cutover.

[!TIP]
Automate data reconciliation checks (row counts, checksum on product slugs and inventory sums) and run them as part of every dry-run to quantify migration correctness.

## Data, API, and integration concerns

Data model and export

- WooCommerce stores product, order, and customer data in WordPress tables and plugin-specific tables. Export methods vary; use WP-CLI exports or database dumps as discovery outputs.
- Saleor expects a different schema (product variants, channels, GraphQL types). Plan ETL scripts that map fields and transform attachments (images) to Saleor storage.

API differences and integration patterns

- WooCommerce extends WordPress PHP runtime with hooks and plugins; custom logic often runs inside the same process. In contrast, Saleor is API-only and exposes business functionality via GraphQL and webhooks (inferred from Saleor README).
- Strategy: move in-process custom logic into external apps or services that integrate via GraphQL mutations/subscriptions or via asynchronous webhooks.

Handling payments and sensitive data

- Payment data handling often keeps card data with PSPs. Reuse payment providers’ server-side SDKs and adapt the payment flow to Saleor's payment extension points. Validate PCI compliance posture during migration and ensure tokens and payment records are migrated only per PSP guidance.

Search and SEO

- If you currently rely on WordPress for SEO-managed content (pages, blogs, product descriptions with shortcodes), plan for content migration. Keep URL preservation and create 301 redirects for legacy product and category URLs.

![Migration data mapping example](/assets/2026/07/06/migration-guide-woocommerce-saleor-9-data.jpg)

## Rollback gates and cutover criteria

Rollback gates are explicit conditions under which you will revert to WooCommerce after attempting cutover. Establish these before migration and automate detection where possible.

Rollback criteria (examples)

- Production error rate for checkout or order creation exceeds threshold (e.g., X% — define per SLA) for Y minutes post-cutover.
- Downstream systems (payment/fulfillment) report critical failures that cannot be mitigated within the rollback window.
- Reconciliation mismatch exceeds allowable delta after final migration run.

Cutover checklist (must be green before switch)

- Final data migration dry-run done and validated.
- Integrations in production or in verified sandboxes.
- Staging E2E tests passed repeatedly.
- Monitoring, alerts, and rollback plan reviewed and communicated.

[!WARNING]
Do not remove write access to the old system until the final migration has completed and reconciliation is verified. If you must freeze writes, communicate clearly to stakeholders and automate delta capture.

## When migration is not justified

Migration to Saleor is not justified in these cases:

- Your store depends on many proprietary WordPress/WooCommerce plugins that have no acceptable replacement in Saleor and the cost/time to reimplement them exceeds business benefit.
- Your team lacks bandwidth or experience to rebuild storefronts, integrations, and to operate a headless, API-first stack (Saleor is headless by design; see README).
- Your business model is simple (single-store, low traffic) and the current WooCommerce implementation meets requirements without frequent breaking changes or scaling needs.

If the main driver is a desire for incremental improvements without a large engineering investment, consider optimizing the current WooCommerce stack (caching, host scaling, plugin audit) instead of a full migration.

## Decision / Action checklist

- [ ] Complete inventory spreadsheet for plugins, themes, integrations, and data volumes.
- [ ] Prototype core flows with Saleor and a sample storefront (product listing, checkout, payment, order lifecycle).
- [ ] For each plugin, decide Replace / Reimplement / Keep (via middleware).
- [ ] Implement data transformation scripts and run reconciliation dry-runs.
- [ ] Run integration tests with payment and shipping sandboxes.
- [ ] Define cutover windows, rollback criteria, and monitoring dashboards.
- [ ] Communicate schedule to business, support, and partners.
- [ ] Execute cutover with write-freeze plan and post-cutover verification.

## Evidence, assumptions, and limitations

Evidence used

- The guide references repository metadata and READMEs for both projects: WooCommerce repository and latest release information ([WooCommerce repo], [WooCommerce release]) and Saleor repository ([Saleor repo]). These are the sources listed in the Sources section. The repository metadata was retrieved on 2026-07-13.

Assumptions made (explicit)

- Saleor’s architecture is API-first and GraphQL native; this is stated in the Saleor README and used as the basis for integration recommendations.
- WooCommerce is distributed as a WordPress plugin monorepo and requires PHP runtime; this is stated in the WooCommerce README and used to infer plugin-dependency risks.
- No internal telemetry, customer-specific plugin lists, or environment details were available; the guide assumes a typical WooCommerce install that uses plugins and themes as described in the README.

Limitations

- This guide does not provide step-by-step code for migrations because specifics vary per store: plugin list, custom code, and hosting environment drive the work.
- The guide does not include performance benchmarks or cost modeling. Those require environment-specific measurement and were not available from the supplied sources.

## Sources

- WooCommerce canonical repository: https://github.com/woocommerce/woocommerce
- WooCommerce latest GitHub release (10.9.4): https://github.com/woocommerce/woocommerce/releases/tag/10.9.4
- Saleor canonical repository: https://github.com/saleor/saleor

## FAQs

1) Q: Can I migrate product data automatically from WooCommerce to Saleor?
A: Yes—you can export product, customer, and order data from WooCommerce and transform it to Saleor’s schema. However, transformations are often required for variants, attributes, and custom fields. Run dry-runs and automated reconciliation before final cutover.

2) Q: Will my WooCommerce plugins work in Saleor?
A: Not directly. Plugins that rely on WordPress hooks or execute PHP in-process must be reimplemented as external integrations, Saleor apps, or replaced with equivalent services that integrate via Saleor’s GraphQL API or webhooks.

3) Q: Is Saleor a hosted service or self-hosted?
A: Saleor provides an open-source API-first core; its README references a cloud offering and example storefronts, but the canonical repository is an open-source project you can self-host. Check the Saleor docs for deployment options (see [Saleor repo]).

4) Q: How long does a typical migration take?
A: Duration varies widely based on plugin count, customizations, and data volume. Use the inventory discovery to estimate scope; a basic proof-of-concept can take weeks, full migrations months.

5) Q: How do I preserve SEO and URLs?
A: Preserve or map slugs during migration and implement 301 redirects for legacy WordPress URLs at the CDN/edge or in the web server that fronts your storefront.

6) Q: Can I run both platforms in parallel?
A: Yes—run Saleor in parallel for testing and use dual-write or event-mirroring strategies to validate flows. Ensure reconciliation and idempotency in your sync approach.

7) Q: Where can I find sample storefront code for Saleor?
A: Saleor README links to storefront and dashboard repositories with examples and starters (see [Saleor repo]).


<!-- SEO and schema block (for editors to copy into CMS) -->

Title: Migrate from WooCommerce to Saleor — Decision & Execution Guide
Meta description: A practical migration guide from WooCommerce to Saleor: suitability, inventory, phased plan, tests, data/API concerns, rollback gates, and when not to migrate.
Canonical URL: https://madewithwhat.net/migrate-woocommerce-to-saleor
Open Graph Title: Migrate from WooCommerce to Saleor — Decision & Execution Guide
Open Graph Description: Practical decision and execution guidance for teams considering a migration from WooCommerce (WordPress plugin monorepo) to Saleor (headless GraphQL commerce).

Article schema (JSON-LD) example (to be placed in page head by publisher):

```json
{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "Migrate from WooCommerce to Saleor — Decision & Execution Guide",
  "name": "Migrate from WooCommerce to Saleor — Decision & Execution Guide",
  "description": "A practical migration guide from WooCommerce to Saleor: suitability, inventory, phased plan, tests, data/API concerns, rollback gates, and when not to migrate.",
  "author": {"@type": "Organization", "name": "MadeWithWhat"},
  "publisher": {"@type": "Organization", "name": "MadeWithWhat", "url": "https://madewithwhat.net"},
  "datePublished": "2026-07-06",
  "dateModified": "2026-07-13"
}
```

## FAQ

### Can I migrate product data automatically from WooCommerce to Saleor?

Yes—you can export product, customer, and order data from WooCommerce and transform it to Saleor’s schema. Transformations are often required for variants, attributes, and custom fields. Run dry-runs and automated reconciliation before final cutover.

### Will my WooCommerce plugins work in Saleor?

Not directly. Plugins that rely on WordPress hooks or execute PHP in-process must be reimplemented as external integrations, Saleor apps, or replaced with equivalent services that integrate via Saleor’s GraphQL API or webhooks.

### Is Saleor a hosted service or self-hosted?

Saleor is an open-source, API-first core that you can self-host; the project README also references a cloud offering and example storefronts. Check Saleor documentation and repositories for deployment options.

### How long does a migration typically take?

Duration varies based on plugin count, customizations, and data volume. Use a discovery inventory to estimate scope: a proof-of-concept can take weeks; a full migration may take several months.

### How do I preserve SEO when migrating?

Preserve or map slugs during migration, and implement 301 redirects for legacy WordPress URLs at the CDN, edge, or web server that fronts your storefront.

### Can I run WooCommerce and Saleor in parallel during migration?

Yes. Run Saleor in parallel for testing and use dual-write or event-mirroring strategies to validate flows. Ensure reconciliation and idempotency in your sync approach.

### Where can I find example storefront code for Saleor?

The Saleor repository README links to storefront and dashboard repositories with example storefronts and starters; see the Saleor canonical repository.
