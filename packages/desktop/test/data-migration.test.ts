/**
 * The versioned-document migration framework (004 Phase 6).
 *
 * The four cases from the module's own table are each exercised — same, older, newer-compatible,
 * newer-incompatible — plus the two ways a migration can be impossible (a gap in the chain, a
 * version too old). Because the real document kinds are still at v1 with empty chains, the
 * interesting migration behaviour is proven against a synthetic multi-version kind, so the framework
 * is trusted before the first real format change relies on it. The real kinds get their own small
 * checks: they are registered, self-consistent, and round-trip through stamping.
 */
import { describe, expect, it } from "vitest";

import {
  openDocument,
  stampDocument,
  SchemaVersionError,
  TAB_CHECKPOINT_KIND,
  VAULT_KIND,
  type Migration,
  type SchemaKind,
} from "../src/data-migration.js";
import { TAB_CHECKPOINT_VERSION } from "../src/tab-lifecycle.js";
import { VAULT_FILE_VERSION } from "../src/vault/store.js";

/** A synthetic kind at v3: v1 gained a field, v2 renamed one. Lets the chain be tested for real. */
function widgetKind(overrides: Partial<SchemaKind> = {}): SchemaKind {
  const migrations: Migration[] = [
    { to: 2, up: (doc) => ({ ...doc, addedInV2: "default" }) },
    { to: 3, up: (doc) => ({ ...doc, renamed: doc.oldName, oldName: undefined }) },
  ];
  return { name: "widget", current: 3, compat: 1, migrations, ...overrides };
}

describe("reading a document at this app's version", () => {
  it("returns it as-is, unmigrated", () => {
    const out = openDocument(widgetKind(), { version: 3, renamed: "x" });
    expect(out).toMatchObject({ migrated: false, downlevel: false });
    expect(out.doc).toMatchObject({ version: 3, renamed: "x" });
  });
});

describe("migrating an older document forward", () => {
  it("walks every step from the file's version to current", () => {
    const out = openDocument(widgetKind(), { version: 1, oldName: "hello" });
    expect(out.migrated).toBe(true);
    expect(out.doc).toMatchObject({ version: 3, addedInV2: "default", renamed: "hello" });
    expect((out.doc as unknown as Record<string, unknown>).oldName).toBeUndefined();
  });

  it("runs only the steps it needs from a mid-chain version", () => {
    const out = openDocument(widgetKind(), { version: 2, oldName: "hi", addedInV2: "kept" });
    expect(out.migrated).toBe(true);
    expect(out.doc).toMatchObject({ version: 3, addedInV2: "kept", renamed: "hi" });
  });

  it("refuses when the chain has a gap it cannot cross", () => {
    // current 3 but only a 3→ step present: a v1 file cannot reach v3.
    const gappy = widgetKind({ migrations: [{ to: 3, up: (d) => d }] });
    expect(() => openDocument(gappy, { version: 1 })).toThrow(SchemaVersionError);
    expect(() => openDocument(gappy, { version: 1 })).toThrow(/no migration to v2/);
  });
});

describe("reading a newer document after a rollback", () => {
  it("reads a newer-but-compatible file, ignoring fields it does not know", () => {
    // A v4 file that says it is readable back to v2; this app is at v3, so it reads it.
    const out = openDocument(widgetKind(), {
      version: 4,
      compat: 2,
      renamed: "x",
      addedInV4: "ignored-by-this-app",
    });
    expect(out).toMatchObject({ migrated: false, downlevel: true });
    expect(out.doc).toMatchObject({ renamed: "x" });
  });

  it("refuses a newer file whose compat floor is above this app", () => {
    // A v4 file from a breaking change: it needs an app at schema ≥ v4, and this one is v3.
    expect(() => openDocument(widgetKind(), { version: 4, compat: 4 })).toThrow(SchemaVersionError);
    expect(() => openDocument(widgetKind(), { version: 4, compat: 4 })).toThrow(/newer version/);
  });

  it("treats a newer file with no compat field as needing its own version — refuses", () => {
    // No compat means "only an app at my version can read me"; the safe reading of silence.
    expect(() => openDocument(widgetKind(), { version: 4, renamed: "x" })).toThrow(
      SchemaVersionError,
    );
  });
});

describe("refusing an unreadable file rather than guessing", () => {
  it("refuses a non-object, a missing version, and a nonsense version", () => {
    for (const bad of [null, "str", 42, {}, { version: 0 }, { version: -1 }, { version: 1.5 }]) {
      expect(() => openDocument(widgetKind(), bad)).toThrow(SchemaVersionError);
    }
  });
});

describe("stamping a document for writing", () => {
  it("sets the current version and the compat floor", () => {
    const stamped = stampDocument(widgetKind(), { renamed: "x" });
    expect(stamped).toEqual({ renamed: "x", version: 3, compat: 1 });
  });

  it("round-trips: a freshly stamped document reads back as current, unmigrated", () => {
    const kind = widgetKind();
    const out = openDocument(kind, stampDocument(kind, { renamed: "x" }));
    expect(out).toMatchObject({ migrated: false, downlevel: false });
  });
});

describe("the registered real kinds", () => {
  it("are self-consistent: compat ≤ current, and the chain reaches current", () => {
    for (const kind of [TAB_CHECKPOINT_KIND, VAULT_KIND]) {
      expect(kind.compat).toBeLessThanOrEqual(kind.current);
      // Every version from compat+1..current must have a migration (empty chain is fine at v1).
      const targets = new Set(kind.migrations.map((m) => m.to));
      for (let v = kind.compat + 1; v <= kind.current; v += 1) {
        expect(targets.has(v)).toBe(true);
      }
    }
  });

  it("round-trip a current-version document unchanged", () => {
    const out = openDocument(TAB_CHECKPOINT_KIND, { version: 1, tabs: [] });
    expect(out).toMatchObject({ migrated: false, downlevel: false });
    expect(out.doc).toMatchObject({ version: 1, tabs: [] });
  });

  it("keeps each kind's current version in step with the store's own constant", () => {
    // The stores keep their own version constant; a test rather than an import breaks the cycle
    // (both stores import this module). If either constant moves, this fails loudly.
    expect(TAB_CHECKPOINT_KIND.current).toBe(TAB_CHECKPOINT_VERSION);
    expect(VAULT_KIND.current).toBe(VAULT_FILE_VERSION);
  });
});
