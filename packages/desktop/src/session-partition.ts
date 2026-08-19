/**
 * The session the in-app browser runs in.
 *
 * Everything here exists because the pane renders **untrusted third-party pages inside the
 * application window** — a booking site, its ad network, whatever it embeds — a few hundred pixels
 * from the user's orders and, later, their payment details. The design lists these settings as
 * non-negotiable; this module is where that list is enforced rather than restated.
 *
 * The partition is `persist:` because a booking flow that made the user sign in again on every
 * launch would not be usable. It is a *separate* partition from the app's own session, so a page in
 * the pane cannot read the cookie that authenticates the user to their own server.
 */
import fs from "node:fs";
import path from "node:path";
import { session } from "electron";
import type { Session } from "electron";
import { isValidId, sessionScratchpadDir } from "@prismshadow/penguin-core";

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

  // Downloads land in the **Session's own scratchpad** — `<agentDir>/scratchpad/<sessionId>/downloads`
  // — never in the user's Downloads folder. That directory is the one the agent
  // and the server already read, and it is deleted with the Session, so a downloaded file has the
  // same lifetime as the conversation that fetched it.
  //
  // Three things make it safe rather than merely convenient: the directory is built by the main
  // process from its own data root (see `resolveSessionDownloadDir`), the filename is sanitised
  // because it comes from the site, and a download that cannot be attributed to a conversation is
  // cancelled outright, because there is nowhere honest to put it.
  partition.on("will-download", (event, item, webContents) => {
    if (!startDownload(downloadDirectory?.(webContents) ?? null, item)) event.preventDefault();
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

/**
 * Clears everything the pane remembers. The "sign me out of everything" entry point.
 *
 * Three calls, because storage alone is not a sign-out. `clearStorageData` takes cookies, local
 * storage and the rest; `clearCache` takes the HTTP cache, which can serve a signed-in page back
 * from disk; `clearAuthCache` takes cached HTTP credentials, which are not storage at all and would
 * otherwise re-authenticate the very next request. A "clear browser data" that leaves any of the
 * three is one a user would reasonably call broken.
 */
export async function clearIabSession(): Promise<void> {
  const partition = iabSession();
  await partition.clearStorageData();
  await partition.clearCache();
  await partition.clearAuthCache();
}

/**
 * Turns a site-supplied filename into one safe to write.
 *
 * The name comes from a `Content-Disposition` header or a URL, which means it comes from the site:
 * `../../.ssh/authorized_keys` is a filename as far as HTTP is concerned. Everything that could
 * leave the directory is removed rather than escaped, and an empty result gets a neutral name
 * instead of being refused — a download with an awkward name is still the file the user asked for.
 */
export function sanitizeDownloadFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // Control characters, the Windows-reserved set, and leading dots (which would hide the file).
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned === "" ? "download" : cleaned;
}

/**
 * Where one Session's downloads go: `<agentDir>/scratchpad/<sessionId>/downloads`.
 *
 * Built here from the main process's **own** data root, taking only the three ids the renderer can
 * supply — never a path. A renderer that named a directory would be naming where a remote site's
 * bytes land; one that names ids can at worst name another conversation of the same user, and the
 * checks below refuse even that if it does not resolve inside the data root.
 *
 * Returns null rather than throwing: a download that cannot be placed is cancelled, and a caller
 * that has to distinguish "no session" from "bad session" has nothing different to do about it.
 */
export function resolveSessionDownloadDir(
  dataRoot: string,
  ids: { projectId: string; agentId: string; sessionId: string },
): string | null {
  if (!isValidId(ids.projectId) || !isValidId(ids.agentId) || !isValidId(ids.sessionId)) {
    return null;
  }
  const directory = path.join(
    sessionScratchpadDir(dataRoot, ids.projectId, ids.agentId, ids.sessionId),
    DOWNLOADS_DIRNAME,
  );
  return containedInside(dataRoot, directory) ? directory : null;
}

/**
 * Whether a path really lands inside a root — following links, not just comparing strings.
 *
 * `path.relative` compares text. A symlink anywhere along the way makes that text a lie: a
 * `scratchpad/<session>` or `downloads` that points elsewhere passes the lexical test and writes
 * wherever it points, which for a remote site's bytes is the whole of the risk. So every component
 * that *exists* is resolved with `realpath` and the comparison is made on what the filesystem
 * actually says.
 *
 * Fails closed on anything it cannot establish — an unreadable directory, a resolution error — and
 * tolerates only the components that do not exist yet, which are the ones about to be created and
 * therefore cannot be links to anywhere.
 */
function containedInside(root: string, target: string): boolean {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(root));
  } catch {
    // No data root on disk yet: nothing has been created inside it either, so the lexical check is
    // the whole truth at this point.
    const lexical = path.relative(path.resolve(root), path.resolve(target));
    return lexical !== "" && !lexical.startsWith("..") && !path.isAbsolute(lexical);
  }

  // Walk down from the root, resolving each component that exists.
  let current = realRoot;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;

  for (const segment of relative.split(path.sep)) {
    const next = path.join(current, segment);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(next);
    } catch {
      // Does not exist yet — and neither does anything below it, so there is no link to follow.
      return true;
    }
    if (stat.isSymbolicLink()) {
      let resolved: string;
      try {
        resolved = fs.realpathSync(next);
      } catch {
        return false;
      }
      const inside = path.relative(realRoot, resolved);
      if (inside.startsWith("..") || path.isAbsolute(inside)) return false;
      current = resolved;
    } else {
      current = next;
    }
  }
  return true;
}

/**
 * A sibling directory rather than the scratchpad root.
 *
 * The Session scratchpad already holds harness by-products — truncated tool output, `GOAL.yaml`,
 * saved input images — and a download is the user's file. Keeping them apart is what makes "which
 * of these did the site give me" answerable, and it matches the shape truncated output already
 * uses.
 */
const DOWNLOADS_DIRNAME = "downloads";

/**
 * A path that does not overwrite an existing file.
 *
 * Two downloads of `report.pdf` are two files. Chromium would happily replace the first, which for
 * a booking confirmation is losing the thing the user came for; the second becomes `report (2).pdf`
 * exactly as a browser's own download manager does it.
 */
export function uniqueDownloadPath(directory: string, filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length) || safe;

  for (let index = 1; index <= MAX_DOWNLOAD_COLLISIONS; index += 1) {
    const candidate =
      index === 1
        ? path.join(directory, safe)
        : path.join(directory, `${stem} (${index})${extension}`);
    if (reserved.has(candidate)) continue;
    // `lstat`, not `existsSync`: a **dangling** symlink is not "existing" to `existsSync`, so a
    // name planted as a link to somewhere outside the root would have been chosen as free and then
    // written straight through.
    if (entryExists(candidate)) continue;
    // Reserved before returning. Two downloads that start together see the same empty directory, so
    // `existsSync` alone hands both the same path and the second silently replaces the first — the
    // check and the use are not one operation. Chromium creates the file some time after this
    // returns, which is exactly the window this closes.
    reserved.add(candidate);
    return candidate;
  }
  // Pathological, and a name nobody else can be holding beats a hang.
  const fallback = path.join(directory, `${stem} (${process.hrtime.bigint()})${extension}`);
  reserved.add(fallback);
  return fallback;
}

/**
 * Paths handed out but not yet written.
 *
 * Released when the download finishes, fails or is cancelled — see `will-download` above. A leak
 * here costs only a skipped filename, which is why release is best-effort rather than guarded.
 */
const reserved = new Set<string>();

/** How far the `(2)`, `(3)` … search goes before falling back to something unique by construction. */
const MAX_DOWNLOAD_COLLISIONS = 5000;

/** Whether anything at all is at this path — a file, a directory, or a link to nowhere. */
function entryExists(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Frees a reserved name once the download is no longer going to use it. */
export function releaseDownloadPath(target: string): void {
  reserved.delete(target);
}

/** Test seam: forgets every reservation. */
export function resetDownloadReservationsForTests(): void {
  reserved.clear();
}

/**
 * Tells the session where a downloading view's files go.
 *
 * Wired by the pane, which is the only thing that knows which conversation a view belongs to. Until
 * it is, downloads are cancelled: a file with no conversation has nowhere to go that would not be a
 * guess.
 */
let downloadDirectory: ((contents: Electron.WebContents) => DownloadTarget | null) | null = null;

/**
 * Where one conversation's downloads go, and the root that answer must stay inside.
 *
 * The root travels with the directory because containment has to be re-checked at the moment the
 * file is written, not only when the directory was worked out — see `downloadTargetFor`.
 */
export interface DownloadTarget {
  directory: string;
  root: string;
}

export function setDownloadDirectoryResolver(
  resolver: (contents: Electron.WebContents) => DownloadTarget | null,
): void {
  downloadDirectory = resolver;
}

/**
 * The path a download will actually be written to, or null to refuse it.
 *
 * **Checked here, at the moment of use, and not only where the directory was worked out.** Those
 * are two different times: a conversation's download directory is resolved when the shell learns
 * which Agent the conversation belongs to, and the file may be written minutes later. In between,
 * anything running as the user — including the agent's own shell commands, which is the whole
 * point — can replace `<session>/downloads`, or any directory above it, with a link pointing
 * outside the data root. A path that was contained when it was computed is not contained when it
 * is used, and it is the use that writes a remote site's bytes.
 *
 * So the directory is created, then *resolved through the filesystem*, then checked against the
 * root resolved the same way, and the file name is joined onto the **resolved** directory — so the
 * path handed to Chromium contains no links at all. The leaf is checked with `lstat` rather than
 * `existsSync`, because a dangling symlink is invisible to the latter and is exactly the shape this
 * has to refuse.
 */
/**
 * Points one download at a path inside its conversation's scratchpad. False means refuse it.
 *
 * Separated from the event handler for two reasons. It is the whole decision, so it can be tested
 * without Electron; and it must **never throw**, because an exception escaping a `will-download`
 * listener is an uncaught exception in the main process — an app crash in place of a download that
 * did not happen. Every failure is a `false` here and a `preventDefault` at the call site.
 */
export function startDownload(target: DownloadTarget | null, item: DownloadHandle): boolean {
  // The name is read **once**, here, and every later mention uses the copy. `getFilename()` is a
  // call into a Chromium object that may have been destroyed by the time a failure is being
  // reported, and a throw from *inside the failure path* would escape this function — which is the
  // one thing it must never do.
  let filename: string;
  let savePath: string | null;
  try {
    filename = item.getFilename();
    savePath = downloadTargetFor(target, filename);
  } catch {
    return false;
  }
  if (savePath === null) return false;
  const reserved = savePath;

  // The reservation exists only to stop two simultaneous downloads choosing the same name before
  // either has created a file; once this one is done with it, the filesystem is the record again.
  // Registered *before* `setSavePath` so a failure there cannot leak the name for the life of the
  // process — the next download of that file would otherwise be handed `receipt (2).pdf` for no
  // reason anyone could see.
  try {
    item.once("done", () => releaseDownloadPath(reserved));
  } catch (error) {
    releaseDownloadPath(reserved);
    report(`could not watch the download of ${filename}: ${describe(error)}`);
    return false;
  }
  try {
    item.setSavePath(reserved);
  } catch (error) {
    releaseDownloadPath(reserved);
    report(`could not set the save path for ${filename}: ${describe(error)}`);
    return false;
  }
  return true;
}

/**
 * Says why a download was refused, and cannot itself become the reason one crashes the app.
 *
 * The logger is injectable, so it is somebody else's code; a throw from it inside a `will-download`
 * listener would be an uncaught exception in the main process. A lost diagnostic line is a much
 * smaller problem than that.
 */
function report(message: string): void {
  try {
    logDownloadRefusal(message);
  } catch {
    // Nothing useful is left to do: the thing that reports problems is the problem.
  }
}

/** The part of Electron's `DownloadItem` this module uses; narrowed so it can be doubled in a test. */
export interface DownloadHandle {
  getFilename(): string;
  setSavePath(path: string): void;
  once(event: "done", listener: () => void): unknown;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Where a refused download is reported.
 *
 * Deliberately a seam rather than a bare `console.error`: a download that silently does not happen
 * is the confusing failure, and a test needs to be able to see that the refusal was reported
 * without the report itself becoming noise in the run.
 */
let logDownloadRefusal: (message: string) => void = (message) => {
  process.stderr.write(`[iab] ${message}\n`);
};

export function setDownloadLogger(log: (message: string) => void): void {
  logDownloadRefusal = log;
}

export function downloadTargetFor(target: DownloadTarget | null, filename: string): string | null {
  if (target === null) return null;
  try {
    // **Before `mkdir`, not only after it.** `recursive: true` happily creates the tail of a path
    // whose parent is a link pointing out of the data root — so a check that ran only afterwards
    // refused the *bytes* but had already created a directory outside the root, which is both a
    // write nobody asked for and a foothold for the next attempt. The preflight resolves every
    // component that exists and fails closed; the post-check below still runs, because the
    // preflight cannot see a swap that happens between the two.
    if (!containedInside(target.root, target.directory)) return null;
    fs.mkdirSync(target.directory, { recursive: true });
    const realDirectory = fs.realpathSync(target.directory);
    const realRoot = fs.realpathSync(target.root);
    const inside = path.relative(realRoot, realDirectory);
    if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) return null;
    return uniqueDownloadPath(realDirectory, filename);
  } catch {
    // A directory that cannot be created or resolved, or a root that is not there: refuse, rather
    // than let Chromium fall back to the user's own Downloads folder.
    return null;
  }
}
