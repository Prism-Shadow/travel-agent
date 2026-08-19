# The healthy reconciliation poll no longer floods the desktop log

`pnpm desktop` printed `[server] GET /api/sessions/browser-tasks 200 0ms` every three seconds,
forever — the desktop task supervisor's reconcile loop, working exactly as designed, burying every
log line that mattered.

- The server's request logger now treats that path as a quiet poll: a healthy tick (status < 400,
  under 250ms) is heartbeat, not information, and is not printed. A failing or stalling tick still
  logs, so the line reappears precisely when it becomes signal.
- The poll itself is untouched: reconciliation against the server is the tab-ownership authority
  (`desktop/src/task-supervisor.ts` states why delivery would be worse), and 3s is its designed
  cadence.
- This edits `packages/server` (pinned baseline) deliberately: one middleware, enumerated quiet
  paths, no behavior change beyond log output. 717 server tests pass.
