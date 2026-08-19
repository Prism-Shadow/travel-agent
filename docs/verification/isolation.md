# The isolation verdict (design/003 §0.3, decision point D3)

This is a **decision record**, not an implementation report. design/003 §0.3 makes OS-level
isolation of the agent runtime the hard prerequisite for enabling real L2/L3 personal data, live
one-time-code fills, and agent-triggered payments. Phase 4 built the whole machine for those
capabilities and left them gated off; Phase 5's security track is where that gate is either opened
(isolation met, attacks A1–A7 passed) or kept shut on purpose. It is recorded separately from the
Phase 5 engineering track because it is a selection-and-infrastructure decision with real
cost/UX trade-offs (003 §13-1 names it the phase's main unknown), not a module to merge.

## The threat, restated

The agent has an unrestricted `bash -lc` via `exec_command`, running as the **same OS user** as the
Electron main process (003 §1.1). So today the main process is not a trust boundary relative to the
agent: it can read `userData` and the vault file, probe the broker socket, read the server's
environment (and thus the broker token), and on some platforms attach a debugger to, or drive, other
same-user processes. The vault's encryption defends a stolen disk and keeps plaintext out of the
model's context, the server, the relay and traces — but not against a hostile process running as the
user. That is why every gated capability depends on a real boundary below the application.

## What "met" requires (the A1–A7 acceptance)

Isolation is judged by attack, not by feature (003 §12). It is met only when, with the agent runtime
confined, each of these is **refused**:

- **A1/A2** — the agent's shell cannot read `userData`/the vault file, or reach the OS keychain.
- **A3/A4** — the broker refuses a connection with no/forged token, and a well-formed call bound to
  the wrong turn/domain/target. (These already pass at the protocol layer, Phase 4; isolation is
  what makes the token itself unreadable by the agent.)
- **A5** — the agent cannot modify the app binary, `node_modules`, or the main-process scripts.
- **A6/A7** — the agent cannot debug the main process or read other processes' memory (`ptrace`,
  `/proc/<pid>/mem`, UI automation).

Passing A1–A7 flips the gate: `vault.l2l3`, `secret_entry.live`, `payments.execute` may be turned
on. Failing any one keeps them off — **fail closed, capability not shipped**, never "degrade to
plaintext and continue" (004 §5).

## Options under consideration (D3, not yet decided)

| Option | Boundary | Cost / UX |
| --- | --- | --- |
| **Separate low-privilege OS user** for agent/server/relay | filesystem ACLs + a UID the main process is not | install-time privilege to create the user; workspace sharing and file ownership need care; lightest runtime cost |
| **Container / sandbox** (e.g. a namespaced child) | kernel namespaces / seccomp | strong and inspectable on Linux; weaker/absent story on macOS and Windows; packaging weight |
| **VM** | hypervisor | strongest; heaviest to install, run and share a workspace across |

The choice is not made here. It interacts with cross-platform support (Phase 6) — a Linux-only
container story does not cover a macOS GA — and with the workspace model, so it needs a real
prototype on each target platform before selection.

## The interim stance (what ships until it is met)

- **L1 vault and the hash-chained audit log**: on (they never needed isolation).
- **L2/L3, live secret fill, agent payment**: off, by the dependency chain in `feature-flags.ts`,
  with reasons surfaced in the capability panel (004 §5). Verified by
  `desktop/test/vault-shell-gating.test.ts` and `server/test/capabilities-route.test.ts`.
- **The UI says so**: the un-isolated state is shown, not buried in a doc (003 §0.3's requirement).
- **The broker's residual is stated honestly**: pre-isolation its token is readable by the agent, so
  its authentication guards against *other* local software, not the agent (003 §11.3).

## GA framing

Two honest paths to GA (the tiering in 004 §9):

1. **GA with L2/L3**: requires isolation met and A1–A7 passed on every shipped platform.
2. **GA without L2/L3 (tier A)**: ship the browser, the L1 vault, the audit log and the agent-first
   payment *pause* (the agent still stops at the payment page; the person completes it), with the
   heavier capabilities explicitly and visibly disabled and this verdict recorded as the reason.

Either is a legitimate GA; what is not legitimate is enabling the gated capabilities without the
isolation, which is the one thing every gate in this codebase is built to prevent.

## Status

**Open.** No isolation option is selected or implemented. The gate is shut and enforced; the
decision (D3) and the per-platform prototypes are the outstanding work of Phase 5's security track.
