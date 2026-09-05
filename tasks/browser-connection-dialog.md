# Chrome connection confirmation

## Plan

- Replace the native connected message with a scoped main-to-renderer notification. Keep
  connection detection and missing-extension setup in the desktop shell.
- Present a compact Travel Browser confirmation in the shared UI, with the Route Penguin mark,
  localized copy, existing-tab authorization guidance, and the standard dialog treatment.
- Dismissal preserves the selected browser and unsent draft. Guard delayed checks against a
  changed conversation, backend, or closed window. Restore keyboard focus on dismissal.
- Verify shell notification behavior, localized keyboard/dismissal behavior, type checking,
  builds, and visual presentation in an existing Playwriter tab.

## Validation

- Workspace `pnpm typecheck` passed; web type checking also passed after the focus refinement.
- Desktop unit tests: 882 passed, including connected/setup/stale-check/closed-window cases.
- Web unit tests: 795 passed. Draft browser e2e: all six passed, including English, Chinese,
  narrow-screen dismissal, keyboard containment and restoration, and preservation of an unsent draft.
- Desktop and web builds passed. Changed source/test formatting checks passed.
- Playwriter reused the existing Chrome tab to preview the real UI with a controlled desktop
  notification bridge; the Chinese confirmation rendered correctly and Continue dismissed it.
  Light and dark screenshots: `artifacts/design-qa/chrome-connected-zh.png` and
  `artifacts/design-qa/chrome-connected-dark.png` (local evidence, not committed).
  The QA bridge was removed after inspection and the original browser preferences restored.
- Started the updated development desktop against the existing development server on port 7468.
