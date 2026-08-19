# Lessons

What was expensive to learn and must not be learned twice. One entry per lesson, stated so it
applies to the next case rather than describing the one that produced it.

This is not the changelog and not the issue list. `changelog/` records **what changed**;
`docs/issues/` records **what is still broken**; this file records **what to do differently**. A
lesson that is really an open defect belongs in `docs/issues/` with a link from here.

## Product and behaviour

- Distinguish a feature being available from it being the default selection. For dual browser
  backends, say explicitly whether Chrome is selectable, whether it is selected by default, and what
  setup is still required.
- When describing product behavior, reconcile product flags, per-conversation state, low-level CLI
  defaults, and Agent instructions. A UI default is not authoritative if a lower layer can silently
  choose another backend.
- Persist cross-process choices before committing UI state, and make failure observable. A swallowed
  write error is a product-state split, not merely a logging issue.
- Backend selection and tab authorization are different scopes: selecting Chrome may authorize
  task-owned tabs, while adopting an existing user tab still needs a gesture on that tab.
- When a product has a no-silent-fallback rule, an unavailable persisted choice must stay visible;
  showing the other backend creates a false state even if the fallback seems helpful.
- An agent-facing default change is not active merely because the source kernel and Skill changed.
  Verify the persisted Agent kernel stamp and installed Skill version too; smart kernel merge
  deliberately preserves customized prompts, so reconcile a stale product-contract sentence narrowly
  instead of resetting unrelated customizations.
- When matching browser chrome, structural correctness is not enough: a real site tab needs its
  favicon, compact title rhythm, subtle selected surface, and native-quality icon controls. Avoid
  shipping text glyphs and a heavy active underline when the visual target is a quiet rounded
  browser tab.
- **A control's scope must match the scope of the state it acts on.** The in-app browser offered
  "the last run left 7 pages open, reopen them?" from inside one conversation, while the count and
  the action covered every conversation — so it announced seven and showed three, and in a new
  conversation it was a button that visibly did nothing. Before adding a control, ask what unit of
  state it owns; if the answer differs from the unit it is rendered in, the mismatch will surface as
  a number the user cannot reconcile.
- **State that belongs to a thing should be restored when that thing is opened, not offered up
  front.** Nobody is asked whether to restore a conversation's messages. Tabs are the same kind of
  state, and treating them that way deleted a prompt, four bookkeeping states (crashed / asked /
  answered / copy-aside-failed), a second checkpoint file and ~250 lines — while serving the original
  design concern better, because opening the conversation is a more precise consent than a global
  yes/no.
- A native surface above the DOM swallows the pointer events a drag needs, so the drag has to hide
  it — and hiding it with nothing in its place is a blank pane, not a fix. Capture the frozen frame
  **before** occluding (capture refuses once the view is hidden), and pin the stand-in the way the
  live view behaves under resize.

## Build, workspace and layout

- **Never compute a package-relative path by counting directories.**
  `path.join(__dirname, '..', 'dist', …)` encodes how deep the asking file sits. Nine files in
  `browser-cli` used it and read as correct for years only because every module sat directly under
  `src/` and every output directly under `dist/`, where `..` meant the package root from both.
  Grouping them one level down turned all nine into `src/dist/…` at runtime, which no type checker
  can see. Use `packageRoot()` / `distPath()` from `browser-cli/src/shared/package-paths.ts`.
- **Injected workspace dependencies share file contents, not directory structure.**
  `injectWorkspacePackages` gives a consumer a hard-linked copy, so editing a file propagates
  instantly (same inode) while adding, renaming, moving or deleting one does not. The re-sync runs
  only after a package's `build` **succeeds**, and `browser-cli`'s build has the extension build
  nested inside it — so a layout change deadlocks: the build that would sync is the build that
  fails. Escape with
  `rm -f node_modules/.pnpm-workspace-state-v1.json && pnpm install`. Measurements:
  [`docs/issues/0005`](../docs/issues/0005-injected-workspace-deps-sync-deadlock.md).
- **Express a compiler rule as a directory, not a list of filenames.** The three page-context
  bundles were excluded from `browser-cli`'s `tsc` by name; moving them broke the exclusion silently
  and pulled DOM-using files into a compilation with no `dom` lib. `src/client/**` says the same
  thing and survives the next move.
- **Check where a config's blast radius ends before trusting it.** `tsconfig.json` with
  `include: ["src"]` compiles *everything* under `src` — 44 test files were being emitted into
  `dist/` and published with the package (`files` lists both `dist` and `src`). Tests belong outside
  the emitted root, with a separate no-emit project so they stay type-checked.

## Testing and verification

- Exercise the real cold-start boundary when one subsystem creates a bootstrap resource for another.
  Unit coverage for generic `about:blank` reuse did not cover IAB because its bootstrap tab was
  already claimed and its executor took a separate creation branch; a restart-and-first-task smoke
  test must assert the visible tab count as well as the selected backend.
- **Establish the baseline before the change, and clear the cache when you do.** A `composite`
  project answers `tsc` from `tsconfig.tsbuildinfo`, so a "clean" pre-change type check can be a
  cached no-op. Delete the buildinfo when a baseline has to mean something.
- **A suite that fails differently each run cannot answer "did I break this".** `browser-cli` has
  two browser-backed tests that fail intermittently ([`docs/issues/0003`](../docs/issues/0003-browser-cli-flaky-browser-tests.md));
  isolate the failing file and compare against the recorded baseline (46 files, 572 passed,
  6 skipped) before attributing it to a change.
- **Prove the class, not the instance.** When a static search says a file is unused, confirm it
  covers dynamic `import()` too — two `browser-cli` modules looked dead and are lazily imported by
  `cli.ts` on purpose, so that `--help` works without browser dependencies installed.
