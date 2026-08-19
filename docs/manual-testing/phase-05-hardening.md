# Phase 5 — manual verification (hardening)

Template and status machine: [`_template.md`](./_template.md). Evidence and automated results:
[`../verification/phase-05.md`](../verification/phase-05.md); the isolation decision:
[`../verification/isolation.md`](../verification/isolation.md).

The automated suites prove the pure logic — that a report carries no values, that a rate withholds
itself on a small sample, that the fuse diff catches a wrong bit. What they cannot prove is the part
that only exists on a real machine: that a crash in each of the three processes actually produces a
report, that the packaged binary really carries the fuses, and that killing the relay or an in-app
view leaves the person with a status rather than a hang.

Every case here is `PENDING`. The isolation attack cases (A1–A7) are listed but cannot pass until
the security track selects and implements an isolation option — they are the acceptance gate for
turning the Phase 4 capabilities on, recorded now so the sequence is fixed.

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| MT-05-001 | A packaged binary carries the security fuses | critical | PENDING |
| MT-05-002 | CI fails the build on a debug switch in source | major | PENDING |
| MT-05-003 | A main-process crash writes a value-free report and re-surfaces | critical | PENDING |
| MT-05-004 | An in-app browser view crash writes a report and rebuilds the tab | critical | PENDING |
| MT-05-005 | The forked server dying writes a utility-layer report | major | PENDING |
| MT-05-006 | A crash report contains no secret, checked by grep | critical | PENDING |
| MT-05-007 | Killing the relay shows a recovering status, then recovers | major | PENDING |
| MT-05-008 | Disconnecting the extension shows a degraded status | major | PENDING |
| MT-05-009 | The metrics endpoint reports the three rates | minor | PENDING |
| MT-05-010 | A1: agent shell cannot read the vault file (needs isolation) | critical | PENDING |
| MT-05-011 | A2: agent cannot reach the OS keychain (needs isolation) | critical | PENDING |
| MT-05-012 | A3/A4: broker refuses forged token / wrong binding | critical | PENDING |
| MT-05-013 | A5: agent cannot modify the app binary (needs isolation) | critical | PENDING |
| MT-05-014 | A6/A7: agent cannot debug main / read other memory (needs isolation) | critical | PENDING |

---

## MT-05-001 A packaged binary carries the security fuses
- 状态: PENDING
- 严重度: critical
- 关联: 002 §11.2 / scripts/apply-fuses.mjs / check-fuses.mjs
- 平台: macOS | Windows | Linux(X11)
- 前置: 一次本地打包（`pnpm --dir packages/desktop exec electron-builder …`）
- 步骤: 1. 打包后运行 `node packages/desktop/scripts/check-fuses.mjs <app 或二进制路径>`。2. 另外尝试 `ELECTRON_RUN_AS_NODE=1 <二进制> -e "console.log(1)"`。
- 预期: check-fuses 报告全部期望 fuse 匹配、退出 0；RunAsNode 关闭使 `ELECTRON_RUN_AS_NODE` 无效。
- 实测: （测试时填写；含 commit sha / OS）
- 修复: —

## MT-05-002 CI fails the build on a debug switch in source
- 状态: PENDING
- 严重度: major
- 关联: 002 §11.2 / scripts/check-debug-switches.mjs
- 平台: 任一
- 前置: 一个临时分支
- 步骤: 1. 在 `packages/desktop/src/*.ts` 里加一行 `app.commandLine.appendSwitch("remote-debugging-port","9222")`。2. 运行 `node packages/desktop/scripts/check-debug-switches.mjs`。3. 撤销。
- 预期: 守卫报告该行并退出 1；撤销后重新干净。
- 实测: —
- 修复: —

## MT-05-003 A main-process crash writes a value-free report and re-surfaces
- 状态: PENDING
- 严重度: critical
- 关联: 003 §4.6 / crash-reporting.ts
- 平台: macOS | Windows | Linux(X11)
- 前置: 开发运行
- 步骤: 1. 在 main 里制造一次 `uncaughtException`。2. 查看 `userData/crash-reports/crashes.jsonl`。
- 预期: 写入一条 `layer:"main"` 记录；异常仍被 Electron/OS 感知（未被吞）；记录内无任何值。
- 实测: —
- 修复: —

## MT-05-004 An in-app browser view crash writes a report and rebuilds the tab
- 状态: PENDING
- 严重度: critical
- 关联: 002 §11.2 / 004 Phase 5
- 平台: macOS | Windows | Linux(X11)
- 前置: 开启 IAB，打开一个页面
- 步骤: 1. 让该视图渲染进程崩溃（如打开一个已知崩溃页或强杀渲染进程）。2. 观察该 tab 与 crashes.jsonl。
- 预期: 写入一条 `layer:"renderer"`、`surface:"in-app browser view"` 记录；仅该 tab 重建，主窗口不受影响。
- 实测: —
- 修复: —

## MT-05-005 The forked server dying writes a utility-layer report
- 状态: PENDING
- 严重度: major
- 关联: 004 Phase 5
- 平台: macOS | Windows | Linux(X11)
- 前置: 开发运行
- 步骤: 1. 强杀 utilityProcess（penguin-server）。2. 查看 crashes.jsonl。
- 预期: 写入一条 `layer:"utility"`、`surface:"penguin-server"` 记录；shell 按既有策略重启服务器。
- 实测: —
- 修复: —

## MT-05-006 A crash report contains no secret, checked by grep
- 状态: PENDING
- 严重度: critical
- 关联: 003 §4.6
- 平台: 任一
- 前置: 已产生若干崩溃记录（可用 dummy 秘密制造）
- 步骤: 1. 故意让一次崩溃的异常信息里含 dummy token / 卡号。2. `grep` crashes.jsonl。
- 预期: 搜不到明文；对应位置为 `[REDACTED:…]`。
- 实测: —
- 修复: —

## MT-05-007 Killing the relay shows a recovering status, then recovers
- 状态: PENDING
- 严重度: major
- 关联: 002 §11.2 / recovery-status.ts
- 平台: macOS | Windows | Linux(X11)
- 前置: IAB 开启、有活动页
- 步骤: 1. 强杀 relay 进程。2. 观察面板状态与随后的恢复。
- 预期: 显示「正在恢复」类可读状态（自动恢复中）；relay 重启后恢复可用。（注：统一状态渲染接线为收尾项，见 verification §8——本用例先验证恢复行为与文案方向。）
- 实测: —
- 修复: —

## MT-05-008 Disconnecting the selected extension reports an interruption
- 状态: PENDING
- 严重度: major
- 关联: recovery-status.ts
- 平台: macOS | Windows | Linux(X11)
- 前置: 使用扩展后端
- 步骤: 1. 断开扩展 / 关闭用户 Chrome。2. 观察状态。
- 预期: 明确显示 Chrome 已断开，当前任务中断并等待重连；不得静默切到 IAB。任务结束后，用户可在 Browser 菜单明确改选 IAB。
- 实测: —
- 修复: —

## MT-05-009 The metrics endpoint reports the three rates
- 状态: PENDING
- 严重度: minor
- 关联: 003 §13 / /api/metrics
- 平台: 任一
- 前置: 登录后
- 步骤: 1. 触发若干卡片（含一次 browser_takeover、一次 secret_entry）。2. GET `/api/metrics`。
- 预期: 返回按 kind 的计数与 takeover/secretPhase 速率；样本不足时 rate 为 null；卡片回退率在自然语言确认接线前为 null（已知限制）。
- 实测: —
- 修复: —

## MT-05-010 A1: agent shell cannot read the vault file (needs isolation)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §0.3 / §12 A1 / isolation.md
- 平台: macOS | Windows | Linux(X11)
- 前置: **隔离方案实施后**方可判为通过；当前记录现状
- 步骤: 1. 让 agent 用 `exec_command` `cat userData/…/profile-vault.json`。
- 预期: 隔离达标后应被拒绝（权限/不可见）。未隔离时属已知残余（T0），如实记录，不判 PASS。
- 实测: —
- 修复: —

## MT-05-011 A2: agent cannot reach the OS keychain (needs isolation)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §12 A2 / isolation.md
- 平台: macOS | Windows | Linux(X11)
- 前置: 同上
- 步骤: 1. 让 agent 尝试 `security find-generic-password` / `secret-tool` / DPAPI。
- 预期: 隔离达标后被拒；未隔离时如实记录。
- 实测: —
- 修复: —

## MT-05-012 A3/A4: broker refuses forged token / wrong binding
- 状态: PENDING
- 严重度: critical
- 关联: 003 §11 / §12 A3/A4
- 平台: macOS | Windows | Linux(X11)
- 前置: IAB + vault 开启（broker 运行）
- 步骤: 1. 无 token / 伪造 token 连接 broker。2. 用错误 taskId/domain/targetId 发合法调用。
- 预期: 均被拒并写审计。此项在协议层已由自动测试覆盖；本用例在真实 socket 上复验。
- 实测: —
- 修复: —

## MT-05-013 A5: agent cannot modify the app binary (needs isolation)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §12 A5 / isolation.md
- 平台: macOS | Windows | Linux(X11)
- 前置: 隔离方案实施后
- 步骤: 1. 让 agent 尝试写应用二进制 / node_modules / 主进程脚本。
- 预期: 隔离达标后被拒（只读/不可见）；未隔离时如实记录。
- 实测: —
- 修复: —

## MT-05-014 A6/A7: agent cannot debug main / read other memory (needs isolation)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §12 A6/A7 / isolation.md
- 平台: macOS | Windows | Linux(X11)
- 前置: 隔离方案实施后
- 步骤: 1. 让 agent 尝试 `ptrace` / 附加调试器 / 读 `/proc/<pid>/mem` / UI 自动化。
- 预期: 隔离达标后被拒；未隔离时如实记录。A1–A7 全通过方可开启 L2/L3 与代付。
- 实测: —
- 修复: —
