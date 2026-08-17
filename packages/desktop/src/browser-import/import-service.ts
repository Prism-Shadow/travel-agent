/**
 * The import itself: read one browser profile, write into the in-app browser.
 *
 * Everything under `browser-import/` up to this point is a reader. This is the only file that
 * *writes*, and the shape of the whole feature is decided by two rules it follows.
 *
 * **Nothing is written until the user ticks the box for it.** The dialog offers three kinds; a kind
 * that was not selected is not read, not decrypted, and on macOS does not even provoke the keychain
 * prompt (the key is acquired lazily, only for the kinds that need one — history needs none). A
 * feature that decrypted the password database in order to *count* it for a checkbox label would be
 * doing the sensitive act before the consent, which is the thing the dialog exists to obtain.
 *
 * **A partial import is reported, never rounded up to success.** Every kind returns what it wrote,
 * what it skipped and why. A cookie jar where 40 rows out of 4000 failed to decrypt is a successful
 * import with a footnote; one where the scheme itself is unreadable (Chrome 127+ App-Bound
 * Encryption) is a failure with a sentence explaining that no application could have read it. Both
 * are visible in the result; neither is a thrown exception, because a thrown import loses the two
 * kinds that did work.
 */
import type { Session } from "electron";
import { ChromeDecryptError } from "./chrome-crypto.js";
import type { ChromeKey } from "./chrome-crypto.js";
import { acquireChromeKey } from "./chrome-key.js";
import { kindFile, resolveSource } from "./chrome-profiles.js";
import type { ImportKind } from "./chrome-profiles.js";
import { readCookies, readHistory, readLogins } from "./chrome-store.js";
import type { CredentialStore } from "./credential-store.js";
import type { HistoryStore } from "./history-store.js";

/** What one kind's import did. */
export interface KindOutcome {
  kind: ImportKind;
  /** How many items reached the in-app browser. */
  imported: number;
  /** Rows read but not usable — undecryptable, malformed, or rejected on write. */
  skipped: number;
  /** Set when this kind could not be imported at all. A sentence for the user, not a stack. */
  failure: string | null;
}

export interface ImportOutcome {
  sourceId: string;
  results: KindOutcome[];
  /** True when at least one item of at least one kind landed. */
  anythingImported: boolean;
}

export interface ImportRequest {
  sourceId: string;
  kinds: ImportKind[];
}

export interface ImportDependencies {
  /** The in-app browser's session — where cookies land. */
  session: Session;
  /** Built lazily by the caller, because unlocking it may prompt. Null when unavailable. */
  credentials: () => Promise<CredentialStore | null>;
  history: () => HistoryStore | null;
  platform?: NodeJS.Platform;
  home?: string;
  /** Test seam. Real callers leave this alone and the OS keyring is used. */
  acquireKey?: typeof acquireChromeKey;
}

function failure(kind: ImportKind, message: string): KindOutcome {
  return { kind, imported: 0, skipped: 0, failure: message };
}

/**
 * Runs one import.
 *
 * Never throws for a data problem: every failure becomes a `KindOutcome.failure` so that the two
 * kinds which worked still land and are still reported. It throws only for a request that is not
 * one this process issued — an unknown source id — because that is a bug or an attempt, not a
 * condition to report in a dialog.
 */
export async function runImport(
  request: ImportRequest,
  deps: ImportDependencies,
): Promise<ImportOutcome> {
  const platform = deps.platform ?? process.platform;
  const source = resolveSource(request.sourceId, { platform, home: deps.home });
  if (source === null) {
    throw new Error("That browser profile is no longer on this machine.");
  }

  const acquire = deps.acquireKey ?? acquireChromeKey;
  const results: KindOutcome[] = [];

  /**
   * The decryption key, fetched at most once and only if a selected kind needs it.
   *
   * Memoised as a *settled* promise — including its rejection — so that a declined macOS keychain
   * prompt is not shown again for the second kind. Asking twice for one Import click would read as
   * the app not taking no for an answer.
   */
  let keyPromise: Promise<ChromeKey> | null = null;
  const key = (): Promise<ChromeKey> => {
    keyPromise ??= acquire({
      familyId: source.familyId,
      userDataDir: source.userDataDir,
      platform,
    });
    return keyPromise;
  };

  const sourceLabel = `${source.familyId}:${request.sourceId.split(":")[1] ?? ""}`;

  for (const kind of request.kinds) {
    try {
      switch (kind) {
        case "cookies":
          results.push(await importCookies(source.profileDir, await key(), platform, deps.session));
          break;
        case "passwords":
          results.push(
            await importPasswords(source.profileDir, await key(), platform, deps, sourceLabel),
          );
          break;
        case "history":
          results.push(await importHistory(source.profileDir, deps, sourceLabel));
          break;
      }
    } catch (error) {
      // Includes a refused keychain prompt and a missing file. Both are sentences the dialog can
      // show; neither should cost the other kinds their import.
      results.push(failure(kind, describe(error)));
    }
  }

  return {
    sourceId: request.sourceId,
    results,
    anythingImported: results.some((result) => result.imported > 0),
  };
}

function describe(error: unknown): string {
  if (error instanceof ChromeDecryptError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Cookies into the pane's session.
 *
 * Written one at a time because Electron has no bulk API, and *sequentially* rather than with
 * `Promise.all`: a few thousand concurrent `cookies.set` calls into one Chromium cookie store is a
 * reliable way to make the main process unresponsive during exactly the moment the user is watching
 * a progress dialog.
 *
 * A cookie Chromium accepted can still be refused here — Electron applies current rules to a jar
 * written under older ones, and `__Host-` prefixed cookies in particular are strict about their
 * domain and path. Those are counted as skipped rather than surfaced individually: the person cares
 * that 3,940 of 4,000 arrived, not which sixty did not.
 */
async function importCookies(
  profileDir: string,
  key: ChromeKey,
  platform: NodeJS.Platform,
  session: Session,
): Promise<KindOutcome> {
  const read = await readCookies(kindFile(profileDir, "cookies"), key, platform);
  if (read.fatal !== null) return failure("cookies", read.fatal);

  let imported = 0;
  let skipped = read.skipped;
  for (const cookie of read.items) {
    try {
      await session.cookies.set(cookie);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { kind: "cookies", imported, skipped, failure: null };
}

/**
 * Saved logins into the credential store.
 *
 * The plaintext passwords exist between `readLogins` and `putMany` and nowhere else: they are never
 * logged, never returned, and the array is dropped as soon as the store has sealed them. The store
 * itself has no path that hands one to a model — see `credential-store.ts`.
 */
async function importPasswords(
  profileDir: string,
  key: ChromeKey,
  platform: NodeJS.Platform,
  deps: ImportDependencies,
  source: string,
): Promise<KindOutcome> {
  const store = await deps.credentials();
  if (store === null) {
    return failure(
      "passwords",
      "Saved passwords need encrypted storage, and this machine does not offer any. Nothing was " +
        "written, because storing them unprotected would be worse than not importing them.",
    );
  }

  const read = await readLogins(kindFile(profileDir, "passwords"), key, platform);
  if (read.fatal !== null) return failure("passwords", read.fatal);

  const imported = store.putMany(
    read.items.map((login) => ({
      origin: login.origin,
      username: login.username,
      password: login.password,
      source,
    })),
  );
  return { kind: "passwords", imported, skipped: read.skipped, failure: null };
}

/** History into the new history store. No key, no keychain prompt — the file is not encrypted. */
async function importHistory(
  profileDir: string,
  deps: ImportDependencies,
  source: string,
): Promise<KindOutcome> {
  const store = deps.history();
  if (store === null) {
    return failure("history", "The in-app browser's history store is unavailable.");
  }
  const read = await readHistory(kindFile(profileDir, "history"));
  const imported = store.importMany(read.items, source);
  return { kind: "history", imported, skipped: read.skipped, failure: null };
}
