/**
 * Finding the Chrome profiles on this machine, and naming them the way their owner does.
 *
 * The import dialog's "From" row has to say *"Google Chrome — youhai"*, not *"Profile 3"*. Chrome
 * keeps that mapping in `Local State`, a JSON file at the top of the user-data directory, under
 * `profile.info_cache`: a map from directory name (`Default`, `Profile 1`, …) to the display name
 * and account the person actually sees in their browser. Reading it is the difference between a
 * dialog that identifies the right profile and one that asks the user to guess.
 *
 * Two decisions are worth recording, because both look like unnecessary caution until they bite:
 *
 * - **Nothing here reads a profile's *data*.** Discovery touches `Local State` and `stat`s the
 *   per-profile files to see which data types exist. The SQLite files are opened later, by
 *   `chrome-store.ts`, and only for the types the person ticked. A dialog that had already
 *   decrypted the password database in order to *offer* the checkbox would be doing the sensitive
 *   thing before the consent.
 *
 * - **Every path is built from the OS home directory**, never from anything a renderer sends. The
 *   IPC channel takes a *profile id* that must match one this module discovered; it does not take
 *   a path. A channel that accepted a path would be a "read any SQLite file on the disk and hand
 *   it back decrypted" primitive wearing an import dialog's name.
 *
 * Chromium-family browsers other than Chrome (Edge, Brave, Chromium, Vivaldi) use the same layout
 * and the same encryption, so they are listed here too — the cost is a table row each, and a user
 * with Edge would otherwise be told, wrongly, that they have nothing to import.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A Chromium-family browser this machine might have. */
export interface BrowserFamily {
  /** Stable id used on the wire. Never a path. */
  id: string;
  /** What the person calls it. */
  label: string;
  /**
   * Where its user-data directory lives, per platform, relative to the home directory.
   *
   * A list rather than one path because the same browser has moved between locations (Chromium's
   * Linux directory in particular) and because a Flatpak install sits somewhere else entirely.
   */
  userDataDir: Partial<Record<NodeJS.Platform, string[]>>;
}

/**
 * The browsers worth offering.
 *
 * Ordered by how likely a user of this app is to have their travel logins in one. Chrome first
 * because it is the one the extension backend already targets.
 */
export const BROWSER_FAMILIES: readonly BrowserFamily[] = [
  {
    id: "chrome",
    label: "Google Chrome",
    userDataDir: {
      darwin: ["Library/Application Support/Google/Chrome"],
      linux: [
        ".config/google-chrome",
        ".var/app/com.google.Chrome/config/google-chrome",
        "snap/chromium/common/chromium",
      ],
      win32: ["AppData/Local/Google/Chrome/User Data"],
    },
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    userDataDir: {
      darwin: ["Library/Application Support/Microsoft Edge"],
      linux: [".config/microsoft-edge"],
      win32: ["AppData/Local/Microsoft/Edge/User Data"],
    },
  },
  {
    id: "brave",
    label: "Brave",
    userDataDir: {
      darwin: ["Library/Application Support/BraveSoftware/Brave-Browser"],
      linux: [
        ".config/BraveSoftware/Brave-Browser",
        ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser",
      ],
      win32: ["AppData/Local/BraveSoftware/Brave-Browser/User Data"],
    },
  },
  {
    id: "chromium",
    label: "Chromium",
    userDataDir: {
      darwin: ["Library/Application Support/Chromium"],
      linux: [".config/chromium", ".var/app/org.chromium.Chromium/config/chromium"],
      win32: ["AppData/Local/Chromium/User Data"],
    },
  },
  {
    id: "vivaldi",
    label: "Vivaldi",
    userDataDir: {
      darwin: ["Library/Application Support/Vivaldi"],
      linux: [".config/vivaldi"],
      win32: ["AppData/Local/Vivaldi/User Data"],
    },
  },
];

/** The three things this feature can bring over. Ordered as the dialog lists them. */
export type ImportKind = "passwords" | "cookies" | "history";

export const IMPORT_KINDS: readonly ImportKind[] = ["passwords", "cookies", "history"];

/** The per-profile file each kind lives in, relative to the profile directory. */
const KIND_FILES: Record<ImportKind, string> = {
  passwords: "Login Data",
  cookies: "Cookies",
  history: "History",
};

/**
 * One importable profile, as the dialog needs it.
 *
 * `id` is what travels over IPC. It is `<family>:<directory>` — opaque to the renderer, and
 * resolvable back to a path only by re-running discovery here, which is the point.
 */
export interface ImportSource {
  id: string;
  /** `"Google Chrome"`. */
  browserLabel: string;
  /** `"youhai"` — the profile's own name, absent when Chrome never recorded one. */
  profileLabel: string | null;
  /**
   * Rough count of items per kind, for the `65` next to "Saved passwords".
   *
   * Absent (`null`) when it could not be counted without decrypting or without opening a locked
   * file. The dialog shows the checkbox either way; a missing count is not a missing capability.
   */
  counts: Partial<Record<ImportKind, number | null>>;
  /** Which kinds have a file present at all. A kind absent here is offered as unavailable. */
  available: ImportKind[];
}

/** Everything discovery found, plus the reason it may not be usable yet. */
export interface DiscoveryResult {
  sources: ImportSource[];
  /**
   * Families whose data directory exists but whose browser is running.
   *
   * Not an error: it is the "Close Google Chrome completely before importing" line, and it is per
   * browser because a user with Chrome and Edge should only be asked to close the one they picked.
   */
  runningBrowsers: string[];
}

/** Where a source's files are. Never crosses an IPC boundary. */
export interface ResolvedSource {
  familyId: string;
  /** The browser's user-data directory — the one holding `Local State`. */
  userDataDir: string;
  /** The profile directory inside it. */
  profileDir: string;
}

/**
 * The shape of `Local State` this module reads. Everything is optional: it is another program's
 * file, it changes between Chrome versions, and a missing key must degrade to "no display name"
 * rather than to a thrown error in a dialog.
 */
interface LocalState {
  profile?: {
    info_cache?: Record<string, { name?: unknown; user_name?: unknown; gaia_name?: unknown }>;
  };
  os_crypt?: { encrypted_key?: unknown; app_bound_encrypted_key?: unknown };
}

/** Reads and parses a JSON file, or returns null. Another program's file is never trusted to parse. */
function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function readLocalState(userDataDir: string): LocalStateFacts | null {
  const raw = readJson<LocalState>(path.join(userDataDir, "Local State"));
  if (raw === null) return null;
  const names: Record<string, string> = {};
  for (const [directory, entry] of Object.entries(raw.profile?.info_cache ?? {})) {
    // `name` is what the person typed; `gaia_name` and `user_name` are what the signed-in account
    // says. Preferring the typed one matches what Chrome's own profile switcher shows.
    const label = [entry?.name, entry?.gaia_name, entry?.user_name].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
    );
    if (label !== undefined) names[directory] = label.trim();
  }
  return {
    profileNames: names,
    encryptedKey:
      typeof raw.os_crypt?.encrypted_key === "string" ? raw.os_crypt.encrypted_key : null,
    appBoundKeyPresent: typeof raw.os_crypt?.app_bound_encrypted_key === "string",
  };
}

/** What `Local State` tells us, reduced to the three things anything downstream needs. */
export interface LocalStateFacts {
  /** Directory name → the name the person sees. Missing entries simply have no label. */
  profileNames: Record<string, string>;
  /** Windows/macOS: the browser's own master key, itself encrypted. Base64, `DPAPI`-prefixed. */
  encryptedKey: string | null;
  /**
   * Whether Chrome 127+ App-Bound Encryption is in play on Windows.
   *
   * Recorded rather than acted on here: cookies written under it cannot be decrypted by another
   * application at all, by design, so the honest response is to say the cookies cannot be brought
   * over — not to import an empty set and call it a success.
   */
  appBoundKeyPresent: boolean;
}

function homeDir(): string {
  return os.homedir();
}

/** The user-data directories of one family that actually exist on this machine. */
function userDataDirsFor(family: BrowserFamily, platform: NodeJS.Platform, home: string): string[] {
  const candidates = family.userDataDir[platform] ?? [];
  return candidates
    .map((relative) => path.join(home, relative))
    .filter((directory) => directoryExists(directory));
}

function directoryExists(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * Profile directories inside a user-data directory.
 *
 * Chrome names them `Default` and `Profile N`. Everything else in there — `System Profile`,
 * `Guest Profile`, the component directories — is deliberately excluded: importing from the guest
 * profile would bring over a session the person explicitly asked not to be remembered.
 */
export function profileDirectories(userDataDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(userDataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === "Default" || /^Profile \d+$/.test(name))
    .sort((left, right) => {
      // `Default` first, then Profile 1, 2, … numerically rather than as strings, so Profile 10
      // does not sort between 1 and 2.
      if (left === "Default") return -1;
      if (right === "Default") return 1;
      return Number(left.slice(8)) - Number(right.slice(8));
    });
}

/** Splits an `ImportSource.id` back into its parts, or null if it is not one we produced. */
export function parseSourceId(id: unknown): { familyId: string; profileDir: string } | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 256) return null;
  const separator = id.indexOf(":");
  if (separator <= 0) return null;
  const familyId = id.slice(0, separator);
  const profileDir = id.slice(separator + 1);
  // The profile directory is matched against the fixed shape Chrome uses, not merely sanitised.
  // `..` and absolute paths cannot be expressed by this grammar at all, which is stronger than
  // stripping them.
  if (!/^(Default|Profile \d{1,4})$/.test(profileDir)) return null;
  if (!BROWSER_FAMILIES.some((family) => family.id === familyId)) return null;
  return { familyId, profileDir };
}

/**
 * Turns an id from the renderer back into real paths, or null.
 *
 * Re-runs discovery rather than trusting a cached table: the browser may have been uninstalled, or
 * the profile deleted, between the dialog opening and Import being pressed. Returning null there
 * is correct and the caller reports it; returning a stale path would read a directory that the
 * person believes is gone.
 */
export function resolveSource(
  id: string,
  options: { platform?: NodeJS.Platform; home?: string } = {},
): ResolvedSource | null {
  const parsed = parseSourceId(id);
  if (parsed === null) return null;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homeDir();
  const family = BROWSER_FAMILIES.find((entry) => entry.id === parsed.familyId);
  if (family === undefined) return null;

  for (const userDataDir of userDataDirsFor(family, platform, home)) {
    const profileDir = path.join(userDataDir, parsed.profileDir);
    if (directoryExists(profileDir)) {
      return { familyId: family.id, userDataDir, profileDir };
    }
  }
  return null;
}

/** The absolute path of one kind's file inside a profile. */
export function kindFile(profileDir: string, kind: ImportKind): string {
  return path.join(profileDir, KIND_FILES[kind]);
}

/**
 * Every profile on this machine that has something to import.
 *
 * Never throws: a browser directory that cannot be read is one the dialog does not list, which is
 * the same outcome as not having that browser and a much better one than an import dialog that
 * fails to open.
 */
export function discoverSources(
  options: {
    platform?: NodeJS.Platform;
    home?: string;
    /** Injected so the running-browser check can be tested without a process table. */
    isRunning?: (familyId: string) => boolean;
    /** Injected so counting can be tested without SQLite. */
    countItems?: (file: string, kind: ImportKind) => number | null;
  } = {},
): DiscoveryResult {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homeDir();
  const sources: ImportSource[] = [];
  const runningBrowsers: string[] = [];

  for (const family of BROWSER_FAMILIES) {
    const directories = userDataDirsFor(family, platform, home);
    if (directories.length === 0) continue;

    let familyHasProfiles = false;
    for (const userDataDir of directories) {
      const facts = readLocalState(userDataDir);
      for (const directory of profileDirectories(userDataDir)) {
        const profileDir = path.join(userDataDir, directory);
        const available = IMPORT_KINDS.filter((kind) => fileExists(kindFile(profileDir, kind)));
        if (available.length === 0) continue;
        familyHasProfiles = true;

        const counts: Partial<Record<ImportKind, number | null>> = {};
        for (const kind of available) {
          counts[kind] = options.countItems?.(kindFile(profileDir, kind), kind) ?? null;
        }

        sources.push({
          id: `${family.id}:${directory}`,
          browserLabel: family.label,
          profileLabel: facts?.profileNames[directory] ?? null,
          counts,
          available,
        });
      }
    }

    if (familyHasProfiles && (options.isRunning?.(family.id) ?? false)) {
      runningBrowsers.push(family.label);
    }
  }

  return { sources, runningBrowsers };
}
