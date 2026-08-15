/**
 * The session the in-app browser runs in.
 *
 * Everything here exists because the pane renders **untrusted third-party pages inside the
 * application window** — a booking site, its ad network, whatever it embeds — a few hundred pixels
 * from the user's orders and, later, their payment details. Design/002 §5.2 lists these settings as
 * non-negotiable; this module is where that list is enforced rather than restated.
 *
 * The partition is `persist:` because a booking flow that made the user sign in again on every
 * launch would not be usable. It is a *separate* partition from the app's own session, so a page in
 * the pane cannot read the cookie that authenticates the user to their own server.
 */
import { session } from "electron";
import type { Session } from "electron";

/** Cookies and storage for the in-app browser. Never the app's own session. */
export const IAB_PARTITION = "persist:travel-iab";

/**
 * User agent presented by the pane.
 *
 * Electron's default advertises `Electron/<version>`, which is both a fingerprint no ordinary
 * visitor has and an invitation for a site to serve a degraded page. This strips it and keeps the
 * Chrome token that is already there, so the pane looks like the Chromium it actually is.
 */
export function chromeLikeUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent
    .replace(/\sElectron\/[^\s]+/, "")
    .replace(/\sTravel Agent\/[^\s]+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Permissions the pane may be granted.
 *
 * **Empty, and default-deny.** An earlier revision listed the permissions to *refuse*, which meant
 * anything absent from the list — including every permission a future Chromium adds — was granted
 * automatically. For a surface that renders a booking site's code inside the application window
 * that is the wrong direction to fail: the list would have had to be updated ahead of Chromium to
 * stay correct.
 *
 * Phase 1 needs none of them. Geolocation is the one with a plausible travel use, and turning it on
 * is a product decision with a consent flow attached, not a default.
 */
const ALLOWED_PERMISSIONS = new Set<string>();

/** Single decision point, so the async request path and the sync check path cannot drift apart. */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

let configured: Session | null = null;

/**
 * Returns the in-app browser session, configuring it once.
 *
 * Idempotent: the handlers are installed on first call and the same `Session` comes back after
 * that, so callers do not have to track whether setup already happened.
 */
export function iabSession(): Session {
  if (configured) return configured;

  const partition = session.fromPartition(IAB_PARTITION);
  partition.setUserAgent(chromeLikeUserAgent(partition.getUserAgent()));

  partition.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isPermissionAllowed(permission));
  });
  // The synchronous check answers permissions a page can query without a prompt. It shares the
  // predicate above so the two paths cannot answer differently for the same permission.
  partition.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));

  // Downloads are cancelled outright. Phase 1 has nothing that consumes a downloaded file, and a
  // save path pointing at a directory nobody creates would fail at write time instead — a silent
  // half-working download is worse than a refusal the user can see. Phase 2 can add a real
  // destination and a UI for it.
  partition.on("will-download", (event) => {
    event.preventDefault();
  });

  configured = partition;
  return partition;
}

/**
 * `webPreferences` for every in-app browser view.
 *
 * Each entry is load-bearing:
 *   - `sandbox` / `contextIsolation` / `nodeIntegration` — the page is untrusted code;
 *   - `preload: undefined` — the app's bridge is for the app's own renderer, never for a booking
 *     site. This is spelled out rather than omitted so that adding one later is a visible decision;
 *   - `webSecurity` / `allowRunningInsecureContent` — no relaxed origin rules for convenience;
 *   - `session` — the isolated partition above.
 */
export function iabWebPreferences(): Electron.WebPreferences {
  return {
    session: iabSession(),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: undefined,
    spellcheck: false,
    devTools: false,
  };
}

/** Clears the pane's cookies and storage. The "sign me out of everything" entry point. */
export async function clearIabSession(): Promise<void> {
  await iabSession().clearStorageData();
}
