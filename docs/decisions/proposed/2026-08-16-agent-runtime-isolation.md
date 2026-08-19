# Agent Note: OS-level isolation of the agent runtime (decision D3)

Status: proposed

OS-level isolation of the agent runtime is the hard prerequisite for enabling real L2/L3 personal
data, live one-time-code fills, and agent-triggered payments. The machinery for those capabilities
is built and gated off; this note owns the unresolved selection decision (D3) that opens the gate.

## Problem

The agent has an unrestricted `bash -lc` via `exec_command`, running as the **same OS user** as
the Electron main process. The main process is therefore not a trust boundary relative to the
agent: it can read `userData` and the vault file, probe the broker socket, read the server's
environment (and thus the broker token), and on some platforms attach a debugger to, or drive,
other same-user processes. The vault's encryption defends a stolen disk and keeps plaintext out of
the model's context, the server, the relay and traces — but not against a hostile process running
as the user. Every gated capability depends on a real boundary below the application.

## Proposal

Select and implement one isolation boundary, after a real prototype on each target platform;
until it is met, the dependent capabilities stay off. Isolation is judged **by attack, not by
feature**: it counts as met only when, with the agent runtime confined, each attack in the
acceptance list below is refused. Passing flips the gate — `vault.l2l3`, `secret_entry.live`,
`payments.execute` may be turned on. Failing any one keeps them off: fail closed, capability not
shipped, never "degrade to plaintext and continue".

## Options under consideration

| Option | Boundary | Cost / UX |
| --- | --- | --- |
| **Separate low-privilege OS user** for agent/server/relay | filesystem ACLs + a UID the main process is not | install-time privilege to create the user; workspace sharing and file ownership need care; lightest runtime cost |
| **Container / sandbox** (e.g. a namespaced child) | kernel namespaces / seccomp | strong and inspectable on Linux; weaker/absent story on macOS and Windows; packaging weight |
| **VM** | hypervisor | strongest; heaviest to install, run and share a workspace across |

The choice interacts with cross-platform support — a Linux-only container story does not cover a
macOS GA — and with the workspace model, so it needs a real prototype on each target platform
before selection.

## Interim stance (what ships until it is met)

- **L1 vault and the hash-chained audit log**: on (they never needed isolation).
- **L2/L3, live secret fill, agent payment**: off, by the dependency chain in
  `packages/core/src/state/feature-flags.ts`, with reasons surfaced in the capability panel.
  Verified by `packages/desktop/test/vault-shell-gating.test.ts` and
  `packages/server/test/capabilities-route.test.ts`.
- **The UI says so**: the un-isolated state is shown in the capability panel, not buried in a doc.
- **The broker's residual is stated honestly**: pre-isolation its token is readable by the agent,
  so its authentication guards against *other* local software, not the agent.

## GA framing

Two honest paths to GA:

1. **GA with L2/L3**: isolation met and the acceptance attacks passed on every shipped platform.
2. **GA without L2/L3 (tier A)**: ship the browser, the L1 vault, the audit log and the
   agent-first payment *pause* (the agent still stops at the payment page; the person completes
   it), with the heavier capabilities explicitly and visibly disabled and this note recorded as
   the reason.

Either is a legitimate GA; enabling the gated capabilities without the isolation is the one thing
every gate in this codebase is built to prevent.

## Alternatives considered

- **Enable the gated capabilities without OS-level isolation.** Rejected outright: the vault's
  encryption does not defend against a same-user hostile process, so the capabilities would rest
  on a boundary that does not exist.
- **Treat protocol-level checks as sufficient.** The broker already refuses missing/forged tokens
  and calls bound to the wrong turn/domain/target — but pre-isolation the token itself is readable
  by the agent, so those checks guard against other local software, not the threat in question.
- **Pick a boundary now, prototype later.** Rejected: the options differ most exactly where
  platforms differ (macOS sandboxing, Windows ACLs, packaging weight), so a paper selection would
  be re-litigated at the first prototype.

## Acceptance criteria

With the agent runtime confined, each of these attacks is **refused**:

- **A1/A2** — the agent's shell cannot read `userData`/the vault file, or reach the OS keychain.
- **A3/A4** — the broker refuses a connection with no/forged token, and a well-formed call bound
  to the wrong turn/domain/target (these already pass at the protocol layer; isolation is what
  makes the token itself unreadable by the agent).
- **A5** — the agent cannot modify the app binary, `node_modules`, or the main-process scripts.
- **A6/A7** — the agent cannot debug the main process or read other processes' memory (`ptrace`,
  `/proc/<pid>/mem`, UI automation).

## Risks

- Per-option costs are recorded in the options table: install-time privilege, packaging weight, or
  hypervisor weight — each is a real install/UX cost on some platform.
- Selection may stall on the prototypes; the tier-A GA path exists so stalling keeps the product
  shippable and honest rather than pressuring the gate open.
