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
            <td class="p-4">${d.hasOverrides ? '<span class="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">edited</span>' : '<span class="text-xs text-gray-400">default</span>'}</td>
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
    $("#domain-list").innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-red-600">${esc((e as Error).message)}</td></tr>`;
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
      return `<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" class="cat-check w-4 h-4 rounded border-gray-300" data-cat="${esc(label)}" ${checked ? "checked" : ""} ${!count ? 'disabled' : ""} />
        <span>${esc(label)} <span class="text-gray-400">(${count})</span></span>
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
    root.innerHTML = `<p class="text-red-600">${esc((e as Error).message)}</p>`;
  }
}

function renderProjects(
  entries: Array<{ githubId: number; name: string; author: string; stars: number; category: string; hidden: boolean; featured: boolean; manual: boolean }>,
  slug: string,
) {
  $("#project-rows").innerHTML = entries.length
    ? entries
        .map(
          (en) =>
            `<tr class="hover:bg-gray-100 dark:hover:bg-gray-700 ${en.hidden ? "opacity-50" : ""}">
              <td class="p-4 text-sm font-medium text-gray-900 dark:text-white">${esc(en.name)} ${en.manual ? '<span class="ml-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">manual</span>' : ""}</td>
              <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${esc(en.author)}</td>
              <td class="p-4 text-sm text-gray-500">${en.stars?.toLocaleString?.() ?? en.stars}</td>
              <td class="p-4 text-sm text-gray-500">${esc(en.category)}</td>
              <td class="p-4">
                <label class="inline-flex items-center cursor-pointer">
                  <input type="checkbox" class="sr-only peer proj-vis" data-gid="${en.githubId}" data-featured="${en.featured ? 1 : 0}" ${en.hidden ? "" : "checked"} />
                  <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                  <span class="ms-2 text-xs text-gray-500">${en.hidden ? "Hidden" : "Visible"}</span>
                </label>
              </td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="p-4 text-sm text-gray-500">No projects (scrape first).</td></tr>`;

  document.querySelectorAll<HTMLInputElement>(".proj-vis").forEach((el) => {
    el.addEventListener("change", async () => {
      const gid = el.dataset.gid!;
      const featured = el.dataset.featured === "1";
      const hidden = !el.checked;
      await post(`entries/${slug}/${gid}`, { hidden, featured }, hidden ? "Project hidden" : "Project visible");
      el.closest("tr")?.classList.toggle("opacity-50", hidden);
      const label = el.parentElement?.querySelector("span");
      if (label) label.textContent = hidden ? "Hidden" : "Visible";
    });
  });
}

function $(s: string) {
  return document.querySelector(s) as HTMLElement;
}
