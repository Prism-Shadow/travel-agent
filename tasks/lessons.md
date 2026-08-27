# Lessons

What was expensive to learn and must not be learned twice. One entry per lesson, stated so it
applies to the next case rather than describing the one that produced it.

This is not the commit log and not the issue list. Git history records **what changed**;
`docs/issues/` records **what is still broken**; this file records **what to do differently**. A
lesson that is really an open defect belongs in `docs/issues/` with a link from here. The full
narrative of an expensive failure belongs in `docs/postmortem/`: the lesson stays one sentence
here and links its postmortem, so the next agent meets the warning first and the story only when
needed.

## Product and behaviour

- Registering an `uncaughtException` listener suppresses Node's default fatal handling for as
  long as it stays attached: a handler that defers a rethrow re-enters itself forever — record
  once, detach, then rethrow, and cap any file a failure path appends to
  ([postmortem 0002](../docs/postmortem/0002-popup-adoption-crash-storm.md)).

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
- Login-shell startup chatter is model-visible tool output: `bash -lc` sources the user's profile
  into the command's own pipes, and the measured emitter (nvm's die-on-prefix warning) has no env
  knob to silence it — keep chatter out structurally (per-stream start markers relying on FIFO pipe
  order, failing open on exit), not by env hardening or output pattern matching.
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
  can see. Use `packageRoot()` / `distPath()` from `browser-cli/src/shared/package-paths.ts`. When
  sweeping for stale deep paths after a move, grep **both spellings** — the package name
  (`penguin-browser/dist/`) and the directory name (`browser-cli/dist/`): the 08-19 regrouping
  sweep used only the first and missed the desktop e2e harness, which then broke CI.
- **A cancelled batch-push CI run validates nothing.** Commits accumulated locally and pushed
  together get one run for the head commit; if a follow-up push auto-cancels it, every commit in
  the batch lands unverified and the next completed run blames whoever pushed last. After a
  cancelled run, check what it was supposed to cover.
- **Injected workspace dependencies share file contents, not directory structure.**
  `injectWorkspacePackages` gives a consumer a hard-linked copy, so editing a file propagates
  instantly (same inode) while adding, renaming, moving or deleting one does not — and the re-sync
  runs only after the injected package's `build` **succeeds**. Never put a consumer of the copy
  inside the producer's own build: that gates the sync on a build that needs the sync, and the
  resulting deadlock cost half an hour per layout change until the nesting was dissolved. A workspace dependency cycle — even a devDependency carrying one type
  import — disables pnpm's build ordering for the pair entirely (they build in parallel), so keep
  shared contract types on the side the production edge points to. If a copy is somehow stale
  anyway: `rm -f node_modules/.pnpm-workspace-state-v1.json && pnpm install`.
- **Express a compiler rule as a directory, not a list of filenames.** The three page-context
  bundles were excluded from `browser-cli`'s `tsc` by name; moving them broke the exclusion silently
  and pulled DOM-using files into a compilation with no `dom` lib. `src/client/**` says the same
  thing and survives the next move.
- **Check where a config's blast radius ends before trusting it.** `tsconfig.json` with
  `include: ["src"]` compiles *everything* under `src` — 44 test files were being emitted into
  `dist/` and published with the package (`files` lists both `dist` and `src`). Tests belong outside
  the emitted root, with a separate no-emit project so they stay type-checked.

- **Deleting a document is not finished at the doc tree.** Its citations live on in source
  comments, in user-facing strings, and in tests — one test asserted a denial reason matches
  `/003/`, pinning the citation itself. A deletion sweep greps for the path, every shorthand form
  (`design/003`, bare `003 §4.4`), and the section mark, across code and tests — and expects
  non-UTF-8 files to hide from text grep (two did; byte-level patch).
- **tsserver auto-loads only files named `tsconfig.json`, walking up until one _includes_ the open
  file.** `tsconfig.test.json` is invisible to editors, so browser-cli tests fell through to the
  repo root config, whose harness baseline (Bundler, no DOM, no chrome types,
  `noUncheckedIndexedAccess`) manufactured ~150 phantom diagnostics while every CI gate stayed
  green. The root `tsconfig.json` is therefore a solution-style router (`files: []` + references to
  every per-package config, test configs included); a file checked by a config not named
  `tsconfig.json` must have that config referenced there, or editors will invent a project for it.

## Testing and verification

- A double that accepts fewer arguments than the real caller passes tests a world that cannot
  express the bug: when the platform hands your callback an object (Electron's `createWindow`
  gets `options.webContents`), the fake must hand it over too
  ([postmortem 0002](../docs/postmortem/0002-popup-adoption-crash-storm.md)).

- Exercise the real cold-start boundary when one subsystem creates a bootstrap resource for another.
  Unit coverage for generic `about:blank` reuse did not cover IAB because its bootstrap tab was
  already claimed and its executor took a separate creation branch; a restart-and-first-task smoke
  test must assert the visible tab count as well as the selected backend.
- **Establish the baseline before the change, and clear the cache when you do.** A `composite`
  project answers `tsc` from `tsconfig.tsbuildinfo`, so a "clean" pre-change type check can be a
  cached no-op. Delete the buildinfo when a baseline has to mean something.
- **A suite that fails differently each run cannot answer "did I break this".** Isolate the failing
  file, run it several times, and compare against a recorded baseline before attributing a red run
  to a change — the two `browser-cli` tests that flaked for weeks were measured this way and turned
  out to be test bugs, not product bugs
  ([postmortem 0001](../docs/postmortem/0001-flaky-browser-tests.md)).
- **A timer is not a way to express a state.** "Still in flight", "already settled" and "not yet
  replaced" are conditions, and a delay only makes them true while the machine is fast enough. Hold
  the condition open with a gate the test releases, or wait for the terminal state — both flaky
  browser tests were a timer standing in for a state, in two different disguises.
- **Prove the class, not the instance.** When a static search says a file is unused, confirm it
  covers dynamic `import()` too — two `browser-cli` modules looked dead and are lazily imported by
  `cli.ts` on purpose, so that `--help` works without browser dependencies installed.
- **Run every package's suite, not the ones the change looks like it touched.** Adding one
  built-in skill turned three `packages/server` skill-API assertions red while `packages/skills`
  and `packages/web` stayed green: the library's contents are asserted by name in more than one
  package. The full run costs a couple of minutes and is the only thing that answers "what else
  believed the old shape".
- **Read what the agent actually received.** A prompt mechanism can be fully wired, fully typed
  and fully tested and still deliver nothing: the trip-folder line was composed from a trip that
  did not exist yet at compose time, so it was silently absent from every real message, and the
  skill depending on it never ran. The trace file holds the message as sent — open it before
  believing a prompt feature works.
- **A class name that does not exist fails silently.** `prose-chat` styled nothing; markdown
  rendered flat for a whole phase. CSS has no compiler to tell you, so grep the stylesheet for a
  class before using it, and look at the page once.
- **A test that supplies what the UI never supplies proves nothing about the product.** Trip
  folders were designed to be named for the destination, and the unit test passed one in at
  creation — but the flow created the trip *before* asking, so every real folder got the
  `trip-<date>` fallback. The function was right and the product was wrong, and only clicking it
  showed that. When a test constructs the input, ask which caller constructs it that way.
- **Create the heavy object when the commitment happens, not when the button is clicked.** A
  Trip is a row, a directory and files; hanging that on a click produced junk from every
  abandoned click, and left the object unnamed because nothing was known yet. The conversation
  had it right all along — the Session is created by the first message — and the answer was to
  copy that shape rather than invent one.
- **Rolling back a create must undo everything the create made.** Deleting the trip row on a
  failed send left its directory orphaned, which moved the junk rather than removing it. The rule
  that made it safe: clean up only what we ourselves wrote (a folder holding nothing but the
  app's own `trip.json`), and never touch a folder with anything else in it.
- **Two rows created in the same millisecond need a tiebreak that means something.** A list
  ordered `created_at DESC, <id> DESC` shuffles between reads when the id is random — the sidebar
  showed trips in a different order each refresh. Break the tie on insertion order (SQLite's
  `rowid`), and write the test that creates the two rows back to back, because one that spaces
  them apart never sees it. A single green run does not prove ordering: run it five times.
