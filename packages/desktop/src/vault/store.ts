/**
 * The private profile vault: the only place personal data is stored, and the only process that can
 * read it.
 *
 * The file is one JSON document under `userData`, written 0600 with write-then-rename. It holds
 * two keys wrapped by the OS keychain — the master key and the audit key — and, per field, a data
 * key wrapped under the master key plus the value sealed under that data key. Reading one field
 * therefore decrypts exactly one field, and deleting one rewrites nothing else.
 *
 * What this buys and what it does not, stated once so no UI copy has to guess:
 *
 * | Defended | Not defended |
 * | --- | --- |
 * | plaintext reaching the model's context | another process running as the same user (T0) |
 * | plaintext flowing through server, relay or trace | reading `userData` while unlocked, without isolation |
 * | a stolen disk | replacing the application's own code |
 *
 * Five behaviours are deliberate and each one is the opposite of the convenient default:
 *
 * 1. **A vault that cannot be encrypted does not open.** `judgeStorage` decides; a `basic_text`
 *    Linux backend means no vault, not a plaintext one.
 * 2. **L3 cannot be written.** Not "is not written by callers" — `put` refuses, so a CVV has no
 *    path into the file at all (PCI SSC FAQ 1574).
 * 3. **A damaged or unknown-version file refuses to load.** Recreating it would destroy whatever a
 *    person had stored, and skipping the broken part would leave the rest unauthenticated — the
 *    same judgement `journal.ts` makes about a torn line.
 * 4. **Locking is a real operation.** Keys are wiped, cached data keys dropped, and the caller is
 *    told to revoke grants — a lock that only set a boolean would leave the material live.
 * 5. **Every read and write is audited by name, never by value.**
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  generateKey,
  open,
  openText,
  seal,
  unwrapDek,
  wipe,
  wrapDek,
  VaultCryptoError,
  type SealedBox,
} from "./crypto.js";
import { openVaultAudit, type VaultAudit } from "./audit.js";
import { openDocument, stampDocument, VAULT_KIND } from "../data-migration.js";
import type { SafeStoragePort, StorageAvailability } from "./safe-storage.js";
import {
  isNeverPersisted,
  judgeTierChange,
  projectValue,
  specFor,
  tierOf,
  type SensitivityTier,
} from "./tiers.js";

/** Bumped when the on-disk layout changes. An unknown version refuses to load. */
export const VAULT_FILE_VERSION = 1;

export class VaultError extends Error {
  // Typed as `string` rather than as its own literal so the two subclasses below can narrow it;
  // a literal here would make `name` incompatible in every subclass.
  override readonly name: string = "VaultError";
}

/** The file is unreadable, damaged, or from a layout this build does not know. */
export class VaultCorruptError extends VaultError {
  override readonly name = "VaultCorruptError";
}

/** The operation needs an unlocked vault (or a usable keychain) and did not have one. */
export class VaultLockedError extends VaultError {
  override readonly name = "VaultLockedError";
}

interface VaultRecord {
  tier: Exclude<SensitivityTier, "L3">;
  updatedAt: string;
  /** The field's data key, wrapped under the master key. */
  dek: SealedBox;
  /** The value, sealed under that data key, bound to the field name. */
  value: SealedBox;
}

interface VaultFile {
  version: number;
  /** Oldest app schema-version that can still read this vault (004 Phase 6; data-migration.ts). */
  compat?: number;
  createdAt: string;
  updatedAt: string;
  /** Master key, wrapped by the OS keychain, base64. */
  masterKey: string;
  /** Audit HMAC key, wrapped by the OS keychain, base64. */
  auditKey: string;
  /** The audit chain's last MAC, so a deleted or truncated log is detectable. */
  auditTailMac: string;
  fields: Record<string, VaultRecord>;
  /** Per-field reclassifications the person made. L3 never appears here. */
  tierOverrides: Record<string, Exclude<SensitivityTier, "L3">>;
}

export interface FieldSummary {
  field: string;
  label: string;
  tier: SensitivityTier;
  updatedAt: string;
  /** Whether this tier was set by the person rather than by the default table. */
  overridden: boolean;
}

export interface VaultStatus {
  /** Whether this machine may hold a vault at all. */
  storageUsable: boolean;
  /** Why, in one line, for the settings page. */
  storageReason: string;
  remedy: string[];
  exists: boolean;
  unlocked: boolean;
  fields: FieldSummary[];
}

export interface ProfileVaultOptions {
  filePath: string;
  auditPath: string;
  safeStorage: SafeStoragePort;
  /** The fail-closed decision, already made from this machine's facts. */
  availability: StorageAvailability;
  now?: () => Date;
  /**
   * Called when the vault locks, so grants issued against it stop resolving. Separated because the
   * grant table belongs to the session layer, not to storage — but a lock that left grants live
   * would be a lock in name only.
   */
  onLock?: () => void;
}

/**
 * The vault.
 *
 * Constructed locked. `unlock()` creates the file on first use, so nothing is written until
 * somebody actually stores something — a conversation that never books anything leaves no vault
 * behind.
 */
export class ProfileVault {
  private readonly options: ProfileVaultOptions;
  private readonly now: () => Date;
  private file: VaultFile | null = null;
  private masterKey: Buffer | null = null;
  private auditKey: Buffer | null = null;
  private audit: VaultAudit | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(options: ProfileVaultOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  get unlocked(): boolean {
    return this.masterKey !== null;
  }

  /** The audit log, once unlocked. Null before that — its key is sealed with the vault's own. */
  auditLog(): VaultAudit | null {
    return this.audit;
  }

  async status(): Promise<VaultStatus> {
    const exists = await fileExists(this.options.filePath);
    const overrides = this.file?.tierOverrides ?? {};
    return {
      storageUsable: this.options.availability.usable,
      storageReason: this.options.availability.reason,
      remedy: [...this.options.availability.remedy],
      exists,
      unlocked: this.unlocked,
      fields: Object.entries(this.file?.fields ?? {}).map(([field, record]) => ({
        field,
        label: specFor(field)?.label ?? field,
        tier: tierOf(field, overrides),
        updatedAt: record.updatedAt,
        overridden: overrides[field] !== undefined,
      })),
    };
  }

  /**
   * Unlocks, creating the vault on first use.
   *
   * Refuses on a machine where the keychain is unusable, before touching the disk: a vault created
   * there would be one whose "encryption" is a copy of the plaintext.
   */
  async unlock(): Promise<void> {
    if (!this.options.availability.usable) {
      throw new VaultLockedError(this.options.availability.reason);
    }
    if (this.unlocked) return;

    const existing = await this.readFile();
    if (existing) {
      this.file = existing;
      this.masterKey = await this.unwrapWithKeychain(existing.masterKey, "master key");
      this.auditKey = await this.unwrapWithKeychain(existing.auditKey, "audit key");
    } else {
      const masterKey = generateKey();
      const auditKey = generateKey();
      const at = this.now().toISOString();
      this.file = {
        version: VAULT_FILE_VERSION,
        createdAt: at,
        updatedAt: at,
        masterKey: (
          await this.options.safeStorage.encryptString(masterKey.toString("base64"))
        ).toString("base64"),
        auditKey: (
          await this.options.safeStorage.encryptString(auditKey.toString("base64"))
        ).toString("base64"),
        auditTailMac: "",
        fields: {},
        tierOverrides: {},
      };
      this.masterKey = masterKey;
      this.auditKey = auditKey;
      await this.persist();
    }

    this.audit = await openVaultAudit({
      filePath: this.options.auditPath,
      key: () => this.auditKey,
      now: this.now,
    });
    await this.record("unlock");
  }

  /**
   * Locks: writes the audit entry, then wipes every key and cached value.
   *
   * The order matters — the audit entry needs the key it is about to destroy — and the caller's
   * `onLock` is what revokes grants, since a handle that still resolves after a lock would make
   * the lock cosmetic.
   */
  async lock(): Promise<void> {
    if (this.unlocked) await this.record("lock");
    wipe(this.masterKey);
    wipe(this.auditKey);
    this.masterKey = null;
    this.auditKey = null;
    this.audit = null;
    this.file = null;
    this.options.onLock?.();
  }

  /**
   * Stores one value.
   *
   * A fresh data key per write, so rotating a field is the same operation as writing it, and an old
   * ciphertext cannot be opened with the new key.
   */
  async put(field: string, value: string, options: { tier?: SensitivityTier } = {}): Promise<void> {
    const file = this.assertUnlocked();
    if (isNeverPersisted(field)) {
      throw new VaultError(
        `"${field}" is never stored, by construction: a card code, a one-time password or a ` +
          `payment secret is entered by the person each time. This is not a setting.`,
      );
    }
    if (options.tier === "L3") {
      throw new VaultError("L3 is a fixed list, not a tier a value can be filed under.");
    }
    if (typeof value !== "string" || value === "") {
      throw new VaultError(`"${field}" has no value to store. Delete it instead of storing empty.`);
    }

    const tier = (options.tier ?? tierOf(field, file.tierOverrides)) as Exclude<
      SensitivityTier,
      "L3"
    >;
    const dek = generateKey();
    try {
      file.fields[field] = {
        tier,
        updatedAt: this.now().toISOString(),
        dek: wrapDek({ masterKey: this.masterKey!, field, dek }),
        value: seal({ key: dek, field, plaintext: value }),
      };
    } finally {
      wipe(dek);
    }
    if (options.tier && options.tier !== tierOf(field)) file.tierOverrides[field] = tier;
    await this.persist();
    await this.record("tier_changed", { field, outcome: tier });
  }

  /**
   * Reads one value in the clear. **Main process only.**
   *
   * Every caller of this is a place where a plaintext exists in memory; there are two, and both are
   * in this package (`secure-fill.ts` and the payment path). Nothing reachable from the server or
   * the agent may call it.
   */
  async reveal(field: string, context: { reason: string; grantId?: string }): Promise<string> {
    const file = this.assertUnlocked();
    const record = file.fields[field];
    if (!record) throw new VaultError(`Nothing is stored for "${field}".`);
    const dek = unwrapDek({ masterKey: this.masterKey!, field, wrapped: record.dek });
    try {
      const value = openText({ key: dek, field, box: record.value });
      await this.record("field_read", {
        field,
        reason: context.reason,
        ...(context.grantId ? { grantId: context.grantId } : {}),
      });
      return value;
    } finally {
      wipe(dek);
    }
  }

  /** Whether a field is present, without decrypting it. */
  has(field: string): boolean {
    return this.file?.fields[field] !== undefined;
  }

  /**
   * The projection a grant may hand to a model: L1 only, masked where the table says so.
   *
   * L2 fields are silently absent rather than refused — a grant that asked for a mix gets what it
   * is allowed, and the handle machinery covers the rest.
   */
  async project(
    fields: readonly string[],
    options: { full?: readonly string[]; grantId?: string } = {},
  ): Promise<Record<string, string>> {
    const file = this.assertUnlocked();
    const out: Record<string, string> = {};
    const shown: string[] = [];
    for (const field of fields) {
      const record = file.fields[field];
      if (!record) continue;
      const tier = tierOf(field, file.tierOverrides);
      if (tier !== "L1") continue;
      const dek = unwrapDek({ masterKey: this.masterKey!, field, wrapped: record.dek });
      try {
        const value = openText({ key: dek, field, box: record.value });
        const projected = projectValue({
          field,
          value,
          tier,
          full: options.full?.includes(field) === true,
        });
        if (projected !== null) {
          out[field] = projected;
          shown.push(field);
        }
      } finally {
        wipe(dek);
      }
    }
    if (shown.length > 0) {
      await this.record("field_read", {
        fields: shown,
        reason: "projection",
        ...(options.grantId ? { grantId: options.grantId } : {}),
      });
    }
    return out;
  }

  async deleteField(field: string): Promise<boolean> {
    const file = this.assertUnlocked();
    if (!file.fields[field]) return false;
    delete file.fields[field];
    delete file.tierOverrides[field];
    await this.persist();
    await this.record("delete", { field });
    return true;
  }

  /** Removes every value but keeps the vault (and its audit chain) in place. */
  async deleteAll(): Promise<void> {
    const file = this.assertUnlocked();
    const fields = Object.keys(file.fields);
    file.fields = {};
    file.tierOverrides = {};
    await this.persist();
    await this.record("delete", { fields, reason: "all fields" });
  }

  /**
   * Moves a field between tiers.
   *
   * Loosening — L2 to L1 — refuses without `confirmed`, because it is the step that lets a model
   * read an identifier. Anything touching L3 is refused outright.
   */
  async reclassify(
    field: string,
    to: SensitivityTier,
    options: { confirmed?: boolean } = {},
  ): Promise<void> {
    const file = this.assertUnlocked();
    const verdict = judgeTierChange({ field, to, overrides: file.tierOverrides });
    if (!verdict.allowed) throw new VaultError(verdict.reason);
    if (verdict.requiresConfirmation && !options.confirmed) {
      throw new VaultError(
        `Moving "${field}" to L1 lets a model read it. That needs an explicit confirmation, and ` +
          `it is written to the audit log.`,
      );
    }
    const target = to as Exclude<SensitivityTier, "L3">;
    if (target === tierOf(field)) delete file.tierOverrides[field];
    else file.tierOverrides[field] = target;
    const record = file.fields[field];
    if (record) record.tier = target;
    await this.persist();
    await this.record("tier_changed", {
      field,
      reason: `${verdict.from} → ${verdict.to}`,
      outcome: options.confirmed ? "confirmed" : "tightened",
    });
  }

  /**
   * Every stored value in the clear, for an export the person asked for.
   *
   * `reauthenticated` is the OS-level re-authentication the caller performed (Touch ID, Windows
   * Hello, password). It is a parameter rather than something this class performs because the
   * prompt belongs to the shell — but the export refuses without it, so the check cannot be
   * forgotten by a caller that only wanted the data.
   */
  async exportAll(options: { reauthenticated: boolean }): Promise<Record<string, string>> {
    const file = this.assertUnlocked();
    if (!options.reauthenticated) {
      throw new VaultError(
        "An export hands over every stored value at once, so it needs the operating system to " +
          "confirm who is asking. Re-authenticate and try again.",
      );
    }
    const out: Record<string, string> = {};
    for (const field of Object.keys(file.fields)) {
      const record = file.fields[field]!;
      const dek = unwrapDek({ masterKey: this.masterKey!, field, wrapped: record.dek });
      try {
        out[field] = openText({ key: dek, field, box: record.value });
      } finally {
        wipe(dek);
      }
    }
    await this.record("export", { fields: Object.keys(out) });
    return out;
  }

  /**
   * Re-keys the vault: a new master key, every data key rewrapped, values untouched.
   *
   * Values are not re-sealed because their data keys do not change — which is the point of having
   * them. A rotation therefore costs one keychain write and one small rewrap per field, and can be
   * done on a schedule without decrypting anything.
   */
  async rotate(): Promise<void> {
    const file = this.assertUnlocked();
    const nextMaster = generateKey();
    try {
      for (const [field, record] of Object.entries(file.fields)) {
        const dek = unwrapDek({ masterKey: this.masterKey!, field, wrapped: record.dek });
        try {
          record.dek = wrapDek({ masterKey: nextMaster, field, dek });
        } finally {
          wipe(dek);
        }
      }
      file.masterKey = (
        await this.options.safeStorage.encryptString(nextMaster.toString("base64"))
      ).toString("base64");
      wipe(this.masterKey);
      this.masterKey = Buffer.from(nextMaster);
      await this.persist();
      await this.record("tier_changed", { reason: "master key rotated" });
    } finally {
      wipe(nextMaster);
    }
  }

  // -------------------------------------------------------------------------

  private assertUnlocked(): VaultFile {
    if (!this.file || !this.masterKey) {
      throw new VaultLockedError(
        "The vault is locked. Unlock it before reading or writing personal data.",
      );
    }
    return this.file;
  }

  private async record(
    event: Parameters<VaultAudit["append"]>[0],
    details: Parameters<VaultAudit["append"]>[1] = {},
  ): Promise<void> {
    if (!this.audit) return;
    const entry = await this.audit.append(event, details);
    // The tail digest lives in the vault file, which is what makes deleting the log detectable.
    if (this.file && this.file.auditTailMac !== entry.mac) {
      this.file.auditTailMac = entry.mac;
      await this.persist();
    }
  }

  /** The MAC the vault remembers for the audit chain, for the integrity check in settings. */
  auditTailMac(): string {
    return this.file?.auditTailMac ?? "";
  }

  private async unwrapWithKeychain(wrapped: string, what: string): Promise<Buffer> {
    try {
      const plain = await this.options.safeStorage.decryptString(Buffer.from(wrapped, "base64"));
      const key = Buffer.from(plain, "base64");
      if (key.length !== 32) throw new Error("wrong length");
      return key;
    } catch (error) {
      throw new VaultLockedError(
        `The ${what} could not be recovered from this machine's keychain (${
          (error as Error).message
        }). The vault stays locked: this usually means the keychain entry was removed, or the ` +
          `file was copied from another machine. Nothing has been deleted.`,
      );
    }
  }

  private async readFile(): Promise<VaultFile | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.options.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let raw2: unknown;
    try {
      raw2 = JSON.parse(raw);
    } catch (error) {
      throw new VaultCorruptError(
        `${this.options.filePath} is not readable JSON (${(error as Error).message}). Refusing to ` +
          `start a fresh vault over it: that would destroy whatever is in there. Move the file ` +
          `aside deliberately if it really is beyond repair.`,
      );
    }
    // Version handling goes through the migration framework (004 Phase 6): an older vault is
    // migrated forward, a newer-but-compatible one (a rollback across an additive change) is read
    // down-level, and anything else refuses. The refusal is deliberately fail-closed for a security
    // file — the same stance this had before, now with a compat floor so a genuinely readable
    // rollback is not thrown away with the rest.
    let parsed: VaultFile;
    try {
      parsed = openDocument<VaultFile>(VAULT_KIND, raw2).doc;
    } catch (error) {
      throw new VaultCorruptError(
        `${this.options.filePath}: ${(error as Error).message} Upgrade or downgrade the ` +
          `application rather than letting it rewrite the file; nothing has been changed.`,
      );
    }
    if (!parsed.masterKey || !parsed.auditKey || typeof parsed.fields !== "object") {
      throw new VaultCorruptError(
        `${this.options.filePath} is missing the keys it needs to be a vault. Nothing has been ` +
          `changed.`,
      );
    }
    parsed.tierOverrides ??= {};
    return parsed;
  }

  /** Write-then-rename at 0600, serialised so two writes cannot interleave. */
  private async persist(): Promise<void> {
    const file = this.file;
    if (!file) return;
    file.updatedAt = this.now().toISOString();
    // Re-stamp version + compat on every write, so the file always advertises the floor a rollback
    // may read it back to (004 Phase 6).
    const snapshot = JSON.stringify(
      stampDocument(VAULT_KIND, file as unknown as Record<string, unknown>),
      null,
      2,
    );
    const run = this.writes.then(async () => {
      const dir = path.dirname(this.options.filePath);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${this.options.filePath}.tmp`;
      const handle = await fs.open(tmp, "w", 0o600);
      try {
        await handle.write(snapshot);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, this.options.filePath);
      await fs.chmod(this.options.filePath, 0o600);
    });
    this.writes = run.catch(() => undefined);
    await run;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Constructs a vault. It starts locked; nothing is written until `unlock()`. */
export function createProfileVault(options: ProfileVaultOptions): ProfileVault {
  return new ProfileVault(options);
}

export { VaultCryptoError };
