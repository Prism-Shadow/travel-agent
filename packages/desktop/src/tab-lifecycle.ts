/**
 * When a tab closes, what survives a crash, and what the user is asked on the way back.
 *
 * Design/002 §6.4 makes the point that moving the browser inside the app does not remove the tab
 * lifecycle problem, it only changes its character: the tabs are now ours to create and destroy, so
 * the risk of trampling something the user opened in their own Chrome is gone, but *who closes what
 * and when* still has to be written down. This module is that policy, kept pure so it can be
 * asserted directly rather than inferred from Electron behaviour.
 *
 * Three decisions live here:
 *
 *  1. **Task end** — preserve the final result, clean up intermediates, and let the user's own mark
 *     outrank every automatic rule.
 *  2. **Crash triage** — a renderer that died gets its tab rebuilt; a renderer that exited on
 *     purpose does not.
 *  3. **Checkpoint** — what is written to disk (URLs and ownership metadata, never a WebContents)
 *     and how a file written by an older build is read.
 *
 * Nothing here touches Electron. `BrowserPane` calls in, gets a plan, and executes it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { openDocument, stampDocument, TAB_CHECKPOINT_KIND } from "./data-migration.js";

/**
 * How a task ended, as far as its tabs are concerned.
 *
 * Deliberately three coarse cases rather than a status code: the distinction that matters for
 * cleanup is only "is there something here the user would want to look at again".
 */
export type TaskOutcome =
  /** Search, comparison, anything read-only. Nothing irreversible happened. */
  | "read_only"
  /** An order exists, or the flow stopped on a payment page. */
  | "committed"
  /** Failed or aborted. */
  | "failed"
  /**
   * The task ended without saying how.
   *
   * The agent closes its browser session with an outcome; this is what the harness reports when the
   * turn ends and no such close ever arrived — a crash, an abort, an agent that simply moved on.
   * It retains, like every other non-read-only case, because the one thing that must not happen on
   * an unknown ending is destroying pages the user may have needed.
   */
  | "unknown";

/** The subset of a tab this module needs to decide anything. */
export interface LifecycleTab {
  id: string;
  /** The user pressed "keep". Outranks every automatic rule. */
  retain: boolean;
  /** The task that may write to this tab, or null once it has been let go. */
  ownedByTask: string | null;
}

export type TabDisposition = "close" | "retain";

/**
 * Close or keep one tab (002 §6.4, table one).
 *
 * The retain mark is checked first and returns immediately, which is the whole point of the rule:
 * a user who said "keep this" must not have that overturned by a policy that thinks the task was
 * read-only. Everything else follows the outcome — a committed booking leaves evidence worth
 * keeping, a failure leaves a scene worth reading, and an intermediate search page can be cleaned
 * up once the task's final result has been selected separately by `planTaskEnd`.
 */
export function resolveTabDisposition(tab: LifecycleTab, outcome: TaskOutcome): TabDisposition {
  if (tab.retain) return "retain";
  return outcome === "read_only" ? "close" : "retain";
}

export interface TaskEndPlan {
  /** Tabs to destroy. */
  close: string[];
  /**
   * Tabs to keep, with their ownership dropped.
   *
   * A retained tab stops being the task's: `ownedByTask` becomes null, the agent may no longer
   * write to it, and only the user closes it from here on.
   */
  retain: string[];
}

export interface TaskEndOptions {
  /**
   * The task's user-visible final result. A read-only task releases this tab to the user instead of
   * deleting it, so the final answer can still point at a page the user can inspect or sign in to.
   * If it is absent or no longer owned by the task, the newest owned tab is used as a safe fallback.
   */
  readOnlyResultTabId?: string | null;
}

/**
 * What to do with every tab a task owned.
 *
 * Tabs owned by *other* tasks, and tabs already released, are not in the plan at all — ending one
 * task must never touch another's pages, and a second call for the same task must be a no-op
 * rather than a second round of closing.
 */
export function planTaskEnd(
  tabs: readonly LifecycleTab[],
  taskId: string,
  outcome: TaskOutcome,
  options: TaskEndOptions = {},
): TaskEndPlan {
  const plan: TaskEndPlan = { close: [], retain: [] };
  const owned = tabs.filter((tab) => tab.ownedByTask === taskId);
  let readOnlyResultId: string | undefined;
  if (outcome === "read_only") {
    readOnlyResultId = owned.some((tab) => tab.id === options.readOnlyResultTabId)
      ? (options.readOnlyResultTabId ?? undefined)
      : owned.at(-1)?.id;
  }

  for (const tab of owned) {
    const disposition =
      tab.id === readOnlyResultId ? "retain" : resolveTabDisposition(tab, outcome);
    plan[disposition].push(tab.id);
  }
  return plan;
}

/**
 * Electron's `render-process-gone` reasons.
 *
 * Spelled out rather than imported so this module stays free of Electron: the string set is part of
 * the CDP-adjacent public API and changing it would be a breaking change upstream.
 */
export type RenderProcessGoneReason =
  | "clean-exit"
  | "abnormal-exit"
  | "killed"
  | "crashed"
  | "oom"
  | "launch-failed"
  | "integrity-failure";

export interface CrashRecovery {
  /** Whether to build a replacement view for this tab. */
  rebuild: boolean;
  /** Where to send the replacement. Absent when there is nothing safe to reload. */
  url?: string;
}

/**
 * What to do when one tab's renderer goes away (002 §6.4, three).
 *
 * Scoped to the tab on purpose. The window's own `render-process-gone` handler reloads the whole
 * app (`main.ts`), and an IAB view must never reach it — rebuilding one page is recovery, reloading
 * the app on top of a booking in another tab is data loss.
 *
 * **Rebuild is the default, and the reason string is not what suppresses it.** The only thing that
 * suppresses a rebuild is `deliberate`: a flag the pane sets on the tab it is itself tearing down,
 * before the teardown reaches the process. `killed` in particular is *not* evidence of a deliberate
 * close — the Linux OOM killer, a container memory limit and a user's `kill -9` all report it, and
 * those are precisely the cases where the user loses a page they were working in and expects it
 * back. Treating "killed" as intentional would have silently dropped a tab exactly when the crash
 * was worst.
 *
 * `clean-exit` is the one reason that stands on its own: a renderer only exits cleanly when it was
 * asked to (our own close, or the page calling `window.close()`), and a crash never reports it.
 * Rebuilding there would resurrect a page that was closed on purpose.
 */
export function planCrashRecovery(input: {
  reason: RenderProcessGoneReason;
  lastUrl: string;
  /** The pane is destroying this view itself. Set before the close, cleared nowhere — the tab goes. */
  deliberate?: boolean;
}): CrashRecovery {
  if (input.deliberate === true) return { rebuild: false };
  if (input.reason === "clean-exit") return { rebuild: false };
  // A blank or unusable last URL still gets a tab back — the user keeps their place in the strip —
  // but there is nothing to navigate to, so the replacement opens empty.
  return isRestorableUrl(input.lastUrl) ? { rebuild: true, url: input.lastUrl } : { rebuild: true };
}

/**
 * Whether a recorded URL may be reopened.
 *
 * The same allowlist the pane applies to live navigation, applied again on the way *out of* a file
 * on disk. A checkpoint is an input like any other: it is written by us, but it lives in the user's
 * home directory where anything with a write handle can edit it, and `file:` or `javascript:` in a
 * restored tab would be that file deciding what the browser opens.
 */
export function isRestorableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Bumped when the on-disk shape changes incompatibly; an older or newer file is discarded. */
export const TAB_CHECKPOINT_VERSION = 1;

/**
 * One tab as recorded on disk. Metadata only — never a WebContents, which cannot cross a process.
 *
 * **There is deliberately no `ownedByTask` field.** A checkpoint is read after the run that wrote it
 * died, so every task it mentions is gone; restoring an owner would hand a fresh agent write access
 * to a page on the strength of a dead run's say-so, and would do it before any `tabRegistry` claim
 * had been made. Restored tabs come back unowned and an agent must claim one the ordinary way
 * (002 §6.4 二, "重新走一次归属认领"). Leaving the field out of the format, rather than ignoring it
 * on read, is what makes that unable to regress.
 */
export interface TabCheckpointEntry {
  id: string;
  url: string;
  /** The conversation whose tab strip shows this tab, or null for one that belongs to no task. */
  taskScope: string | null;
  retain: boolean;
  /** Whether it was the active tab of its scope. */
  active: boolean;
}

export interface TabCheckpoint {
  version: number;
  /** Oldest app schema-version that can still read this file (004 Phase 6; see data-migration.ts). */
  compat?: number;
  tabs: TabCheckpointEntry[];
}

/** Upper bounds on what a checkpoint may contain. A file claiming more than this is not ours. */
const MAX_CHECKPOINT_TABS = 100;
const MAX_CHECKPOINT_URL = 4096;
/** A task id is a harness session id; this is far above any real one and far below a payload. */
const MAX_CHECKPOINT_SCOPE = 128;
const MAX_CHECKPOINT_ID = 64;

/**
 * Records the tabs worth writing down.
 *
 * `about:blank` and error pages are skipped: restoring them offers the user a choice between
 * nothing and nothing. Everything kept is a URL the user could have bookmarked.
 */
export function buildCheckpoint(tabs: readonly TabCheckpointEntry[]): TabCheckpoint {
  // Stamped with `version` + `compat` (004 Phase 6): a checkpoint written on beta must be readable
  // after a rollback to stable when the change was additive.
  return stampDocument(TAB_CHECKPOINT_KIND, {
    tabs: tabs
      .filter((tab) => isRestorableUrl(tab.url))
      .slice(0, MAX_CHECKPOINT_TABS)
      .map((tab) => ({
        id: tab.id,
        url: tab.url,
        taskScope: tab.taskScope,
        retain: tab.retain,
        active: tab.active,
      })),
  }) as TabCheckpoint;
}

/**
 * Reads a checkpoint back, or returns null.
 *
 * Treated as untrusted input throughout. It is a file in the user's home directory: we wrote it, but
 * anything with a write handle can edit it, and the pane will open whatever URLs it names. So every
 * field is bounded, every URL goes back through the navigation allowlist, duplicate ids are dropped
 * (two tabs with one id would make every later `closeTab`/`selectTab` ambiguous), and at most one
 * tab per scope stays marked active.
 *
 * Every failure mode lands on null or a dropped row rather than an exception: an unreadable
 * checkpoint must cost the user their restore prompt, never their app launch. Unknown versions are
 * discarded rather than guessed at.
 */
export function parseCheckpoint(raw: string): TabCheckpoint | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  // Version handling goes through the migration framework (004 Phase 6): an older checkpoint is
  // migrated forward, a newer-but-compatible one (a rollback) is read down-level, and a genuinely
  // unreadable one throws — which for a checkpoint means the same as before, a dropped restore
  // prompt rather than a failed launch.
  let record: Record<string, unknown>;
  try {
    record = openDocument<TabCheckpoint & Record<string, unknown>>(TAB_CHECKPOINT_KIND, value).doc;
  } catch {
    return null;
  }
  if (!Array.isArray(record.tabs)) return null;

  const tabs: TabCheckpointEntry[] = [];
  const seenIds = new Set<string>();
  const scopesWithActive = new Set<string>();
  for (const entry of record.tabs.slice(0, MAX_CHECKPOINT_TABS)) {
    const parsed = parseCheckpointEntry(entry);
    if (!parsed) continue;
    if (seenIds.has(parsed.id)) continue;
    seenIds.add(parsed.id);
    if (parsed.active) {
      // One active tab per scope. A file claiming two would leave the strip's selection depending on
      // iteration order, which is exactly the kind of state that only misbehaves in front of a user.
      const scopeKey = parsed.taskScope ?? "";
      if (scopesWithActive.has(scopeKey)) parsed.active = false;
      else scopesWithActive.add(scopeKey);
    }
    tabs.push(parsed);
  }
  return stampDocument(TAB_CHECKPOINT_KIND, { tabs }) as TabCheckpoint;
}

function parseCheckpointEntry(value: unknown): TabCheckpointEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record.id;
  const url = record.url;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_CHECKPOINT_ID) return null;
  if (typeof url !== "string" || url.length > MAX_CHECKPOINT_URL) return null;
  if (!isRestorableUrl(url)) return null;
  const scope = record.taskScope;
  const taskScope =
    typeof scope === "string" && scope.length > 0 && scope.length <= MAX_CHECKPOINT_SCOPE
      ? scope
      : null;
  return {
    id,
    url,
    taskScope,
    retain: record.retain === true,
    active: record.active === true,
  };
}

/**
 * Folds a newly-crashed run's tabs into an unanswered crash snapshot.
 *
 * The case this exists for: the app crashed, the user closed the window without answering the
 * "N pages left" prompt, opened the app again, and it crashed again. Neither run's pages may be
 * dropped just because the prompt outlived one of them.
 *
 * De-duplicated by URL within a conversation, since the same page reopened in two runs is one page
 * to the user. Ids are renumbered because they are per-run and would otherwise collide — restore
 * mints fresh tabs anyway, so nothing downstream depends on them.
 */
export function mergeCheckpoints(pending: TabCheckpoint, incoming: TabCheckpoint): TabCheckpoint {
  const merged: TabCheckpointEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...pending.tabs, ...incoming.tabs]) {
    const key = `${entry.taskScope ?? ""}\u0000${entry.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...entry, id: `restore-${merged.length + 1}` });
    if (merged.length >= MAX_CHECKPOINT_TABS) break;
  }
  // Two runs can each have marked an active tab in the same conversation; the parser would drop
  // the second, but doing it here keeps the file we write consistent with what we would accept.
  const scopesWithActive = new Set<string>();
  for (const entry of merged) {
    if (!entry.active) continue;
    const scope = entry.taskScope ?? "";
    if (scopesWithActive.has(scope)) entry.active = false;
    else scopesWithActive.add(scope);
  }
  return stampDocument(TAB_CHECKPOINT_KIND, { tabs: merged }) as TabCheckpoint;
}

/**
 * How many pages the user is told about after a crash.
 *
 * The prompt exists because automatic restore is the wrong default (002 §6.4, three): reopening a
 * batch of booking pages without being asked re-enters flows the user may have abandoned, and hands
 * the sites a burst of traffic that reads as automation.
 */
export function pendingRestoreCount(checkpoint: TabCheckpoint | null): number {
  return checkpoint?.tabs.length ?? 0;
}

/**
 * The checkpoint's shape on disk is one file; this is the name of the scratch file it is written
 * through. Random rather than pid-based: two windows of the same process would otherwise pick the
 * same name and one would truncate the other's half-written file.
 */
function temporaryPathFor(filePath: string): string {
  return `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
}

/**
 * Moves the temporary file over the real one, or leaves the real one exactly as it was.
 *
 * One attempt, deliberately. `fs.renameSync` replaces an existing destination on POSIX and, through
 * libuv's `MoveFileEx`, on Windows too — but on Windows it can still fail with EPERM/EACCES/EBUSY
 * while another process holds the destination open (an antivirus scanner, the search indexer). The
 * response to that is to keep the checkpoint that is already there and throw away the new one.
 *
 * The two things this must never do, both of which an earlier revision did:
 *
 *   - **Never unlink the destination first.** A rename can fail after the unlink, and then the user
 *     has neither the old checkpoint nor the new one — losing the very pages the file exists to
 *     recover. "Old or new, never neither" is the whole guarantee.
 *   - **Never spin waiting to retry.** This runs on the Electron main thread, where a busy loop is
 *     a frozen window. A checkpoint is written on every navigation; a hundred milliseconds of spin
 *     on a contended file would be visible as jank in the pane it is describing.
 *
 * A skipped write costs at most one stale entry in a prompt the user answers by hand.
 */
function replaceFile(from: string, to: string): void {
  fs.renameSync(from, to);
}

/**
 * The checkpoint file.
 *
 * Written through a temporary file and renamed, so a crash mid-write leaves either the old file or
 * the new one and never a half-parsed mixture — the failure this guards against is precisely the
 * one the file exists to survive.
 */
export class TabCheckpointStore {
  constructor(private readonly filePath: string) {}

  read(): TabCheckpoint | null {
    try {
      return parseCheckpoint(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * Writes the checkpoint. Returns whether it actually landed on disk.
   *
   * The return value matters in one place and matters a lot: promoting a crashed run's checkpoint
   * into the pending snapshot must not delete the original until the copy is known to exist. A
   * `void` return made that impossible to get right, and the failure deleted the very pages the
   * file exists to recover.
   */
  write(checkpoint: TabCheckpoint): boolean {
    const temporary = temporaryPathFor(this.filePath);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(checkpoint), { encoding: "utf8", mode: 0o600 });
      replaceFile(temporary, this.filePath);
      return true;
    } catch {
      // A checkpoint is an optimisation over losing the tabs entirely. A full disk, a read-only
      // home directory, or a destination another process has open must not take down the pane, so
      // the failure is swallowed here rather than surfaced into the layout path that called it.
      // Whatever was already at `filePath` is still there and still valid.
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Nothing to clean up.
      }
      return false;
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // Already gone, which is the state this was asking for.
    }
  }
}
