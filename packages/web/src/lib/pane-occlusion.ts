/**
 * Getting the in-app browser out of the way of anything the DOM draws over it.
 *
 * A `WebContentsView` is a native surface composited **above** the page (design/002 §5.3). No
 * z-index reaches it, so a modal does not cover the browser — it is covered *by* it, and a click
 * meant for the dialog lands on a booking site instead. The only remedy Electron offers is to hide
 * the view while something is on top of it, and the only place that knows something is on top is
 * the component that opened it.
 *
 * So every overlay registers here, and this is a **reference count** rather than a boolean:
 * overlays nest — a confirm dialog inside a drawer, a select inside a modal — and the inner one
 * closing must not reveal the view underneath the outer one. Two entries, one hide; one closes, the
 * view stays hidden until the last is gone.
 *
 * Two kinds of entry, because hiding the browser for every dropdown would make the pane flicker
 * through an ordinary menu:
 *
 *   - **Full-screen** overlays (`rect: null`) always occlude. A modal owns the window.
 *   - **Floating panels** report their rectangle, and occlude only while it actually intersects the
 *     pane. A select opened in the left column never touches the browser and should not blink it.
 *
 * The registry is a module-level store rather than React context on purpose: overlays live all over
 * the tree, several of them are rendered through portals outside their logical parent, and a
 * provider that has to wrap all of them is a provider someone will eventually render inside one.
 * Registration is a no-op in a plain browser tab — there is no pane to occlude — so the shared UI
 * components can call it unconditionally.
 */

export interface OcclusionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcclusionEntry {
  /** Unique per open overlay. */
  id: string;
  /**
   * Where the overlay is, or null for one that covers the window.
   *
   * A function rather than a value: a panel's position is settled after it mounts and measures
   * itself, and reading it at compute time avoids a registration that is one frame stale.
   */
  getRect: () => OcclusionRect | null;
}

/**
 * Whether two rectangles share any area at all.
 *
 * Touching edges do not count, and neither does a degenerate rectangle: a panel measured at zero
 * size is not covering anything, and the strict comparisons alone would call one *inside* the pane
 * an overlap.
 */
export function intersects(a: OcclusionRect, b: OcclusionRect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Whether the pane must hide, given everything currently open.
 *
 * A null pane rectangle means the pane is not on screen; nothing needs to hide for it, and an
 * overlay opened then must not leave the view hidden once the pane comes back.
 */
export function computeOcclusion(
  entries: readonly OcclusionEntry[],
  paneRect: OcclusionRect | null,
): boolean {
  if (paneRect === null) return false;
  for (const entry of entries) {
    const rect = entry.getRect();
    // A full-screen overlay reports null and always occludes. So does a panel that cannot say
    // where it is yet — it has been opened, and guessing "somewhere harmless" is the wrong way to
    // be wrong about a surface that swallows clicks.
    if (rect === null || intersects(rect, paneRect)) return true;
  }
  return false;
}

const entries = new Map<string, OcclusionEntry>();
const listeners = new Set<() => void>();
let sequence = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Registers an open overlay. Returns the function that removes it again.
 *
 * Deliberately imperative, and deliberately not idempotent per component: each *open* is one entry,
 * so a component that opens twice without releasing has a bug this will not paper over.
 */
export function occludePane(getRect: () => OcclusionRect | null): () => void {
  const id = `occlusion-${++sequence}`;
  entries.set(id, { id, getRect });
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entries.delete(id);
    notify();
  };
}

/**
 * Tells subscribers to look again, without the set having changed.
 *
 * An overlay that is already registered can move or change size on its own: a toast stack grows a
 * second toast, a menu's content loads, a panel reflows. None of those add or remove an entry, and
 * the pane's own observers do not watch other people's elements — so without this the overlap
 * verdict would simply stay whatever it was when the entry appeared.
 */
export function notifyOcclusionChanged(): void {
  notify();
}

/** Everything currently registered, for the pane to evaluate against its own rectangle. */
export function occlusionEntries(): OcclusionEntry[] {
  return [...entries.values()];
}

/** Subscribes to the set changing. Returns the unsubscribe function. */
export function subscribeToOcclusion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drops every entry. Never called by the app — an overlay always releases its own. */
export function resetOcclusionForTests(): void {
  entries.clear();
  notify();
}
