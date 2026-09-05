# Draft browser selection

## Intended behavior

Desktop drafts offer a browser selector after Budget, defaulting to the in-app browser. Chrome
can be selected before the first message. The choice belongs to the draft, survives reload and
restart, and is persisted under the created Session before its first task starts. An unavailable
Chrome choice remains visible; a running task cannot change backends. Plain web deployments do
not advertise the desktop bridge.

## Implementation plan

1. Reproduce the sidebar collapse report and fix the observed failure without changing navigation.
2. Add a compact selector using the existing dropdown, desktop bridge and draft scope. Disable
   sending while a selection is pending; preserve scope checks during selection and promotion.
3. Persist explicit draft choices through the desktop's existing backend preference store, and
   retain the promotion/rollback contract. Update web/desktop specs and browser setup docs.
4. Verify the affected UI and desktop suites, typecheck and builds. Cover first-send selection,
   a fresh draft default, reload/parked draft continuity, unavailable Chrome, a failed change,
   task locking and sidebar collapse/expand. Use isolated data for browser QA.

## Extension display name

Use Travel Browser for the Chrome tab group, extension manifest, installation page, toolbar,
context menu, connection prompts and extension-specific troubleshooting. Keep the installed
extension key, storage keys, CLI command, protocol and package identities stable. Verify both
newly created groups and an owned group carrying the old title, while preserving user-owned
same-title groups in both windows.

## Verification and remaining observation

- Implemented the pre-send selector, pending-send guard, persisted draft choice, and matching
  Desktop/Web contracts and setup instructions.
- Implemented Travel Browser display naming; the manifest key, version and permission list match
  the existing installation in both `dist` and `dist-packaged` builds.
- `pnpm build`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass. The workspace suites
  report 3,913 passing tests and six existing skipped tests.
- The targeted Web browser run passes all five cases: first-send Chrome selection, pending/failed
  selection, unavailable/locked/keyboard behavior, plain Web absence, and collapsed sidebar layout.
- `pnpm --filter @prismshadow/penguin-desktop test:e2e` passes all native browser assertions.
- Real Chromium tab-group coverage verifies the manifest name, separate extension-owned groups
  per window, repair of an owned legacy title, and preservation of user groups with both names.
- Native Desktop QA verifies the selector in Chinese and sidebar widths 324 → 54 → 324. With
  an IAB page open, native view bounds match the DOM placeholder after each change.
- The existing Chrome QA tab had an `AuthProvider` error recorded before reload. Reloading it
  and clicking collapse/expand produces the expected widths and no new page errors. No stable
  sidebar failure is reproduced; the original report still needs its precise trigger before a
  sidebar code change has an evidentiary basis.

Local logs and screenshots are under `artifacts/draft-browser/`. QA uses isolated data; the
native QA instance and its temporary data root are removed. The user's existing Chrome tab is
left expanded. No commit or push is made.
