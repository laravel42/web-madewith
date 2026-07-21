import { api, esc, post, toast } from "./admin";

const ALL_CATEGORIES = [
  "E-commerce", "Mobile", "AI & ML", "Authentication", "SaaS", "Real-time",
  "Dashboards", "Testing", "APIs", "Templates", "Docs", "Blogs", "UI Kits", "DevTools",
];

const GROUP_LABELS: Record<string, string> = {
  frameworks: "Frameworks",
  frontend: "Frontend",
  backend: "Backend",
  "cms-crm": "CMS / CRM",
  cms: "CMS / CRM",
  "crm-erp": "CMS / CRM",
  commerce: "Commerce",
  "ai-llm": "AI / LLM",
};

function catalogCounts(): Record<string, number> {
  try {
    return JSON.parse($("#domain-list").dataset.catalogCounts || "{}");
  } catch {
    return {};
  }
}

function catalogGroups(): Record<string, string> {
  try {
    return JSON.parse($("#domain-list").dataset.catalogGroups || "{}");
  } catch {
    return {};
  }
}

function groupLabel(group: unknown, slug: string, fallback: Record<string, string>): string {
  const key = String(group || fallback[slug] || "");
  return GROUP_LABELS[key] || key || "—";
}

export async function initDomainsListPage() {
  try {
    const { domains } = (await api("domains")) as { domains: Array<Record<string, unknown>> };
    const counts = catalogCounts();
    const groups = catalogGroups();
    $("#domain-list").innerHTML = domains
      .map(
        (d) => {
          const slug = String(d.slug);
          const projectCount = Math.max(Number(d.published ?? 0), counts[slug] ?? 0);
          return `<tr class="hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer" data-href="/admin/domains/${esc(d.slug)}/" tabindex="0" role="link">
            <td class="p-4"><span class="font-semibold text-gray-900 dark:text-white">${esc(d.techName)}</span><div class="text-xs text-gray-500 dark:text-gray-400">/${esc(d.slug)}</div></td>
            <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${esc(groupLabel(d.group, slug, groups))}</td>
            <td class="p-4 text-sm"><a href="${esc(d.pageUrl)}" target="_blank" rel="noopener" class="text-primary-700 hover:underline dark:text-primary-400" data-stop-row>${esc(d.pageUrl)}</a></td>
            <td class="p-4 text-sm text-gray-900 dark:text-white">${projectCount.toLocaleString()}</td>
            <td class="p-4">${d.hasOverrides ? '<span class="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">edited</span>' : '<span class="text-xs text-gray-500 dark:text-gray-400">default</span>'}</td>
          </tr>`;
        },
      )
      .join("");

    $("#domain-list").querySelectorAll<HTMLElement>("tr[data-href]").forEach((row) => {
      const go = () => { location.href = row.dataset.href!; };
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("[data-stop-row]")) return;
        go();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  } catch (e) {
    $("#domain-list").innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-red-600 dark:text-red-400">${esc((e as Error).message)}</td></tr>`;
  }
}

function field(id: string) {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? "";
}

export async function initDomainEditPage(slug: string) {
  const root = document.getElementById("domain-editor");
  if (!root) return;

  try {
    const data = (await api(`domains/${slug}`)) as {
      slug: string;
      baseline: Record<string, unknown>;
      merged: Record<string, unknown>;
      categoryCounts: Record<string, number>;
      entries: Array<{ githubId: number; name: string; author: string; stars: number; category: string; hidden: boolean; featured: boolean; manual: boolean }>;
    };

    $("#edit-title").textContent = String(data.merged.techName || data.slug);
    $("#edit-slug").textContent = `/${data.slug}/`;

    const m = data.merged;
    (document.getElementById("f-eyebrow") as HTMLInputElement).value = String(m.eyebrow ?? "");
    (document.getElementById("f-heroTitle") as HTMLInputElement).value = String(m.heroTitle ?? "");
    (document.getElementById("f-heroHeadline") as HTMLInputElement).value = String(m.heroHeadline ?? "");
    (document.getElementById("f-tagline") as HTMLTextAreaElement).value = String(m.tagline ?? "");
    (document.getElementById("f-group") as HTMLSelectElement).value = String(m.group ?? "frameworks");
    (document.getElementById("f-domain") as HTMLInputElement).value = String(m.domain ?? "");
    (document.getElementById("f-pageUrl") as HTMLInputElement).value = String(m.pageUrl ?? "");
    (document.getElementById("f-seoTitle") as HTMLInputElement).value = String(m.seoTitle ?? "");
    (document.getElementById("f-seoDescription") as HTMLTextAreaElement).value = String(m.seoDescription ?? "");

    const vis = m.visibleCategories as string[] | null | undefined;
    const autoMode = vis === null || vis === undefined;
    (document.getElementById("cat-mode-auto") as HTMLInputElement).checked = autoMode;
    (document.getElementById("cat-mode-custom") as HTMLInputElement).checked = !autoMode;
    $("#category-checks").innerHTML = ALL_CATEGORIES.map((label) => {
      const count = data.categoryCounts[label] || 0;
      const checked = !autoMode && Array.isArray(vis) && vis.includes(label);
      // Disabled (0-project) options are dimmed so they read as unavailable; enabled
      // options keep an AA-clearing pair (gray-700 on white 10.30:1 / gray-300 on gray-800 9.96:1).
      const labelCls = count ? "text-gray-700 dark:text-gray-300" : "text-gray-400 dark:text-gray-500";
      const countCls = count ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-500";
      return `<label class="flex items-center gap-2 text-sm ${labelCls}">
        <input type="checkbox" class="cat-check w-4 h-4 rounded border-gray-300" data-cat="${esc(label)}" ${checked ? "checked" : ""} ${!count ? 'disabled' : ""} />
        <span>${esc(label)} <span class="${countCls}">(${count})</span></span>
      </label>`;
    }).join("");

    renderProjects(data.entries, slug);

    $("#save-domain")?.addEventListener("click", async () => {
      const custom = (document.getElementById("cat-mode-custom") as HTMLInputElement).checked;
      const visibleCategories = custom
        ? [...document.querySelectorAll<HTMLInputElement>(".cat-check:checked")].map((el) => el.dataset.cat!)
        : null;
      const body = {
        eyebrow: field("f-eyebrow"),
        heroTitle: field("f-heroTitle"),
        heroHeadline: field("f-heroHeadline") || null,
        tagline: field("f-tagline"),
        group: (document.getElementById("f-group") as HTMLSelectElement).value,
        domain: field("f-domain"),
        pageUrl: field("f-pageUrl"),
        seoTitle: field("f-seoTitle"),
        seoDescription: field("f-seoDescription"),
        visibleCategories,
      };
      await post(`domains/${slug}`, body, "Domain settings saved");
    });
  } catch (e) {
    root.innerHTML = `<p class="text-red-600 dark:text-red-400">${esc((e as Error).message)}</p>`;
  }
}

// Hidden rows are de-emphasised with a muted row background instead of `opacity-50`,
// which used to drag the grey cell text down to ~2:1. On these surfaces the row text
// still clears AA: gray-500 on gray-50 = 4.63:1, gray-400 on gray-900 = 6.82:1.
const HIDDEN_ROW_CLASSES = "bg-gray-50 dark:bg-gray-900";

function renderProjects(
  entries: Array<{ githubId: number; name: string; author: string; stars: number; category: string; hidden: boolean; featured: boolean; manual: boolean }>,
  slug: string,
) {
  $("#project-rows").innerHTML = entries.length
    ? entries
        .map(
          (en) =>
            `<tr class="hover:bg-gray-100 dark:hover:bg-gray-700 ${en.hidden ? HIDDEN_ROW_CLASSES : ""}">
              <td class="p-4 text-sm font-medium text-gray-900 dark:text-white">${esc(en.name)} ${en.manual ? '<span class="ml-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">manual</span>' : ""}</td>
              <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${esc(en.author)}</td>
              <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${en.stars?.toLocaleString?.() ?? en.stars}</td>
              <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${esc(en.category)}</td>
              <td class="p-4">
                <label class="inline-flex items-center cursor-pointer">
                  <input type="checkbox" class="sr-only peer proj-vis" data-gid="${en.githubId}" data-featured="${en.featured ? 1 : 0}" ${en.hidden ? "" : "checked"} />
                  <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                  <span class="ms-2 text-xs text-gray-500 dark:text-gray-400">${en.hidden ? "Hidden" : "Visible"}</span>
                </label>
              </td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="p-4 text-sm text-gray-500 dark:text-gray-400">No projects (scrape first).</td></tr>`;

  document.querySelectorAll<HTMLInputElement>(".proj-vis").forEach((el) => {
    el.addEventListener("change", async () => {
      const gid = el.dataset.gid!;
      const featured = el.dataset.featured === "1";
      const hidden = !el.checked;
      await post(`entries/${slug}/${gid}`, { hidden, featured }, hidden ? "Project hidden" : "Project visible");
      const row = el.closest("tr");
      for (const cls of HIDDEN_ROW_CLASSES.split(" ")) row?.classList.toggle(cls, hidden);
      const label = el.parentElement?.querySelector("span");
      if (label) label.textContent = hidden ? "Hidden" : "Visible";
    });
  });
}

function $(s: string) {
  return document.querySelector(s) as HTMLElement;
}
