# Phase 6 — manual verification (cross-platform Beta)

Template and status machine: [`_template.md`](./_template.md). Evidence and automated results:
[`../verification/phase-06.md`](../verification/phase-06.md).

Almost all of Phase 6 is real-machine work: it only means anything on an actual macOS, Windows and
Linux box, with real signing, a real published release, and a real update/rollback. The automated
suites prove the migration *logic* (an older file upgrades, a newer additive file reads after a
rollback, a breaking one refuses); everything else here is a human with three machines.

Every case is `PENDING`. The install/update/rollback and per-platform IME/accessibility cases can
only be run once a signed Beta is published to the two channels.

| ID | Title | Severity | Platform | Status |
| --- | --- | --- | --- | --- |
| MT-06-001 | Install from a signed artifact, first launch works | critical | mac/win/linux | PENDING |
| MT-06-002 | Auto-update: stable → beta upgrades in place | critical | mac/win/linux | PENDING |
| MT-06-003 | Rollback: beta → stable, data intact | critical | mac/win/linux | PENDING |
| MT-06-004 | A vault written on beta still opens after rollback | critical | mac/win/linux | PENDING |
| MT-06-005 | Restored tabs survive an upgrade and a rollback | major | mac/win/linux | PENDING |
| MT-06-006 | macOS: signed, notarized, opens without Gatekeeper warning | critical | mac | PENDING |
| MT-06-007 | Windows: signed installer, no SmartScreen block | critical | win | PENDING |
| MT-06-008 | Linux: AppImage and .deb both install and launch | major | linux | PENDING |
| MT-06-009 | Chinese IME works in the in-app browser (M10) | critical | mac/win/linux | PENDING |
| MT-06-010 | Clipboard copy/paste and file upload work (M10) | major | mac/win/linux | PENDING |
| MT-06-011 | A screen reader can navigate the app chrome (M11) | major | mac/win/linux | PENDING |
| MT-06-012 | The support matrix in README matches what installs | minor | — | PENDING |

---

## MT-06-004 A vault written on beta still opens after rollback
- 状态: PENDING
- 严重度: critical
- 关联: 004 Phase 6 / data-migration.ts / verification §1–§2
- 平台: macOS | Windows | Linux(X11)
- 前置: 一台装了 beta 的机器，vault 已启用并存有若干字段
- 步骤: 1. 在 beta 上存入几条资料。2. 回滚到 stable。3. 打开设置页 Vault。
- 预期: 若 beta 的格式变更是加性的（compat 未抬升），stable 能读回全部字段；若是破坏性变更，stable 明确拒绝并提示升级而非静默丢数据。两种都不得丢失或损坏文件。
- 实测: （测试时填写；含 beta/stable 版本、OS）
- 修复: —

## MT-06-005 Restored tabs survive an upgrade and a rollback
- 状态: PENDING
- 严重度: major
- 关联: 004 Phase 6 / tab-lifecycle.ts
- 平台: macOS | Windows | Linux(X11)
- 前置: 有若干打开的页、崩溃/重启留下 checkpoint
- 步骤: 1. 在旧版留下 checkpoint。2. 升级。3. 恢复提示应列出这些页。4. 回滚后再验一次。
- 预期: 升级后 checkpoint 被向前迁移、恢复提示正确；回滚后加性变更仍可读，破坏性变更最多丢一次恢复提示，绝不影响启动。
- 实测: —
- 修复: —

（其余用例 MT-06-001/002/003/006–012 均为发布与真机验收项：签名安装、双通道自动更新升降、三平台 IME/剪贴板/上传/读屏、支持矩阵核对。需在有证书与目标机器的发布环境执行，此处保持 PENDING。）
