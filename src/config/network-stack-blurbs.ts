/** Short SEO stack blurbs for network landing cards — what the technology is. */
export const NETWORK_STACK_BLURBS: Record<string, string> = {
  // Frameworks
  laravel:
    "Laravel is the most popular PHP full-stack framework for modern web apps, APIs, and SaaS products.",
  symfony:
    "Symfony is a battle-tested PHP framework and component set for enterprise apps, APIs, and CMS platforms.",
  django:
    "Django is Python’s high-level web framework for secure, database-backed apps shipped fast.",
  rails:
    "Ruby on Rails is the convention-over-configuration framework behind countless production web apps.",
  "spring-boot":
    "Spring Boot is the standard Java framework for production microservices, APIs, and enterprise backends.",
  "aspnet-core":
    "ASP.NET Core is Microsoft’s cross-platform framework for high-performance web apps and APIs.",
  next:
    "Next.js is the React framework for full-stack web apps with SSR, SSG, and App Router.",
  nuxt:
    "Nuxt is the Vue.js meta-framework for SSR websites, content sites, and production SPAs.",
  astro:
    "Astro is a content-first web framework that ships zero JS by default for ultra-fast sites.",
  sveltekit:
    "SvelteKit is the full-stack framework for Svelte apps with routing, SSR, and adapters.",

  // Frontend
  react:
    "React is the leading JavaScript library for building interactive UIs and component-driven apps.",
  vue:
    "Vue.js is a progressive JavaScript framework for approachable, high-performance web UIs.",
  angular:
    "Angular is Google’s TypeScript framework for large-scale, structured single-page applications.",
  svelte:
    "Svelte compiles components to tiny vanilla JS — a reactive UI framework with minimal runtime.",
  solidjs:
    "SolidJS is a fine-grained reactive UI library that delivers React-like DX with top performance.",
  alpine:
    "Alpine.js is a lightweight JavaScript framework for declarative interactivity in HTML.",
  jquery:
    "jQuery is the classic JavaScript library for DOM, Ajax, and cross-browser web scripting.",
  ionic:
    "Ionic is a cross-platform toolkit for building mobile and desktop apps with web technologies.",
  preact:
    "Preact is a 3KB React-compatible UI library for fast, lightweight frontends.",
  qwik:
    "Qwik is a resumable web framework designed for instant-loading apps with minimal hydration.",
  lit:
    "Lit is a simple library for building fast, standards-based web components.",

  // Backend
  express:
    "Express is the minimal Node.js web framework for APIs, servers, and middleware-based apps.",
  nestjs:
    "NestJS is a TypeScript Node framework for scalable server-side apps inspired by Angular.",
  fastapi:
    "FastAPI is a modern Python framework for high-performance APIs with automatic OpenAPI docs.",
  flask:
    "Flask is a lightweight Python microframework for APIs, dashboards, and small web services.",
  gin:
    "Gin is a fast HTTP web framework for Go, built for APIs and microservices.",
  fiber:
    "Fiber is an Express-inspired web framework for Go focused on speed and low memory use.",
  fastify:
    "Fastify is a low-overhead Node.js web framework for high-throughput APIs and services.",
  hono:
    "Hono is a tiny, ultrafast web framework that runs on Cloudflare, Deno, Bun, and Node.",
  koa:
    "Koa is a modern Node.js middleware framework from the Express team, built on async/await.",
  "actix-web":
    "Actix Web is a powerful, pragmatic Rust framework for fast and reliable HTTP services.",
  rocket:
    "Rocket is a type-safe Rust web framework for APIs and apps with a focus on usability.",
  phoenix:
    "Phoenix is Elixir’s real-time web framework for channels, LiveView, and scalable backends.",

  // CMS / CRM
  wordpress:
    "WordPress is the world’s most widely used CMS for blogs, sites, and content platforms.",
  drupal:
    "Drupal is an enterprise-grade CMS for complex content sites, portals, and digital experiences.",
  joomla:
    "Joomla is a flexible open-source CMS for websites, portals, and multilingual content.",
  strapi:
    "Strapi is a headless Node.js CMS for custom APIs and content-driven frontends.",
  directus:
    "Directus turns any SQL database into a headless CMS with a realtime API and admin app.",
  ghost:
    "Ghost is a modern publishing platform for professional blogs, newsletters, and memberships.",
  octobercms:
    "October CMS is a Laravel-based CMS for custom websites and content applications.",
  statamic:
    "Statamic is a flat-file Laravel CMS for developer-friendly sites without a heavy database.",
  payload:
    "Payload is a TypeScript headless CMS and app framework built for Next.js developers.",
  twill:
    "Twill is an open-source Laravel CMS toolkit for editorial sites and custom content apps.",
  odoo:
    "Odoo is an open-source suite of business apps covering CRM, ERP, accounting, and more.",
  erpnext:
    "ERPNext is a full open-source ERP for manufacturing, inventory, accounting, and CRM.",
  suitecrm:
    "SuiteCRM is an open-source CRM for sales, marketing, support, and customer workflows.",
  espocrm:
    "EspoCRM is a flexible open-source CRM for sales pipelines, cases, and team collaboration.",
  dolibarr:
    "Dolibarr is an open-source ERP/CRM for SMEs covering invoicing, CRM, and stock.",
  "twenty-crm":
    "Twenty is a modern open-source CRM built as a fresh alternative to Salesforce-style tools.",
  vtiger:
    "Vtiger CRM is an open-source platform for sales automation, support, and marketing.",
  monica:
    "Monica is an open-source personal CRM for tracking relationships and personal contacts.",

  // Commerce
  magento:
    "Magento (Adobe Commerce) is a powerful open-source platform for large-scale online stores.",
  prestashop:
    "PrestaShop is an open-source e-commerce platform for catalogs, checkout, and storefronts.",
  woocommerce:
    "WooCommerce is the leading WordPress e-commerce plugin for shops of every size.",
  shopware:
    "Shopware is a modern open-source commerce platform for customizable storefronts and B2B.",
  bagisto:
    "Bagisto is a Laravel-based open-source e-commerce framework for multi-channel stores.",
  saleor:
    "Saleor is a GraphQL-first, headless open-source commerce platform for modern storefronts.",
  medusa:
    "Medusa is a modular, Node.js commerce engine for customizable headless storefronts.",
  opencart:
    "OpenCart is a free PHP e-commerce platform for product catalogs and online storefronts.",

  // AI / LLM
  ollama:
    "Ollama runs large language models locally with a simple API for private AI apps.",
  langchain:
    "LangChain is the framework for building LLM apps with chains, agents, tools, and memory.",
  llamaindex:
    "LlamaIndex is a data framework for connecting LLMs to documents, APIs, and knowledge bases.",
  flowise:
    "Flowise is a low-code UI for building LLM flows and agents on top of LangChain.",
  dify:
    "Dify is an open-source LLM app platform for RAG pipelines, agents, and AI workflows.",
  "open-webui":
    "Open WebUI is a self-hosted chat interface for local and remote LLMs like Ollama.",
  librechat:
    "LibreChat is an open-source ChatGPT-style UI for multi-provider LLM conversations.",
  anythingllm:
    "AnythingLLM is an all-in-one app for private RAG chat over your documents and data.",
  haystack:
    "Haystack is an open-source framework for building production search and RAG pipelines.",
  vllm:
    "vLLM is a high-throughput inference engine for serving large language models at scale.",
};
