# Issue 0006 — finish the production half: keep login-shell startup chatter out of command output

## Evidence

- The sweep (2026-08-20) closed 0006 at the test level (drain-until-marker); 25/25 pass, re-verified.
- The pollution itself is alive in production: `bash -lc 'echo MARKER'` on this machine puts nvm's
  three-line die-on-prefix warning on stderr — prefixed to **every** model-visible exec_command
  output, and it is imperative text ("Run `nvm use --delete-prefix` …") injected into the context.
- nvm source (`~/.nvm/nvm.sh`): `nvm_auto use` → `nvm use --silent` → `nvm_die_on_prefix` →
  `nvm_err`. `NVM_SILENT` gates only "Now using…"; `--delete-prefix` mutates the user's npmrc.
  **No env knob silences it** — issue 0006's fix direction 2 (env hardening) is a dead end.
- Measured: a `-c` string with a parse error runs nothing (no echos, exit 2, only the stderr
  diagnostic) → any marker scheme must fail open on exit.
- Profile costs ~0.9s on this machine; the command starts after it either way (no timing change).

## Fix (structural, per-stream markers)

- [x] `shell.ts`: `ShellInvocation.style: "posix" | "powershell" | "cmd"` (pwsh spawns
      `-NoProfile`, cmd `/d` — both profile-free; only `-lc` shells source profiles).
- [x] New `startup-chatter.ts`: `newStartupMarker()`, `withStartupMarker(cmd, marker)`
      (`echo m; echo m >&2; <cmd>`, single line so line numbers hold), `StartupChatterGate`
      (hold pre-marker text per stream; FIFO pipe order makes pre-marker = pre-command;
      fail open on flush()/cap; strip the marker's own line ending incl. split CRLF).
- [x] `session.ts`: wrap the spawned string for posix style; gate both streams; flush held
      text on exit/error so parse-error diagnostics are never lost; skip empty chunks.
- [x] Tests: gate units (split marker, split CRLF, cap, flush) + live POSIX integration via a
      chattering PENGUIN_SHELL shim (chatter absent, marker absent, stdout/stderr delivered,
      exit codes preserved, parse-error diagnostic delivered).
- [x] `shell-resolver.test.ts`: pin `style` per scenario; exec-session wake-race comment updated.

## Verify

- [x] `pnpm vitest run` for startup-chatter + shell-resolver + exec-session in core — 53 pass.
- [x] Real-machine probe (temporary test, deleted): full Environment→exec_command on this
      nvm-chattering machine returns exactly `"hello\n"` — no npmrc/nvm text, no marker leak.
- [x] `pnpm typecheck` — all packages green.
- [x] Full core suite — 898 passed / 5 skipped, no regressions.

## Record

- [x] Extend the sweep changelog entry's 0006 section (same day, same issue) + README line.
- [x] lessons.md: chatter is model-visible output; no env knob silences nvm; separate structurally.
