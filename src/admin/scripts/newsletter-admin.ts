import { $, api, esc, toast } from "./admin";

interface Subscriber {
  id: number;
  email: string;
  scope: string;
  slug: string;
  status: string;
  created_at: string;
  unsubscribed_at: string | null;
}
interface NewsletterPayload {
  stats: { active: number; unsubscribed: number; network: number; domains: Array<{ slug: string; n: number }> };
  subscribers: Subscriber[];
}

function query(): string {
  const status = ($("#nl-status") as HTMLSelectElement).value;
  const slug = ($("#nl-slug") as HTMLSelectElement).value;
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (slug) params.set("slug", slug);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function load(preserveSlugOptions = false) {
  const rowsEl = $("#nl-rows");
  rowsEl.innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-gray-500 dark:text-gray-400">Loading…</td></tr>`;
  try {
    const data = (await api(`newsletter${query()}`)) as NewsletterPayload;
    $("#nl-active").textContent = String(data.stats.active);
    $("#nl-network").textContent = String(data.stats.network);
    $("#nl-domain-count").textContent = String(data.stats.domains.reduce((t, d) => t + d.n, 0));
    $("#nl-unsub").textContent = String(data.stats.unsubscribed);

    const slugSel = $("#nl-slug") as HTMLSelectElement;
    if (!preserveSlugOptions) {
      const current = slugSel.value;
      slugSel.innerHTML =
        `<option value="">All lists</option>` +
        data.stats.domains.map((d) => `<option value="${esc(d.slug)}">${esc(d.slug)} (${d.n})</option>`).join("");
      slugSel.value = current;
    }

    ($("#nl-export") as HTMLAnchorElement).href = `/admin/api/newsletter/export${query()}`;

    if (!data.subscribers.length) {
      rowsEl.innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-gray-500 dark:text-gray-400">No subscribers match.</td></tr>`;
      return;
    }
    rowsEl.innerHTML = data.subscribers
      .map(
        (s) => `<tr>
        <td class="p-4 text-sm font-medium text-gray-900 dark:text-white">${esc(s.email)}</td>
        <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${s.scope === "network" ? "Network" : esc(s.slug)}</td>
        <td class="p-4 text-sm">${
          s.status === "active"
            ? `<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">active</span>`
            : `<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">${esc(s.status)}</span>`
        }</td>
        <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${new Date(s.created_at).toLocaleDateString()}</td>
        <td class="p-4 text-sm text-gray-500 dark:text-gray-400">${s.unsubscribed_at ? new Date(s.unsubscribed_at).toLocaleDateString() : "—"}</td>
      </tr>`,
      )
      .join("");
  } catch (e) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="p-4 text-sm text-red-600 dark:text-red-400">${esc((e as Error).message)}</td></tr>`;
    toast("Error: " + (e as Error).message);
  }
}

export function initNewsletterPage() {
  $("#nl-status").addEventListener("change", () => load(true));
  $("#nl-slug").addEventListener("change", () => load(true));
  void load();
}
