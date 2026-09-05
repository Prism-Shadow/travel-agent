# Desktop-owned browser relay and extension pairing

## Problem and evidence

A detached CLI relay can retain port 19989 before Desktop starts. Desktop then owns a different
relay, while the extension still connects to 19989. The UI correctly refuses that unreachable
backend, but ordinary users cannot recover without managing processes. CLI auto-start and request
resolution also consult different endpoint sources.

## Implementation plan

1. Give Desktop a private, OS-assigned relay endpoint and per-launch identity. Publish an
   installation-scoped, owner-only discovery record after the relay is ready; remove only the
   matching record on shutdown. Preserve the separate IAB key and payment/executor boundary.
2. Provide a small Native Messaging host using a restricted Electron entry (no RunAsNode fuse
   changes). Register a user-level Chrome host on Desktop startup, with only Travel Browser's
   extension origin allowed. It discovers live application instances and returns an extension-only
   connection credential; it cannot execute browser commands or start a detached relay.
3. Pair the extension with an installation, persist that choice, and resolve each new connection
   through the native host. Never fall back to the standalone port after a desktop pairing.
   Standalone CLI use remains an explicit mode. Multiple live installations require selection.
4. Unify CLI ensure/status/session/execution discovery. A desktop-scoped invocation may not spawn,
   replace or kill a relay. Honor configured standalone ports consistently.
5. Make readiness observable, preserve tab authorization and browser selection, and reconnect the
   transport without replaying interrupted commands. Package both extension variants and the host.
6. Update owning specs and operational docs, then verify unit/integration suites, typecheck, builds,
   native-host framing/authentication, real Chrome discovery, occupied-port startup, restarts and
   no-fallback behavior. Use isolated QA profiles and data; do not stop the user's existing relays.

## Constraints

- The engine packages remain unchanged.
- Credentials never appear in argv, logs, public status, or webpage content.
- Existing-tab authorization and per-conversation backend choice remain separate.
- Browser control continues through the current relay/executor and unconditional payment gate.
- OS registration is per user, repairs moved application paths on next start, and removal only
  touches entries owned by this installation.

## Progress

- Implemented private relay allocation, authenticated native discovery, persisted application
  pairing, explicit standalone mode, unified CLI resolution, and live availability updates.
- Desktop-scoped environments strip inherited host overrides and browser credentials. A failed
  relay startup stays scoped/unavailable. External dev-server conversations with a saved browser
  choice also refuse standalone replacement when Desktop disappears.
- Both extension variants default to Desktop pairing; the release is 0.0.108 and relay/CLI is
  0.4.1. The welcome page links to bilingual Connection settings. Owning specs, architecture,
  permission documentation, README translations and the built-in browser guide are updated.
- Verification: workspace build, typecheck, format check, debug-switch guard, browser-cli suite
  (599 passed, one existing recording test skipped), extension suite (15 passed), Desktop suite
  (877 passed), existing IAB e2e and real Chromium/native-host pairing e2e passed on macOS.
- Native e2e covers Chrome-before-app startup, occupied standalone port, tab authorization,
  application restart, extension worker restart, and refused replacement from both embedded and
  external dev-server tasks, including stale inherited ports in long-lived external servers.
  Unit checks cover multiple applications, stale credentials/ports,
  manifest repair/removal ownership and invalid native messages. The Desktop e2e command includes
  this regression suite, with Xvfb support on headless Linux.
- The staging command (`pnpm --filter @prismshadow/penguin-desktop run stage`) passed. A normal
  Electron native host with the production security fuses passed on a separate macOS app copy.
  The initial copy experiment exposed a symlink-copy hazard; the local runtime was restored from
  the cached distribution and the full Desktop checks passed again. See tasks/lessons.md.
- Windows/Linux registrations have unit/path coverage; real OS native-host execution is verified
  on macOS only. No installer was published and no push was performed.
- The updated development Desktop is running against the existing server on localhost:7468,
  with a verified private relay and registered native helper. The existing Playwriter and detached
  standalone relay were retained. The user's Chrome extension still needs one reload to activate
  the new files and permission; both build directories contain release 0.0.108.
