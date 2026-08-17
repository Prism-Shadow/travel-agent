/**
 * What the IPC layer talks to: one object that owns the stores and answers the dialog's two calls.
 *
 * It exists so that `ipc.ts` does not have to know how a credential store is constructed, when a
 * history database is opened, or which of the three kinds needs a keychain. Those are all decisions
 * about *when to touch something sensitive*, and they are made here, in one place, rather than
 * spread across handlers.
 *
 * Both stores are built lazily and cached:
 *
 * - The **history database** is opened on first use. Opening it creates a file, and a user who
 *   never imports anything and never types in the address bar should not have one.
 * - The **credential store** unlocks on first use, and unlocking touches the OS keychain. Doing it
 *   at startup would put a keychain access at every launch of the app for a feature most launches
 *   do not use.
 *
 * A failure to build either is remembered as `null` rather than retried per call: on a machine with
 * no usable encrypted storage the answer will not change within a run, and retrying would mean a
 * failed keychain prompt for every checkbox the user ticks.
 */
import path from "node:path";
import { discoverSources, kindFile, resolveSource } from "./chrome-profiles.js";
import type { ImportKind, ImportSource } from "./chrome-profiles.js";
import { isBrowserRunning } from "./chrome-key.js";
import { countItems } from "./chrome-store.js";
import { CredentialStore } from "./credential-store.js";
import { HistoryStore } from "./history-store.js";
import { runImport } from "./import-service.js";
import type { ImportOutcome } from "./import-service.js";
import type { SafeStoragePort, StorageAvailability } from "../vault/safe-storage.js";
import type { Session } from "electron";

export interface BrowserImporterOptions {
  /** The in-app browser's session — where cookies land. */
  session: Session;
  /** The app's userData directory. Both stores live under it. */
  userDataDir: string;
  safeStorage: SafeStoragePort;
  /** The same fail-closed judgement the Vault makes. Decides whether passwords can be offered. */
  availability: StorageAvailability;
  /** Where a refusal or a partial import is reported. */
  log?: (message: string) => void;
}

export interface ImportSourcesReport {
  sources: ImportSource[];
  runningBrowsers: string[];
  /** False when this machine cannot store passwords, so the dialog greys that checkbox out. */
  credentialsAvailable: boolean;
}

export class BrowserImporter {
  private readonly options: BrowserImporterOptions;
  private history: HistoryStore | null = null;
  private credentials: CredentialStore | null = null;
  /** Set once a credential store has been attempted, so a failure is not retried per call. */
  private credentialsAttempted = false;

  constructor(options: BrowserImporterOptions) {
    this.options = options;
  }

  private log(message: string): void {
    (this.options.log ?? ((line: string) => process.stderr.write(`[import] ${line}\n`)))(message);
  }

  /**
   * The history store, opened on first use.
   *
   * Public because the address bar reads from it too — the import is what fills it, but it is not
   * the only thing that uses it.
   */
  historyStore(): HistoryStore | null {
    try {
      this.history ??= new HistoryStore({
        filePath: path.join(this.options.userDataDir, "iab-history.db"),
      });
      return this.history;
    } catch (error) {
      this.log(`the history store could not be opened: ${(error as Error).message}`);
      return null;
    }
  }

  /** The credential store, unlocked on first use. Null when this machine cannot hold one. */
  async credentialStore(): Promise<CredentialStore | null> {
    if (this.credentialsAttempted) return this.credentials;
    this.credentialsAttempted = true;
    if (!this.options.availability.usable) {
      this.log(`saved logins are unavailable: ${this.options.availability.reason}`);
      return null;
    }
    try {
      const store = new CredentialStore({
        filePath: path.join(this.options.userDataDir, "iab-logins.json"),
        safeStorage: this.options.safeStorage,
        availability: this.options.availability,
      });
      await store.unlock();
      this.credentials = store;
      return store;
    } catch (error) {
      this.log(`the saved-logins store could not be opened: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * What the dialog lists.
   *
   * Counting opens each profile's database read-only; it does **not** decrypt, so this never
   * prompts for a keychain secret. That is what lets the dialog show "65" beside a checkbox the
   * person has not yet agreed to.
   */
  async listSources(): Promise<ImportSourcesReport> {
    // Discovery is synchronous and the two things it cannot answer for itself — is the browser
    // running, and how many rows are in each file — are asynchronous. So it runs once to find the
    // profiles, both questions are answered concurrently, and the counts are filled in afterwards.
    const found = discoverSources({});
    const families = [...new Set(found.sources.map((source) => source.id.split(":")[0] ?? ""))];

    const [runningFlags] = await Promise.all([
      Promise.all(families.map((family) => isBrowserRunning(family))),
      Promise.all(
        found.sources.map(async (source) => {
          const resolved = resolveSource(source.id);
          if (resolved === null) return;
          await Promise.all(
            source.available.map(async (kind) => {
              source.counts[kind] = await countItems(kindFile(resolved.profileDir, kind), kind);
            }),
          );
        }),
      ),
    ]);

    const running = new Set(families.filter((_family, index) => runningFlags[index] === true));
    const runningBrowsers = [
      ...new Set(
        found.sources
          .filter((source) => running.has(source.id.split(":")[0] ?? ""))
          .map((source) => source.browserLabel),
      ),
    ];

    return {
      sources: found.sources,
      runningBrowsers,
      credentialsAvailable: this.options.availability.usable,
    };
  }

  /** Runs one import. */
  async run(request: { sourceId: string; kinds: ImportKind[] }): Promise<ImportOutcome> {
    const outcome = await runImport(request, {
      session: this.options.session,
      credentials: () => this.credentialStore(),
      history: () => this.historyStore(),
    });
    for (const result of outcome.results) {
      if (result.failure !== null) this.log(`${result.kind}: ${result.failure}`);
      else if (result.skipped > 0) {
        this.log(`${result.kind}: imported ${result.imported}, skipped ${result.skipped}`);
      }
    }
    return outcome;
  }

  dispose(): void {
    this.history?.close();
    this.history = null;
    this.credentials?.lock();
    this.credentials = null;
  }
}
