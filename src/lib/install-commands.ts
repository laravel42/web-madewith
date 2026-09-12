import type { Project } from "./catalog";

/**
 * Which package manager tabs the detail page's install widget shows.
 *
 * The widget used to hard-code npm/pnpm/yarn/bun for every project and swap in
 * Composer for exactly two domains (statamic, twill), so a Laravel package, a
 * Django app and a Rust crate all told you to run `npm install`. The ecosystem
 * is now derived from the project's own languages, with the gallery's tech as
 * the tie-breaker and the fallback.
 */

export type Ecosystem = "js" | "php" | "python" | "ruby" | "go" | "rust" | "dotnet" | "dart" | "lua";

export interface InstallManager {
  id: string;
  label: string;
  /** Brand colour for the tab's dot. */
  color: string;
  cmd: string;
}

/** GitHub language name → ecosystem. Anything absent is markup, config or an
 *  ecosystem with no one-line "add this dependency" command (Java, Elixir, C…). */
const LANG_ECOSYSTEM: Record<string, Ecosystem> = {
  JavaScript: "js",
  TypeScript: "js",
  Vue: "js",
  Svelte: "js",
  Astro: "js",
  MDX: "js",
  EJS: "js",
  Handlebars: "js",
  CoffeeScript: "js",
  PHP: "php",
  Blade: "php",
  Twig: "php",
  Hack: "php",
  Python: "python",
  "Jupyter Notebook": "python",
  Ruby: "ruby",
  HAML: "ruby",
  Haml: "ruby",
  Slim: "ruby",
  Go: "go",
  "Go Template": "go",
  Rust: "rust",
  "C#": "dotnet",
  "F#": "dotnet",
  Dart: "dart",
  Lua: "lua",
};

/** Gallery tech → ecosystem, used as tie-breaker and fallback. Domains absent
 *  here are JavaScript galleries (React, Next, Astro, Strapi, …). */
const THEME_ECOSYSTEM: Record<string, Ecosystem> = {
  laravel: "php",
  symfony: "php",
  wordpress: "php",
  drupal: "php",
  joomla: "php",
  octobercms: "php",
  statamic: "php",
  twill: "php",
  magento: "php",
  prestashop: "php",
  woocommerce: "php",
  shopware: "php",
  bagisto: "php",
  opencart: "php",
  dolibarr: "php",
  suitecrm: "php",
  espocrm: "php",
  vtiger: "php",
  monica: "php",
  django: "python",
  fastapi: "python",
  flask: "python",
  langchain: "python",
  llamaindex: "python",
  haystack: "python",
  vllm: "python",
  saleor: "python",
  odoo: "python",
  erpnext: "python",
  rails: "ruby",
  gin: "go",
  fiber: "go",
  ollama: "go",
  "actix-web": "rust",
  rocket: "rust",
  "aspnet-core": "dotnet",
};

/**
 * The project's ecosystem. The gallery's own ecosystem wins whenever the
 * project actually contains that language — a Laravel package that is 60% Vue
 * and 30% PHP is still installed with Composer — otherwise the dominant
 * mappable language decides.
 */
export function projectEcosystem(project: Project, themeSlug: string): Ecosystem | null {
  const langs = project.langs || [];
  const themeEco = THEME_ECOSYSTEM[themeSlug];
  // The gallery's ecosystem wins only when the project actually contains that
  // language, and only for galleries that declare one — defaulting unlisted
  // galleries to "js" let a 36% JavaScript share outrank a Java project.
  if (themeEco && langs.some((l) => LANG_ECOSYSTEM[l.name] === themeEco)) return themeEco;
  // Otherwise the dominant language decides. If it maps to nothing (Java,
  // Kotlin, Elixir, C…) there is no one-line install, so show none rather than
  // falling through to a trailing JavaScript share.
  if (langs.length) return LANG_ECOSYSTEM[langs[0].name] ?? null;
  return themeEco ?? "js";
}

/** npm/PyPI/crates names are lowercase; Composer and pub also want no spaces. */
const pkgName = (project: Project) => (project.name || "").toLowerCase();

/** `github.com/owner/repo` for `go get`, straight off the repo URL. */
const goModule = (project: Project) => (project.repoUrl || "").replace(/^https?:\/\//, "").replace(/\.git$/, "");

const BUILDERS: Record<Ecosystem, (p: Project) => InstallManager[]> = {
  js: (p) => [
    { id: "npm", label: "npm", color: "#cb3837", cmd: `npm install ${pkgName(p)}` },
    { id: "pnpm", label: "pnpm", color: "#f69220", cmd: `pnpm add ${pkgName(p)}` },
    { id: "yarn", label: "yarn", color: "#2c8ebb", cmd: `yarn add ${pkgName(p)}` },
    { id: "bun", label: "bun", color: "#fbf0df", cmd: `bun add ${pkgName(p)}` },
  ],
  php: (p) => [
    { id: "composer", label: "composer", color: "#885630", cmd: `composer require ${(p.fullName || "").toLowerCase()}` },
  ],
  python: (p) => [
    { id: "pip", label: "pip", color: "#3775a9", cmd: `pip install ${pkgName(p)}` },
    { id: "uv", label: "uv", color: "#de5fe9", cmd: `uv add ${pkgName(p)}` },
    { id: "poetry", label: "poetry", color: "#60a5fa", cmd: `poetry add ${pkgName(p)}` },
  ],
  ruby: (p) => [
    { id: "gem", label: "gem", color: "#cc342d", cmd: `gem install ${pkgName(p)}` },
    { id: "bundler", label: "bundler", color: "#e9573f", cmd: `bundle add ${pkgName(p)}` },
  ],
  go: (p) => [
    { id: "go-get", label: "go get", color: "#00add8", cmd: `go get ${goModule(p)}` },
    { id: "go-install", label: "go install", color: "#5dc9e2", cmd: `go install ${goModule(p)}@latest` },
  ],
  rust: (p) => [
    { id: "cargo-add", label: "cargo add", color: "#dea584", cmd: `cargo add ${pkgName(p)}` },
    { id: "cargo-install", label: "cargo install", color: "#b7410e", cmd: `cargo install ${pkgName(p)}` },
  ],
  dotnet: (p) => [
    { id: "dotnet", label: "dotnet", color: "#512bd4", cmd: `dotnet add package ${p.name}` },
    { id: "nuget", label: "nuget", color: "#004880", cmd: `nuget install ${p.name}` },
  ],
  dart: (p) => [
    { id: "dart", label: "dart", color: "#0175c2", cmd: `dart pub add ${pkgName(p).replace(/-/g, "_")}` },
    { id: "flutter", label: "flutter", color: "#42a5f5", cmd: `flutter pub add ${pkgName(p).replace(/-/g, "_")}` },
  ],
  lua: (p) => [
    { id: "luarocks", label: "luarocks", color: "#2c2d72", cmd: `luarocks install ${pkgName(p)}` },
  ],
};

/**
 * Package-manager tabs for a project. Empty when the ecosystem has no
 * derivable one-line install (Java/Kotlin coordinates, Elixir's mix.exs entry,
 * C/C++ builds) — the widget then shows the clone command alone rather than a
 * command that would not work.
 */
export function installManagers(project: Project, themeSlug: string): InstallManager[] {
  const eco = projectEcosystem(project, themeSlug);
  return eco ? BUILDERS[eco](project) : [];
}
