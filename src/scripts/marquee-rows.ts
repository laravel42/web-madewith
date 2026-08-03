import { expandForMarquee, marqueeDuration } from "../lib/marquee-rows";

const MOBILE_QUERY = "(max-width: 560px)";
const RESUME_MS = 1800;

export { expandForMarquee, marqueeDuration };

type RowState = {
  row: HTMLElement;
  destroy: () => void;
};

function loopWidth(row: HTMLElement) {
  const track = row.querySelector(".grid-slideshow__track");
  return track ? track.scrollWidth / 2 : 0;
}

function wrapScroll(row: HTMLElement, half: number) {
  if (half <= 0) return;
  if (row.scrollLeft >= half) row.scrollLeft -= half;
  else if (row.scrollLeft < 0) row.scrollLeft += half;
}

function bindDrag(row: HTMLElement, mobile: MediaQueryList) {
  let dragging = false;
  let moved = false;
  let axis: "x" | "y" | null = null;
  let programmatic = false;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let pointerId: number | null = null;

  const setScroll = (left: number) => {
    programmatic = true;
    row.scrollLeft = left;
    programmatic = false;
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    axis = null;
    row.classList.remove("is-dragging");
    try {
      row.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    row.dispatchEvent(new CustomEvent("marquee-interact"));
  };

  const onDown = (e: PointerEvent) => {
    if (!mobile.matches || e.button > 0) return;
    dragging = true;
    moved = false;
    axis = null;
    startX = e.clientX;
    startY = e.clientY;
    startScroll = row.scrollLeft;
    pointerId = e.pointerId;
    row.dispatchEvent(new CustomEvent("marquee-interact"));
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "y") {
        dragging = false;
        pointerId = null;
        return;
      }
      row.classList.add("is-dragging");
      row.setPointerCapture(e.pointerId);
    }

    if (axis !== "x") return;
    if (Math.abs(dx) > 4) moved = true;
    let next = startScroll - dx;
    const half = loopWidth(row);
    if (half > 0) next = ((next % half) + half) % half;
    setScroll(next);
    e.preventDefault();
    row.dispatchEvent(new CustomEvent("marquee-interact"));
  };

  const onClick = (e: MouseEvent) => {
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
    moved = false;
  };

  const onScroll = () => {
    if (programmatic) return;
    const half = loopWidth(row);
    programmatic = true;
    wrapScroll(row, half);
    programmatic = false;
    if (!dragging) row.dispatchEvent(new CustomEvent("marquee-interact"));
  };

  row.addEventListener("pointerdown", onDown);
  row.addEventListener("pointermove", onMove);
  row.addEventListener("pointerup", endDrag);
  row.addEventListener("pointercancel", endDrag);
  row.addEventListener("click", onClick, true);
  row.addEventListener("scroll", onScroll, { passive: true });

  (row as HTMLElement & { __marqueeSetScroll?: typeof setScroll }).__marqueeSetScroll = setScroll;

  return () => {
    row.removeEventListener("pointerdown", onDown);
    row.removeEventListener("pointermove", onMove);
    row.removeEventListener("pointerup", endDrag);
    row.removeEventListener("pointercancel", endDrag);
    row.removeEventListener("click", onClick, true);
    row.removeEventListener("scroll", onScroll);
  };
}

function bindAutoplay(row: HTMLElement, mobile: MediaQueryList, reduceMotion: boolean) {
  if (reduceMotion) return () => {};

  const reverse = row.dataset.reverse === "true";
  let paused = false;
  let visible = true;
  let resumeTimer = 0;
  let last = performance.now();
  let raf = 0;
  const setScroll =
    (row as HTMLElement & { __marqueeSetScroll?: (left: number) => void }).__marqueeSetScroll ??
    ((left: number) => {
      row.scrollLeft = left;
    });

  const pause = () => {
    paused = true;
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      paused = false;
      last = performance.now();
    }, RESUME_MS);
  };

  const onFocusIn = () => pause();
  row.addEventListener("marquee-interact", pause);
  row.addEventListener("focusin", onFocusIn);

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) last = performance.now();
    },
    { rootMargin: "40px 0px", threshold: 0.05 },
  );

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!mobile.matches || !visible || paused) {
      last = now;
      return;
    }
    const half = loopWidth(row);
    if (half <= 0) {
      last = now;
      return;
    }
    const duration =
      parseFloat(getComputedStyle(row).getPropertyValue("--marquee-duration")) || 28;
    const speed = half / (duration * 1000);
    const dt = Math.min(64, now - last);
    last = now;
    let next = row.scrollLeft + (reverse ? -1 : 1) * speed * dt;
    if (next >= half) next -= half;
    if (next < 0) next += half;
    setScroll(next);
  };

  const sync = () => {
    if (mobile.matches) {
      io.observe(row);
      const half = loopWidth(row);
      if (reverse && half > 0 && row.scrollLeft < 8) setScroll(half / 2);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    } else {
      io.unobserve(row);
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
  };

  sync();
  mobile.addEventListener("change", sync);

  return () => {
    row.removeEventListener("marquee-interact", pause);
    row.removeEventListener("focusin", onFocusIn);
    window.clearTimeout(resumeTimer);
    mobile.removeEventListener("change", sync);
    io.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}

/** Bind drag + autoplay on existing `[data-marquee-row]` nodes under `root`. */
export function bindAllMarqueeRows(root: ParentNode = document): () => void {
  const mobile = window.matchMedia(MOBILE_QUERY);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const states: RowState[] = [];

  for (const row of root.querySelectorAll<HTMLElement>("[data-marquee-row]")) {
    if (row.dataset.marqueeBound === "true") continue;
    row.dataset.marqueeBound = "true";
    const unDrag = bindDrag(row, mobile);
    const unPlay = bindAutoplay(row, mobile, reduceMotion);
    states.push({
      row,
      destroy: () => {
        unDrag();
        unPlay();
        delete row.dataset.marqueeBound;
      },
    });
  }

  return () => {
    for (const s of states) s.destroy();
  };
}

function wrapItem(node: Node): HTMLElement {
  const item = document.createElement("div");
  item.className = "grid-slideshow__item";
  item.appendChild(node);
  return item;
}

function buildSet(nodes: HTMLElement[], decorative: boolean): HTMLElement {
  const set = document.createElement("div");
  set.className = "grid-slideshow__set";
  if (decorative) {
    set.setAttribute("aria-hidden", "true");
    for (const node of nodes) {
      const clone = node.cloneNode(true) as HTMLElement;
      for (const link of clone.querySelectorAll("a")) link.tabIndex = -1;
      if (clone instanceof HTMLAnchorElement) clone.tabIndex = -1;
      set.appendChild(wrapItem(clone));
    }
  } else {
    for (const node of nodes) set.appendChild(wrapItem(node));
  }
  return set;
}

/**
 * Render a 2-row drag/autoplay marquee into `host` from source elements.
 * Source nodes are cloned — originals stay put for catalog filtering.
 */
export function renderTwoRowMarquee(host: HTMLElement, sources: HTMLElement[]): () => void {
  host.replaceChildren();
  host.classList.add("grid-slideshow");

  if (sources.length === 0) {
    host.classList.remove("is-active");
    return () => {};
  }

  const rowA = expandForMarquee(sources.filter((_, i) => i % 2 === 0));
  const rowB = expandForMarquee(sources.filter((_, i) => i % 2 === 1));
  const rows = [rowA, rowB].filter((row) => row.length > 0);

  for (const [rowIndex, rowSources] of rows.entries()) {
    const row = document.createElement("div");
    row.className = "grid-slideshow__row" + (rowIndex === 1 ? " grid-slideshow__row--reverse" : "");
    row.dataset.marqueeRow = "";
    if (rowIndex === 1) row.dataset.reverse = "true";
    row.style.setProperty("--marquee-duration", marqueeDuration(rowSources.length));

    const track = document.createElement("div");
    track.className = "grid-slideshow__track";

    const templates = rowSources.map((el) => el.cloneNode(true) as HTMLElement);
    track.appendChild(buildSet(templates, false));
    track.appendChild(buildSet(templates, true));
    row.appendChild(track);
    host.appendChild(row);
  }

  host.classList.add("is-active");
  return bindAllMarqueeRows(host);
}

/**
 * Keep a card grid + marquee host in sync for mobile viewports.
 * Source nodes are cloned — originals stay put for filtering/pagination.
 */
export function syncCatalogMarquee(
  grid: HTMLElement,
  host: HTMLElement,
  cards: HTMLElement[],
  previousDestroy?: () => void,
): () => void {
  previousDestroy?.();

  const mobile = window.matchMedia(MOBILE_QUERY);
  if (!mobile.matches) {
    host.classList.remove("is-active");
    host.replaceChildren();
    grid.classList.remove("is-marquee-source");
    return () => {};
  }

  const visible = cards.filter((c) => !c.hidden);
  if (visible.length === 0) {
    host.classList.remove("is-active");
    host.replaceChildren();
    grid.classList.remove("is-marquee-source");
    return () => {};
  }

  grid.classList.add("is-marquee-source");
  return renderTwoRowMarquee(host, visible);
}

/** Alias for non-catalog grids (blog, video, strips). */
export const syncGridMarquee = syncCatalogMarquee;
