import { createRefreshJobPanel, formatRefreshResult, runSequentialJob } from "./refresh-job";

export const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as HTMLElement;

export const api = (p: string, opts?: RequestInit) =>
  fetch(`/admin/api/${p}`, opts).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { error?: string }).error || `HTTP ${r.status}`);
    return body;
  });

export const toast = (m: string) => {
  const t = $("#admin-toast");
  t.textContent = m;
  t.classList.remove("opacity-0", "pointer-events-none");
  t.classList.add("opacity-100");
  setTimeout(() => {
    t.classList.add("opacity-0", "pointer-events-none");
    t.classList.remove("opacity-100");
  }, 2200);
};

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

export async function postJson(p: string, body: unknown) {
  return api(p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function post(p: string, body: unknown, msg: string) {
  try {
    const r = await postJson(p, body);
    toast(msg);
    return r;
  } catch (e) {
    toast("Error: " + (e as Error).message);
    throw e;
  }
}

let domains: Array<Record<string, unknown>> = [];

type CatalogStat = { published: number; totalRepos: number; scrapedAt: string | null };

function catalogStats(): Record<string, CatalogStat> {
  try {
    return JSON.parse($("#domain-rows").dataset.catalogStats || "{}");
  } catch {
    return {};
  }
}

function mergedDomainStats(d: Record<string, unknown>, fallback: CatalogStat) {
  const published = Math.max(Number(d.published ?? 0), fallback.published ?? 0);
  const total = Number(d.total) > 0 ? Number(d.total) : (fallback.totalRepos ?? 0);
  const scrapedAt = d.scrapedAt ? String(d.scrapedAt) : fallback.scrapedAt;
  return { published, total, scrapedAt };
}

export function getDomains() {
  return domains;
}

export async function loadOverview() {
  try {
    const o = (await api("overview")) as {
      email?: string;
      pending: number;
      lastRun?: { at: string };
      domains: typeof domains;
    };
    const who = $("#admin-email");
    if (who) who.textContent = o.email || "";
    domains = o.domains;
    const stats = catalogStats();

    const badge = $("#pending-badge");
    if (badge) {
      badge.textContent = String(o.pending);
      badge.classList.toggle("hidden", !o.pending);
    }

    const statPending = $("#stat-pending");
    if (statPending) statPending.textContent = String(o.pending);
    const statDomains = $("#stat-domains");
    if (statDomains) statDomains.textContent = String(o.domains.length);
    const statLastRun = $("#stat-lastrun");
    if (statLastRun) {
      const catalogLast = Object.values(stats)
        .map((s) => s.scrapedAt)
        .filter(Boolean)
        .sort()
        .reverse()[0];
      const lastAt = o.lastRun?.at || catalogLast;
      statLastRun.textContent = lastAt ? new Date(lastAt).toLocaleString() : "—";
    }

    const domainRows = $("#domain-rows");
    if (domainRows) {
      domainRows.innerHTML = o.domains
      .map(
        (d: Record<string, unknown>) => {
          const { published, total, scrapedAt } = mergedDomainStats(d, stats[String(d.slug)] ?? { published: 0, totalRepos: 0, scrapedAt: null });
          return `<tr class="hover:bg-gray-100 dark:hover:bg-gray-700">
            <td class="p-4 text-sm font-normal text-gray-900 whitespace-nowrap dark:text-white">
              <span class="font-semibold">${esc(d.techName)}</span>
              <span class="text-gray-500 dark:text-gray-400"> /${esc(d.slug)}</span>
            </td>
            <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${published.toLocaleString()}</td>
            <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${total ? total.toLocaleString() : "—"}</td>
            <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${scrapedAt ? new Date(scrapedAt).toLocaleString() : "never"}</td>
            <td class="p-4 space-x-2 whitespace-nowrap">
              <button type="button" class="text-white bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:ring-primary-300 font-medium rounded-lg text-xs px-3 py-1.5 dark:bg-primary-600 dark:hover:bg-primary-700" data-republish="${esc(d.slug)}" data-refresh-job>Republish</button>
              <button type="button" class="text-gray-900 bg-white border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:ring-primary-300 font-medium rounded-lg text-xs px-3 py-1.5 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:text-white dark:hover:bg-gray-700" data-refresh="${esc(d.slug)}" data-refresh-job>Refresh</button>
            </td>
          </tr>`;
        },
      )
      .join("");
    }
  } catch (e) {
    const domainRows = $("#domain-rows");
    if (domainRows) {
      domainRows.innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-red-600 dark:text-red-400">${esc((e as Error).message)} — are you signed in via Access?</td></tr>`;
    }
  }
}

export async function loadSubs() {
  const status = ($("#sub-filter") as HTMLSelectElement).value;
  try {
    const { submissions } = (await api(`submissions${status ? `?status=${status}` : ""}`)) as {
      submissions: Array<Record<string, unknown>>;
    };
    $("#sub-rows").innerHTML = submissions.length
      ? submissions
          .map(
            (s) =>
              `<tr class="hover:bg-gray-100 dark:hover:bg-gray-700">
                <td class="p-4 text-sm font-normal text-gray-900 dark:text-white">
                  <div class="font-semibold">${esc(s.name)}</div>
                  <div class="text-gray-500 dark:text-gray-400">${esc(s.description || "")}</div>
                </td>
                <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${esc(s.slug)}</td>
                <td class="p-4 text-sm"><a href="${esc(s.repo_url)}" target="_blank" rel="noopener" class="font-medium text-primary-700 hover:underline dark:text-primary-400">repo ↗</a></td>
                <td class="p-4"><span class="text-xs font-medium px-2.5 py-0.5 rounded ${s.status === "pending" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"}">${esc(s.status)}</span></td>
                <td class="p-4 space-x-2 whitespace-nowrap">
                  ${s.status === "pending" ? `<button type="button" class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-xs px-3 py-1.5" data-approve="${s.id}">Approve</button><button type="button" class="text-red-700 hover:text-white border border-red-700 hover:bg-red-800 font-medium rounded-lg text-xs px-3 py-1.5 dark:border-red-500 dark:text-red-400" data-reject="${s.id}">Reject</button>` : `<span class="text-sm text-gray-500 dark:text-gray-400">${esc(s.decided_by || "")}</span>`}
                </td>
              </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="p-4 text-sm text-gray-500 dark:text-gray-400">No submissions.</td></tr>`;
  } catch (e) {
    $("#sub-rows").innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-red-600 dark:text-red-400">${esc((e as Error).message)}</td></tr>`;
  }
}

export function initOverviewPage() {
  const job = createRefreshJobPanel();

  async function runJob(kind: "refresh" | "republish", slugs: string[]) {
    if (!job) {
      toast("Job panel missing from page");
      return;
    }
    const title = kind === "refresh" ? `Scraping ${slugs.length} domain(s) from GitHub` : `Republishing ${slugs.length} domain(s)`;
    await runSequentialJob(job, slugs, title, async (slug) => {
      const r = (await postJson(kind, { slug })) as {
        refreshed?: Array<{ slug: string; published?: number; error?: string; log?: string }>;
        republished?: Array<{ slug: string; published?: number; error?: string; log?: string }>;
        logs?: string[];
        error?: string;
      };
      if (r.error && !(r.refreshed?.length || r.republished?.length)) {
        return { ok: false, message: r.error };
      }
      const list = r.refreshed ?? r.republished ?? [];
      const item = list.find((x) => x.slug === slug) ?? list[0];
      return formatRefreshResult(slug, item);
    });
    toast(kind === "refresh" ? "Refresh complete" : "Republish complete");
    await loadOverview();
  }

  document.addEventListener("click", async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-refresh], [data-republish]");
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.dataset.refresh) {
      e.preventDefault();
      await runJob("refresh", [el.dataset.refresh]);
    }
    if (el.dataset.republish) {
      e.preventDefault();
      await runJob("republish", [el.dataset.republish]);
    }
  });

  $("#refresh-all")?.addEventListener("click", async () => {
    const slugs = domains.length ? domains.map((d) => String(d.slug)) : [];
    if (!slugs.length) {
      toast("Load domains first");
      return;
    }
    await runJob("refresh", slugs);
  });

  $("#republish-all")?.addEventListener("click", async () => {
    const slugs = domains.length ? domains.map((d) => String(d.slug)) : [];
    if (!slugs.length) {
      toast("Load domains first");
      return;
    }
    await runJob("republish", slugs);
  });

  loadOverview();
}

export function initSubmissionsPage() {
  loadOverview();
  $("#sub-filter")?.addEventListener("change", loadSubs);
  document.addEventListener("click", async (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.approve) {
      el.textContent = "…";
      await post(`submissions/${el.dataset.approve}`, { action: "approve" }, "Approved & published");
      loadSubs();
      loadOverview();
    }
    if (el.dataset.reject) {
      await post(`submissions/${el.dataset.reject}`, { action: "reject" }, "Rejected");
      loadSubs();
    }
  });
  loadSubs();
}

export function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const toggle = (
    sb: HTMLElement,
    backdrop: HTMLElement,
    openIcon: HTMLElement,
    closeIcon: HTMLElement,
  ) => {
    sb.classList.toggle("hidden");
    backdrop.classList.toggle("hidden");
    openIcon.classList.toggle("hidden");
    closeIcon.classList.toggle("hidden");
  };

  const backdrop = document.getElementById("sidebar-backdrop")!;
  const openIcon = document.getElementById("toggle-sidebar-open")!;
  const closeIcon = document.getElementById("toggle-sidebar-close")!;

  document.getElementById("toggle-sidebar")?.addEventListener("click", () =>
    toggle(sidebar, backdrop, openIcon, closeIcon),
  );
  backdrop?.addEventListener("click", () => toggle(sidebar, backdrop, openIcon, closeIcon));
}
