# The test fixture extension moves next to its only consumer

The minimal "foreign extension" fixture leaves `browser-extension/test-fixtures/` for
`browser-cli/test/fixtures/`, ending a cross-package relative path no typecheck could see.

- The fixture is a three-file MV3 extension that plays the role of a third-party extension
  (LastPass-style) injecting `chrome-extension://` iframes, so `relay-navigation.test.ts` can pin
  the relay's handling of restricted iframe targets. It was never part of the product extension —
  its old home under `packages/browser-extension` said otherwise.
- Its only consumer reached it as `path.resolve('../browser-extension/test-fixtures/…')`: a hidden
  coupling that a rename or move of `browser-extension` would have broken silently. The path is now
  package-local.
- Verified by launching the real browser with both extensions loaded: the two restricted-iframe
  tests pass at the new location (the rest of `relay-navigation` is the known-flaky suite of issue
  0003 and was filtered out, not run).
