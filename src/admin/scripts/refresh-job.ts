type LogKind = "info" | "ok" | "error";

export interface RefreshJobPanel {
  show(title: string): void;
  hide(): void;
  clear(): void;
  setProgress(ratio: number, label?: string): void;
  log(line: string, kind?: LogKind): void;
  setBusy(busy: boolean): void;
}

export function createRefreshJobPanel(): RefreshJobPanel | null {
  const panel = document.getElementById("refresh-job");
  const titleEl = document.getElementById("refresh-job-title");
  const progressEl = document.getElementById("refresh-job-progress") as HTMLProgressElement | null;
  const progressLabel = document.getElementById("refresh-job-progress-label");
  const logEl = document.getElementById("refresh-job-log");
  if (!panel || !titleEl || !progressEl || !progressLabel || !logEl) return null;

  const color: Record<LogKind, string> = {
    info: "text-gray-700 dark:text-gray-300",
    ok: "text-green-700 dark:text-green-400",
    error: "text-red-600 dark:text-red-400",
  };

  return {
    show(title: string) {
      titleEl.textContent = title;
      panel.classList.remove("hidden");
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    hide() {
      panel.classList.add("hidden");
    },
    clear() {
      logEl.innerHTML = "";
      progressEl.value = 0;
      progressLabel.textContent = "0%";
    },
    setProgress(ratio: number, label?: string) {
      const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      progressEl.value = pct;
      progressLabel.textContent = label ?? `${pct}%`;
    },
    log(line: string, kind: LogKind = "info") {
      const row = document.createElement("div");
      row.className = `font-mono text-xs leading-5 ${color[kind]}`;
      row.textContent = line;
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    },
    setBusy(busy: boolean) {
      document.querySelectorAll<HTMLButtonElement>("[data-refresh-job]").forEach((btn) => {
        btn.disabled = busy;
        btn.classList.toggle("opacity-50", busy);
        btn.classList.toggle("cursor-not-allowed", busy);
      });
    },
  };
}

export async function runSequentialJob(
  panel: RefreshJobPanel,
  slugs: string[],
  title: string,
  runOne: (slug: string) => Promise<{ ok: boolean; message: string }>,
) {
  panel.show(title);
  panel.clear();
  panel.setBusy(true);
  panel.log(`Starting ${slugs.length} domain(s)…`);

  let done = 0;
  for (const slug of slugs) {
    panel.setProgress(done / slugs.length, `${done}/${slugs.length}`);
    panel.log(`→ ${slug}`, "info");
    try {
      const { ok, message } = await runOne(slug);
      panel.log(`  ${ok ? "✓" : "✗"} ${message}`, ok ? "ok" : "error");
    } catch (e) {
      panel.log(`  ✗ ${(e as Error).message}`, "error");
    }
    done += 1;
    panel.setProgress(done / slugs.length, `${done}/${slugs.length}`);
  }

  panel.log("Done.", "ok");
  panel.setProgress(1, "Complete");
  panel.setBusy(false);
}

export function formatRefreshResult(slug: string, item?: { published?: number; error?: string; log?: string }) {
  if (!item) return { ok: false, message: `${slug}: no response from worker` };
  if (item.error) return { ok: false, message: `${slug}: ${item.error}` };
  const detail = item.log ? ` — ${item.log}` : "";
  return { ok: true, message: `${slug}: ${item.published ?? 0} projects published${detail}` };
}
