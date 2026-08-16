/**
 * Versioned on-disk documents, migrated forward and read safely after a rollback (004 Phase 6).
 *
 * The Beta channel means two schema versions of the app now meet the same `userData`: a person on
 * beta writes a vault or a tab-checkpoint file, then rolls back to stable, and stable has to make
 * sense of it — or refuse it cleanly, never silently drop it. Until now each format only checked for
 * *its own exact* version and treated anything else as "unreadable" (the checkpoint dropped the
 * tabs; the vault refused to start). That is right for a genuinely incompatible file and wrong for
 * a merely newer one whose changes were additive.
 *
 * So every versioned document carries two numbers:
 *
 * - **`version`** — the schema it was written at.
 * - **`compat`** — the *oldest* app schema-version that can still read it. An additive change keeps
 *   `compat` where it was (old apps can ignore the new fields); a breaking change raises it.
 *
 * From those, four cases, and this module is the one place that decides them:
 *
 * | file.version vs this app's `current` | outcome |
 * | --- | --- |
 * | equal | read as-is |
 * | older | migrate forward through the registered steps, then read |
 * | newer, `file.compat ≤ current` | read as-is, ignoring fields this app does not know (rollback) |
 * | newer, `file.compat > current` | **refuse** — the file needs an app this old cannot be |
 *
 * Pure and dependency-free — no filesystem, no Electron — so the decision table and every migration
 * step are unit-tested directly, and the stores (`tab-lifecycle.ts`, the vault) call into it.
 */

/** The two numbers every migratable document carries. */
export interface VersionedDocument {
  version: number;
  /** Oldest app schema-version that can still read this file. Absent ⇒ only its own `version`. */
  compat?: number;
}

/** One forward step: turns a document at version `to - 1` into one at version `to`. */
export interface Migration {
  readonly to: number;
  up(doc: Record<string, unknown>): Record<string, unknown>;
}

/** A registered document kind: its current schema, its rollback floor, and how to move forward. */
export interface SchemaKind {
  name: string;
  /** The version this app writes and reads natively. */
  current: number;
  /**
   * The value stamped as `compat` when this app writes a file — the oldest app schema-version that
   * can still read what we write today. Keep it at the last version that changed the format
   * incompatibly; raise it only when a change stops older apps from reading the file.
   */
  compat: number;
  /** Forward steps, one per version increment. Need not be sorted; this module orders them. */
  migrations: Migration[];
}

/** The file is at a version this app cannot reach — too old to migrate, or too new to read. */
export class SchemaVersionError extends Error {
  override readonly name = "SchemaVersionError";
  readonly kind: string;
  readonly fileVersion: number | null;
  constructor(kind: string, fileVersion: number | null, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.fileVersion = fileVersion;
  }
}

export interface OpenOutcome<T> {
  doc: T;
  /** True when forward migrations ran — the caller should persist the upgraded form. */
  migrated: boolean;
  /** True when a newer-but-compatible file was read down-level (a rollback). */
  downlevel: boolean;
}

function versionOf(parsed: unknown, kind: SchemaKind): number {
  if (!parsed || typeof parsed !== "object") {
    throw new SchemaVersionError(kind.name, null, "not an object");
  }
  const raw = (parsed as Record<string, unknown>).version;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new SchemaVersionError(kind.name, null, `missing or invalid version (${String(raw)})`);
  }
  return raw;
}

/**
 * Reads a parsed document, migrating it forward or accepting a compatible newer one.
 *
 * Throws {@link SchemaVersionError} for a file this app genuinely cannot read — a version below the
 * oldest registered migration, a gap in the migration chain, or a newer file whose `compat` is
 * above what this app can be. The caller decides what a refusal means: the checkpoint drops one
 * restore prompt (an optimisation), the vault refuses to start (a security file). Both are correct;
 * neither should ever be a *silent* loss, which is why this reports rather than returns null.
 */
export function openDocument<T extends VersionedDocument>(
  kind: SchemaKind,
  parsed: unknown,
): OpenOutcome<T> {
  const version = versionOf(parsed, kind);
  const doc = parsed as Record<string, unknown>;

  if (version === kind.current) {
    return { doc: doc as T, migrated: false, downlevel: false };
  }

  if (version > kind.current) {
    const compat = typeof doc.compat === "number" ? doc.compat : version;
    if (compat <= kind.current) {
      // A newer app wrote this and marked it readable this far back. Read what we know; a newer
      // app's extra fields are simply not referenced.
      return { doc: doc as T, migrated: false, downlevel: true };
    }
    throw new SchemaVersionError(
      kind.name,
      version,
      `written by a newer version (v${version}, needs an app at schema ≥ v${compat}); this app ` +
        `reads v${kind.current}. Update the application rather than letting it rewrite the file.`,
    );
  }

  // Older: walk the migration chain from version+1 up to current, refusing on any gap.
  const byTo = new Map(kind.migrations.map((m) => [m.to, m]));
  let migrated = doc;
  for (let target = version + 1; target <= kind.current; target += 1) {
    const step = byTo.get(target);
    if (!step) {
      throw new SchemaVersionError(
        kind.name,
        version,
        `no migration to v${target}; cannot upgrade a v${version} file to v${kind.current}`,
      );
    }
    migrated = step.up(migrated);
  }
  return { doc: { ...migrated, version: kind.current } as T, migrated: true, downlevel: false };
}

/** Stamps a document with this app's current version and its compat floor, for writing. */
export function stampDocument<T extends Record<string, unknown>>(
  kind: SchemaKind,
  doc: T,
): T & VersionedDocument {
  return { ...doc, version: kind.current, compat: kind.compat };
}

// ---------------------------------------------------------------------------
// The registry of real document kinds.
//
// Both are at v1 today, with empty migration chains — the framework is in place before the first
// format change needs it, which is the point (the alternative is retrofitting migration under a
// deadline when a beta user's file will not load). `compat` equals `current`: no format has yet
// made a change an older app could read through, so today a rollback across a version bump refuses
// rather than guesses. The moment a change is additive, its `compat` stays put and rollback starts
// working for it.
// ---------------------------------------------------------------------------

/**
 * The tab-checkpoint schema. `current` is kept in step with `TAB_CHECKPOINT_VERSION` in
 * `tab-lifecycle.ts` by a test, rather than imported, to avoid a cycle (that module imports this).
 */
export const TAB_CHECKPOINT_KIND: SchemaKind = {
  name: "tab-checkpoint",
  current: 1,
  compat: 1,
  migrations: [],
};

export const VAULT_KIND: SchemaKind = {
  name: "profile-vault",
  current: 1,
  compat: 1,
  migrations: [],
};
