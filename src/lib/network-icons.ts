/** Icon slug + availability map from MadeWithWhat.dc.html handoff. */

const SLUG_OVERRIDES: Record<string, string> = {
  "ASP.NET Core": "dotnet",
  "Next.js": "nextdotjs",
  Nuxt: "nuxt",
  "Vue.js": "vuedotjs",
  "Alpine.js": "alpinedotjs",
  SolidJS: "solid",
  SvelteKit: "svelte",
  "Ruby on Rails": "rubyonrails",
  "Spring Boot": "springboot",
  "Payload CMS": "payloadcms",
  OctoberCMS: "octobercms",
  "Twenty CRM": "twenty",
  Phoenix: "phoenixframework",
};

const AVAILABLE = new Set([
  "laravel", "symfony", "django", "rubyonrails", "springboot", "dotnet", "nextdotjs", "nuxt",
  "astro", "svelte", "react", "vuedotjs", "angular", "solid", "alpinedotjs", "jquery", "ionic",
  "preact", "qwik", "lit", "express", "nestjs", "fastapi", "flask", "gin", "fastify", "hono",
  "koa", "rocket", "phoenixframework", "wordpress", "drupal", "joomla", "strapi", "directus",
  "ghost", "octobercms", "statamic", "payloadcms", "odoo", "erpnext", "dolibarr", "twenty",
  "monica", "prestashop", "woocommerce", "shopware", "medusa", "ollama", "langchain", "dify",
  "haystack", "vllm",
]);

export function networkIconSlug(techName: string): string {
  return SLUG_OVERRIDES[techName] ?? techName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasNetworkIcon(techName: string): boolean {
  return AVAILABLE.has(networkIconSlug(techName));
}

export function networkIconHref(techName: string): string {
  return `/icons/${networkIconSlug(techName)}.svg`;
}
