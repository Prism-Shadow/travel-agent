# Phase 6 verification — cross-platform Beta

Phase 6 turns a working app into an installable, self-updating, rollback-safe Beta on three
platforms. Most of it is **release process** — signing, notarization, a real three-OS build matrix,
auto-update升/降 tried on real machines, per-platform IME / clipboard / screen-reader passes — which
is executed with certificates and hardware, not written as code. The one part that *is* a code
deliverable, and the one that makes a rollback safe rather than lossy, is **data migration**: giving
the on-disk `userData` formats a version and a compatibility floor, migrating an older file forward,
and reading a newer file after a rollback when the change was additive. That is what this document
covers as code-complete; the rest is tracked as process and listed in §5.

Companion human half: [`../manual-testing/phase-06-beta.md`](../manual-testing/phase-06-beta.md),
entirely `PENDING`.

---

## 1. The migration framework (`data-migration.ts`)

The Beta channel is the first time two schema versions of the app meet the same `userData`: a person
on beta writes a vault or a tab-checkpoint, rolls back to stable, and stable must make sense of the
file — or refuse it cleanly, never silently drop it. Until now each format checked for its *own
exact* version and treated anything else as unreadable (the checkpoint dropped the tabs; the vault
refused to start). That is right for a genuinely incompatible file and wrong for a merely newer,
additive one.

Every migratable document now carries two numbers: **`version`** (the schema it was written at) and
**`compat`** (the oldest app schema-version that can still read it). From those, one place decides
four cases:

| file.version vs this app's `current` | outcome |
| --- | --- |
| equal | read as-is |
| older | migrate forward through the registered steps, then read |
| newer, `compat ≤ current` | read as-is, ignoring unknown fields (the additive rollback) |
| newer, `compat > current` | refuse — the file needs an app this old cannot be |

The framework is pure and dependency-free, so the decision table and every migration step are
tested directly (`desktop/test/data-migration.test.ts`), against a synthetic multi-version kind so
the migration walk is exercised for real even though the two shipped kinds are still at v1.

## 2. Integration, and what it changes

- **Tab checkpoint** (`tab-lifecycle.ts`): `buildCheckpoint`/`mergeCheckpoints` stamp `version` +
  `compat`; `parseCheckpoint` reads through `openDocument`. Behaviour at v1 is unchanged; the new
  property is that a future *additive* checkpoint written on beta will be read after a rollback
  instead of dropped, and a breaking one is refused (one lost restore prompt, never a failed
  launch). Its 51 existing tests still pass.
- **Vault** (`vault/store.ts`): reads through `openDocument` and stamps `compat` on every write. The
  fail-closed stance for a security file is preserved — a breaking newer vault is refused (tested)
  — while an additive newer vault is now readable after a rollback rather than lost (tested). Its 30
  tests pass, including the two new rollback cases.
- **Drift guard**: a test pins each kind's `current` to the store's own version constant
  (`TAB_CHECKPOINT_VERSION`, `VAULT_FILE_VERSION`), since the constants live in two files to avoid an
  import cycle — if either moves without the other, the test fails.

## 3. The installer-forwarder reference (001 §3 review)

The roadmap flagged removing any `packages/landing` reference from the installer tests as a 001 §3
leftover. On inspection it is **not** a leftover: `packages/landing/public/install.sh` is a 4.7 KB
*forwarder* (the root `install.sh` is the 20 KB real installer), and `scripts/test-installer.sh`
runs it deliberately in the `forwarder-oss` case to verify it hides the OSS mirror URL from normal
output. Deleting the reference would drop real coverage of a shipped artifact, so it is left in
place and recorded here as reviewed rather than removed.

---

## 4. Test coverage

| Suite | Covers |
| --- | --- |
| `desktop/test/data-migration.test.ts` | The four decision cases; a full forward-migration walk and a partial one; a chain gap refused; a newer-compatible read and a newer-incompatible / no-compat refusal; invalid version refusal; stamp round-trip; the version-constant drift guard |
| `desktop/test/vault-store.test.ts` | (extended) a breaking newer vault refused; an additive newer vault read after rollback with its values intact |
| `desktop/test/tab-lifecycle.test.ts` | (unchanged, still green) checkpoint build/parse/merge through the stamped format |

**Counts at this commit:**

| Gate | Result |
| --- | --- |
| desktop | 722 passed (722) |
| core / server / transaction / travel-domain / web | unchanged from Phase 5 (891/5skip · 717 · 143 · 59 · 765) |
| typecheck (all packages) | clean |
| build (all packages) | clean |
| `pnpm format:check` | clean |
| debug-switch guard | clean (665 source files) |

## 5. Explicit non-goals (release process, not code)

Each needs certificates, real machines or real users, and is executed in the release workflow — not
written here. None is a stub.

1. **Signing and notarization.** macOS signing/notarization chain is in `desktop-build.yml`/
   `release.yml` (carried from the 001 baseline); Windows code-signing certificate integration and
   the Linux AppImage/deb review are outstanding infrastructure tasks (§6 of the roadmap).
2. **Auto-update up/down, tried for real.** `updater.ts` + electron-updater exist; testing an actual
   upgrade and rollback, and standing up beta/stable channels, needs published releases and target
   machines.
3. **The three-OS build matrix green, and Beta distribution.** Real runners with the signing
   secrets.
4. **M10/M11/M12 per-platform verification** — Chinese IME, clipboard, file upload, screen readers —
   are manual, real-hardware passes (see the manual plan).
5. **The security track's isolation** (Phase 5) remains the gate for enabling L2/L3 and payments,
   unchanged; see [`isolation.md`](./isolation.md).

## 6. Known limitations

- **The migration chains are empty (both kinds at v1).** The framework, the stamping and the
  rollback reads are complete and tested, but no real forward-migration step exists yet because no
  format has changed since v1. The first format change adds its `up` step and (if breaking) raises
  its `compat`; the synthetic-kind tests prove the walk works when it does.
- **`compat === current` for both kinds today**, so a rollback *across the next version bump* will
  refuse until that bump is deliberately marked additive. That is the safe default (refuse, do not
  guess); it becomes a working down-level read the moment a change sets `compat` below `current`.
