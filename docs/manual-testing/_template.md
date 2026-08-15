# Manual test template

Copy one `## MT-…` block per case into `docs/manual-testing/phase-XX-<slug>.md`.

Manual verification never blocks the next phase's code (design/004 §4.1). A phase whose
automated gate is green ships as `code_complete_manual_pending`; these files are the debt
ledger, and `docs/manual-testing/release-acceptance.md` collects them for GA.

## Status machine

```
PENDING → IN_TEST → PASS
                  → FAIL → FIX_COMMITTED → IN_TEST (retest)
any → WAIVED   (major/minor only; needs a reason + lead-agent approval; critical cannot be waived)
```

`PENDING` means nobody has run it. **Never record a case as PASS that was not actually
executed** — an untested case is `PENDING`, and one whose environment could not run it is
`PENDING` with the blocker written into `实测`.

## Severity

| Severity | Meaning |
| --- | --- |
| `critical` | Blocks GA. Data loss, a wrong charge, a security regression, or a core flow that cannot complete. |
| `major` | Ships only with an explicit `WAIVED` record and a follow-up. |
| `minor` | Cosmetic or edge-case; tracked, not gating. |

## Case block

```markdown
## MT-<phase>-<nnn> <title>
- 状态: PENDING | IN_TEST | PASS | FAIL | FIX_COMMITTED | WAIVED
- 严重度: critical | major | minor
- 关联: 002 §x / 003 §y / flag:<name> / 矩阵 M<n>
- 平台: macOS | Windows | Linux(X11) | Linux(Wayland)
- 前置: <what must already be installed, built, running or logged in>
- 步骤:
  1. …
  2. …
- 预期: <the observable result, specific enough that two people would agree>
- 实测: <filled in at test time: commit sha, app version, OS version, what happened>
- 修复: commit <sha>  (only when 状态 was FAIL)
```
