# Quiet, persistent Chrome discovery helper

## Evidence

The extension's disconnected maintenance loop resolves its paired Desktop every three seconds.
`nativeRequest` uses `sendNativeMessage`, so every discovery request starts another normal Electron
process. The restricted entry skips the application UI but does not change macOS activation policy.
Even an absent Desktop therefore produces repeated application launches in the Dock.

## Plan

1. Keep one Native Messaging port in the extension worker. Serialize requests over the existing
   ordered protocol; a missing Desktop is a normal response, not a reason to restart the helper.
2. On a broken or timed-out native transport, discard it and use bounded exponential retry backoff.
   Never reuse late responses or switch application/backend as a recovery action.
3. Set the helper's macOS activation policy to prohibited synchronously at entry, before loading
   discovery code or awaiting readiness. Keep the normal application's Dock behavior and security
   fuses unchanged.
4. Add regression coverage for repeated discovery, concurrent requests, native disconnects/timeouts,
   and real Chrome-before-Desktop/restart behavior. Observe the real helper's process count and
   macOS activation policy during several retry intervals, using isolated profiles and data.
5. Update the owning module specs and pairing architecture; run affected tests, builds, workspace
   typecheck and the debug-switch guard. Preserve unrelated development processes and user tabs.

## Verification

- Implemented one persistent, serialized native port, timeout/disconnect invalidation and
  three-second-to-one-minute exponential backoff. Discovery replies retain the existing protocol
  and resolve the paired installation afresh. The restricted Electron entry sets macOS activation
  policy synchronously; no launcher, fuse, backend or browser authorization contract changed.
- Extension unit suite: 20 passed, including 60 seconds of simulated absent-Desktop polling with
  one helper, concurrent discovery requests, transport failures/backoff, disconnects, timeouts and
  late replies. Desktop unit suite: 882 passed.
- Real Chrome/native pairing e2e passed on macOS. Launch counts remained at one during ten seconds
  of Chrome-before-Desktop polling and stayed unchanged through another ten seconds after Desktop
  exit, and through restart. AppKit reported the real helper's activation policy as prohibited.
  Existing tab authorization, occupied standalone port, stale endpoint refusal and extension
  worker restart checks also passed. No native helper remained after test Chrome exited.
- IAB e2e passed. Workspace `pnpm typecheck`, `pnpm format:check`, Desktop debug-switch guard,
  Desktop build and both extension builds passed. Extension test types were rechecked after the
  final fixture adjustment. The existing CJS `import.meta` build warnings remain; the Electron
  application uses its ESM entry.
- The locally registered launcher already points to this checkout's rebuilt Desktop entry. Both
  `dist` and `dist-packaged` contain the updated extension. A loaded unpacked extension needs a
  Chrome reload to pick up the persistent transport. No user browser profile was changed, no
  production data was touched, and no installer or push was produced.
- Windows/Linux native execution was not exercised on this macOS machine; their protocol paths
  have unit and type coverage, and the Dock policy is macOS-only.
