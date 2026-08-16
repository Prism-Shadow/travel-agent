# Phase 5 (hardening): the debug-port leak becomes a build failure

design/002 §11.2 names one defect *severe*: a `--remote-debugging-port` (or an inspector switch)
left in the shipped app. That port hands every target in the process — including the window holding
your signed-in session — to any other program on the machine, with no authentication. Phase 0 used
the port on a throwaway branch; nothing until now stopped it, or its equivalents, from coming back.
This turns that from a thing a reviewer might catch into a thing the build refuses to produce.

Two guards, because the leak can happen at two moments:

- **In the source.** A CI step scans every shipped file for a debug switch being *used* — as a
  command-line flag or an `appendSwitch` call — and fails the build if it finds one. It knows the
  difference between using a switch and writing about one: the comment in the in-app browser
  transport that names `--remote-debugging-port` precisely to explain why it is avoided stays clean,
  and so does the browser CLI's help text telling you to open a port on *your own* Chrome for the
  direct-connection backend (that is your browser, and a feature).

- **In the packaged binary.** Even with clean source, an Electron app can be relaunched as a plain
  Node process, or reopened with `--inspect`, unless the security *fuses* are flipped off in the
  binary. The packaging step now flips them (RunAsNode off, the inspector and `NODE_OPTIONS` routes
  off, cookie encryption on) and a following step reads the built binary back and fails the release
  if any fuse is not what it should be — so a build that shipped un-hardened cannot pass quietly.

Neither guard can go green by checking nothing: the source scan reports how many files it read, and
the fuse check treats "found no binary to inspect" as a failure.

## For developers

- `packages/desktop/scripts/security-guards.mjs` holds the pure decision logic (the switch scanner
  and the fuse-state diff), unit-tested in `test/security-guards.test.ts`.
- `check-debug-switches.mjs` runs in ordinary CI (`ci.yml`, both the Ubuntu and Windows jobs);
  `apply-fuses.mjs` is the electron-builder `afterPack` hook and `check-fuses.mjs` verifies the
  result in the packaging workflow (`desktop-build.yml`, inherited by `release.yml`).
- This is the first slice of Phase 5's engineering track. Crash reporting (no values), structured
  log redaction, the observability metrics, and the isolation verdict are still to come.
