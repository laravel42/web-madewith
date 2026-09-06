"""Tech-specific discovery signals.

The discovery layer needs to know, for each technology:
  - what filenames GitHub search supports for `filename:<sig>` queries
  - what package names belong on `package.json:"<sig>"` / `requirements.txt`
  - what orgs are "vendor" orgs (boost, not penalty)
  - what alternate GitHub topic spellings exist beyond the canonical one

This file is the single source of truth. The catalog's per-domain
`scrape.fileSignals` / `scrape.packageSignals` / `scrape.vendorOrgs` /
`scrape.requireTopics` override the defaults here, so adding a new tech
is one entry below.
"""
from __future__ import annotations


# slug -> dict of signal lists. Keys missing from a tech default to [].
# Aliases here feed back into the publish-time topic gate as
# scrape.requireTopics, so a repo tagged with `reactjs` is still
# recognised as React.
SIGNALS: dict[str, dict] = {
    # ---- PHP frameworks / CMS / commerce ----
    "laravel": {
        "fileSignals": ["artisan", "composer.json"],
        "packageSignals": ["laravel/framework"],
        "vendorOrgs": ["laravel"],
        "aliases": ["laravel-framework", "laravel-package", "laravel5", "laravel6", "laravel7", "laravel8", "laravel9", "laravel10", "laravel11"],
    },
    "symfony": {
        "fileSignals": ["symfony.lock"],
        "packageSignals": ["symfony/framework-bundle"],
        "vendorOrgs": ["symfony"],
        "aliases": ["symfony-framework", "symfony2", "symfony3", "symfony4", "symfony5", "symfony6", "symfony7"],
    },
    "wordpress": {
        "fileSignals": ["wp-config.php", "style.css"],
        "packageSignals": [],
        "vendorOrgs": ["wordpress", "automattic", "wpengine"],
        "aliases": ["wordpress-plugin", "wordpress-theme", "wp-plugin", "wp-theme"],
    },
    "drupal": {
        "fileSignals": ["composer.json", ".drupal"],
        "packageSignals": ["drupal/core"],
        "vendorOrgs": ["drupal"],
        "aliases": ["drupal-module", "drupal-theme", "drupal8", "drupal9", "drupal10"],
    },
    "joomla": {
        "fileSignals": ["configuration.php"],
        "packageSignals": [],
        "vendorOrgs": ["joomla"],
        "aliases": ["joomla-cms", "joomla-extension"],
    },
    "magento": {
        "fileSignals": ["composer.json", "app/etc/local.xml"],
        "packageSignals": ["magento/module-catalog"],
        "vendorOrgs": ["magento"],
        "aliases": ["magento2", "magento-module", "magento-extension"],
    },
    "prestashop": {
        "fileSignals": ["config.xml"],
        "packageSignals": [],
        "vendorOrgs": ["prestashop"],
        "aliases": ["prestashop-module", "prestashop-theme"],
    },
    "shopware": {
        "fileSignals": ["composer.json"],
        "packageSignals": ["shopware/core"],
        "vendorOrgs": ["shopware"],
        "aliases": ["shopware6", "shopware-plugin"],
    },
    "bagisto": {
        "fileSignals": ["composer.json"],
        "packageSignals": ["bagisto/bagisto"],
        "vendorOrgs": ["bagisto"],
        "aliases": [],
    },
    "woocommerce": {
        "fileSignals": ["woocommerce.php"],
        "packageSignals": [],
        "vendorOrgs": ["woocommerce", "automattic"],
        "aliases": ["woo-commerce"],
    },
    "octobercms": {
        "fileSignals": ["composer.json", "october.yaml"],
        "packageSignals": ["october/system"],
        "vendorOrgs": ["octobercms"],
        "aliases": ["october"],
    },
    "statamic": {
        "fileSignals": ["composer.json"],
        "packageSignals": ["statamic/cms"],
        "vendorOrgs": ["statamic"],
        "aliases": [],
    },
    "payload": {
        "fileSignals": ["payload.config.ts", "payload.config.js"],
        "packageSignals": ["payload"],
        "vendorOrgs": ["payloadcms"],
        "aliases": ["payload-cms"],
    },
    "twill": {
        "fileSignals": ["twill.php"],
        "packageSignals": ["area17/twill"],
        "vendorOrgs": ["area17"],
        "aliases": [],
    },
    "strapi": {
        "fileSignals": ["config/database.js", "config/server.js"],
        "packageSignals": ["@strapi/strapi"],
        "vendorOrgs": ["strapi"],
        "aliases": [],
    },
    "directus": {
        "fileSignals": ["docker-compose.yml"],
        "packageSignals": ["directus"],
        "vendorOrgs": ["directus"],
        "aliases": [],
    },
    "ghost": {
        "fileSignals": [".ghost.json", "package.json"],
        "packageSignals": ["ghost"],
        "vendorOrgs": ["tryghost"],
        "aliases": ["ghost-cms", "ghost-theme"],
    },
    "saleor": {
        "fileSignals": ["pyproject.toml"],
        "packageSignals": ["saleor"],
        "vendorOrgs": ["saleor"],
        "aliases": ["saleor-commerce"],
    },
    "medusa": {
        "fileSignals": ["medusa-config.js", "medusa-config.ts"],
        "packageSignals": ["@medusajs/medusa"],
        "vendorOrgs": ["medusajs"],
        "aliases": ["medusa-js"],
    },
    "opencart": {
        "fileSignals": ["config.php"],
        "packageSingals": [],
        "vendorOrgs": ["opencart"],
        "aliases": [],
    },
    "odoo": {
        "fileSignals": ["__manifest__.py", "__openerp__.py"],
        "packageSignals": ["odoo"],
        "vendorOrgs": ["odoo", "oca"],
        "aliases": ["odoo-module", "odoo-addons"],
    },
    "erpnext": {
        "fileSignals": ["hooks.py", "pyproject.toml"],
        "packageSignals": ["erpnext"],
        "vendorOrgs": ["frappe", "erpnext"],
        "aliases": [],
    },
    "suitecrm": {
        "fileSignals": ["config.php"],
        "packageSignals": [],
        "vendorOrgs": ["salesagility", "suitecrm"],
        "aliases": [],
    },
    "espocrm": {
        "fileSignals": ["config.php", "application/Espo/"],
        "packageSignals": [],
        "vendorOrgs": ["espocrm"],
        "aliases": [],
    },
    "dolibarr": {
        "fileSignals": ["config.php", "fileconf.class.php"],
        "packageSignals": [],
        "vendorOrgs": ["dolibarr"],
        "aliases": [],
    },
    "twenty-crm": {
        "fileSignals": ["package.json"],
        "packageSignals": ["twenty"],
        "vendorOrgs": ["twentyhq"],
        "aliases": ["twenty"],
    },
    "vtiger": {
        "fileSignals": ["config.db.php", "vtigerversion.php"],
        "packageSignals": [],
        "vendorOrgs": ["vtigercrm"],
        "aliases": [],
    },
    "monica": {
        "fileSignals": ["composer.json"],
        "packageSignals": ["monica"],
        "vendorOrgs": ["monicahq"],
        "aliases": [],
    },
    # ---- Python ----
    "django": {
        "fileSignals": ["manage.py", "settings.py", "django.wsgi"],
        "packageSignals": ["django"],
        "vendorOrgs": ["django", "django-cms"],
        "aliases": ["django-rest-framework", "django-cms", "djangorestframework"],
    },
    "flask": {
        "fileSignals": ["wsgi.py"],
        "packageSignals": ["flask"],
        "vendorOrgs": ["pallets"],
        "aliases": [],
    },
    "fastapi": {
        "fileSignals": ["main.py"],
        "packageSignals": ["fastapi"],
        "vendorOrgs": ["tiangolo", "fastapi"],
        "aliases": [],
    },
    # ---- Ruby ----
    "rails": {
        "fileSignals": ["config.ru", "gemfile", "rakefile", "bin/rails"],
        "packageSignals": ["rails"],
        "vendorOrgs": ["rails", "railsadmin", "railsadminteam"],
        "aliases": ["ruby-on-rails", "ror", "rails7", "rails6"],
    },
    # ---- Java / JVM ----
    "spring-boot": {
        "fileSignals": ["pom.xml", "build.gradle", "application.yml", "application.properties"],
        "packageSignals": ["spring-boot-starter", "org.springframework.boot"],
        "vendorOrgs": ["spring-projects", "spring-cloud"],
        "aliases": ["springboot", "spring-boot-starter", "spring-cloud"],
    },
    # ---- .NET ----
    "aspnet-core": {
        "fileSignals": [".csproj", "startup.cs", "program.cs", "appsettings.json"],
        "packageSignals": ["microsoft.aspnetcore"],
        "vendorOrgs": ["dotnet", "aspnet", "microsoft"],
        "aliases": ["asp-net-core", "aspnetcore", "asp.net-core", "net-core", "dotnet-core"],
    },
    # ---- Frontend frameworks ----
    "next": {
        "fileSignals": ["next.config.js", "next.config.mjs", "next.config.ts"],
        "packageSignals": ["next"],
        "vendorOrgs": ["vercel"],
        "aliases": ["nextjs", "next-js"],
    },
    "nuxt": {
        "fileSignals": ["nuxt.config.ts", "nuxt.config.js"],
        "packageSignals": ["nuxt"],
        "vendorOrgs": ["nuxt"],
        "aliases": ["nuxtjs", "nuxt-js"],
    },
    "astro": {
        "fileSignals": ["astro.config.mjs", "astro.config.ts"],
        "packageSignals": ["astro"],
        "vendorOrgs": ["withastro"],
        "aliases": [],
    },
    "sveltekit": {
        "fileSignals": ["svelte.config.js", "vite.config.js"],
        "packageSignals": ["@sveltejs/kit"],
        "vendorOrgs": ["sveltejs"],
        "aliases": ["svelte-kit"],
    },
    "react": {
        "fileSignals": [],
        "packageSignals": ["react", "react-dom"],
        "vendorOrgs": ["facebook", "reactjs"],
        "aliases": ["reactjs", "react-js"],
    },
    "vue": {
        "fileSignals": ["vite.config.js", "vue.config.js"],
        "packageSignals": ["vue", "@vue/cli"],
        "vendorOrgs": ["vuejs"],
        "aliases": ["vuejs", "vue-js", "vue3"],
    },
    "angular": {
        "fileSignals": ["angular.json"],
        "packageSignals": ["@angular/core"],
        "vendorOrgs": ["angular"],
        "aliases": ["angularjs", "angular-js"],
    },
    "svelte": {
        "fileSignals": ["svelte.config.js", "svelte.config.cjs"],
        "packageSignals": ["svelte"],
        "vendorOrgs": ["sveltejs"],
        "aliases": [],
    },
    "solidjs": {
        "fileSignals": ["vite.config.ts", "app.config.ts"],
        "packageSignals": ["solid-js"],
        "vendorOrgs": ["solidjs"],
        "aliases": ["solid-js", "solid-start"],
    },
    "alpine": {
        "fileSignals": ["alpine.js"],
        "packageSignals": ["alpinejs"],
        "vendorOrgs": ["alpinejs"],
        "aliases": ["alpinejs", "alpine-js"],
    },
    "jquery": {
        "fileSignals": [],
        "packageSignals": ["jquery"],
        "vendorOrgs": ["jquery"],
        "aliases": [],
    },
    "ionic": {
        "fileSignals": ["ionic.config.json"],
        "packageSignals": ["@ionic/angular", "@ionic/react", "@ionic/vue"],
        "vendorOrgs": ["ionic-team"],
        "aliases": ["ionic-framework", "ionic-angular"],
    },
    "preact": {
        "fileSignals": ["preact.config.js"],
        "packageSignals": ["preact"],
        "vendorOrgs": ["preactjs"],
        "aliases": [],
    },
    "qwik": {
        "fileSignals": ["vite.config.ts"],
        "packageSignals": ["@builder.io/qwik"],
        "vendorOrgs": ["qwikdev"],
        "aliases": ["qwik-city"],
    },
    "lit": {
        "fileSignals": [],
        "packageSignals": ["lit"],
        "vendorOrgs": ["lit"],
        "aliases": ["lit-element", "lit-html"],
    },
    # ---- Backend / server ----
    "express": {
        "fileSignals": [],
        "packageSignals": ["express"],
        "vendorOrgs": ["expressjs"],
        "aliases": ["expressjs", "express-js"],
    },
    "nestjs": {
        "fileSignals": ["nest-cli.json", "nestconfig.json"],
        "packageSignals": ["@nestjs/core"],
        "vendorOrgs": ["nestjs"],
        "aliases": ["nest-js"],
    },
    "fastify": {
        "fileSignals": ["fastify.config.js"],
        "packageSignals": ["fastify"],
        "vendorOrgs": ["fastify"],
        "aliases": [],
    },
    "hono": {
        "fileSignals": [],
        "packageSignals": ["hono"],
        "vendorOrgs": ["honojs"],
        "aliases": ["hono-js"],
    },
    "koa": {
        "fileSignals": [],
        "packageSignals": ["koa"],
        "vendorOrgs": ["koajs"],
        "aliases": ["koajs"],
    },
    "gin": {
        "fileSignals": ["go.mod"],
        "packageSignals": ["github.com/gin-gonic/gin"],
        "vendorOrgs": ["gin-gonic"],
        "aliases": ["gin-gonic"],
    },
    "fiber": {
        "fileSignals": ["go.mod"],
        "packageSignals": ["github.com/gofiber/fiber"],
        "vendorOrgs": ["gofiber"],
        "aliases": ["gofiber"],
    },
    "actix-web": {
        "fileSignals": ["cargo.toml"],
        "packageSignals": ["actix-web"],
        "vendorOrgs": ["actix"],
        "aliases": ["actix", "actix_web"],
    },
    "rocket": {
        "fileSignals": ["cargo.toml"],
        "packageSignals": ["rocket"],
        "vendorOrgs": ["rwf2", "SergioBenitez"],
        "aliases": ["rocket-rs"],
    },
    "phoenix": {
        "fileSignals": ["mix.exs"],
        "packageSignals": ["phoenix"],
        "vendorOrgs": ["phoenixframework"],
        "aliases": ["phoenix-framework", "phoenix-elixir"],
    },
    # ---- AI / LLM ----
    "ollama": {
        "fileSignals": ["modelfile"],
        "packageSignals": ["ollama"],
        "vendorOrgs": ["ollama"],
        "aliases": [],
    },
    "langchain": {
        "fileSignals": [],
        "packageSignals": ["langchain", "@langchain/core"],
        "vendorOrgs": ["langchain-ai"],
        "aliases": ["lang-chain", "langchain-python", "langchain-js"],
    },
    "llamaindex": {
        "fileSignals": [],
        "packageSignals": ["llama-index", "llama_index"],
        "vendorOrgs": ["run-llama"],
        "aliases": ["llama-index", "llama_index"],
    },
    "flowise": {
        "fileSignals": ["package.json"],
        "packageSignals": ["flowise"],
        "vendorOrgs": ["flowiseai"],
        "aliases": [],
    },
    "dify": {
        "fileSignals": [".env.example"],
        "packageSignals": ["dify"],
        "vendorOrgs": ["langgenius"],
        "aliases": [],
    },
    "open-webui": {
        "fileSignals": [],
        "packageSignals": ["open-webui"],
        "vendorOrgs": ["open-webui"],
        "aliases": ["openwebui"],
    },
    "librechat": {
        "fileSignals": [".env.example"],
        "packageSignals": ["librechat"],
        "vendorOrgs": ["danny-avila"],
        "aliases": [],
    },
    "anythingllm": {
        "fileSignals": [],
        "packageSignals": ["anything-llm"],
        "vendorOrgs": ["mintplex-labs"],
        "aliases": ["anything-llm"],
    },
    "haystack": {
        "fileSignals": [],
        "packageSignals": ["haystack-ai"],
        "vendorOrgs": ["deepset-ai"],
        "aliases": ["haystack-ai"],
    },
    "vllm": {
        "fileSignals": [],
        "packageSignals": ["vllm"],
        "vendorOrgs": ["vllm-project"],
        "aliases": [],
    },
}


def signals_for(slug: str) -> dict:
    """Return the signal dict for a slug, with safe defaults."""
    return SIGNALS.get(slug, {
        "fileSignals": [],
        "packageSignals": [],
        "vendorOrgs": [],
        "aliases": [],
    })


def file_signals_for(slug: str) -> list[str]:
    return list(signals_for(slug).get("fileSignals") or [])


def package_signals_for(slug: str) -> list[str]:
    return list(signals_for(slug).get("packageSignals") or [])


def vendor_orgs_for(slug: str) -> list[str]:
    return list(signals_for(slug).get("vendorOrgs") or [])


def aliases_for(slug: str) -> list[str]:
    return list(signals_for(slug).get("aliases") or [])
