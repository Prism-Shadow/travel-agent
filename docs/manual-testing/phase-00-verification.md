# Phase 0 — manual verification

Template and status machine: [`_template.md`](./_template.md). Evidence and automated verdicts:
[`../verification/phase-00.md`](../verification/phase-00.md).

Phase 0 produced no user-visible capability — every feature flag defaults off — so nothing here
gates Phase 1 (design/004 §4.1). These are the items that **could not be executed** on the Phase 0
host (headless Linux, no keyring, datacenter IP) and the GUI checks that need a human.

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| MT-00-001 | safeStorage on macOS | major | PENDING |
| MT-00-002 | safeStorage on Windows | major | PENDING |
| MT-00-003 | safeStorage on Linux **with** a keyring | major | PENDING |
| MT-00-004 | Ctrip renders correctly in a real IAB window | minor | PENDING |

---

## MT-00-001 safeStorage on macOS
- 状态: PENDING
- 严重度: major
- 关联: 003 §4.2 / 003 §4.4 / flag:vault.enabled / docs/verification/phase-00.md §4
- 平台: macOS
- 前置: 仓库已 `pnpm install && pnpm build`；登录到一个正常的桌面会话（Keychain 可用）
- 步骤:
  1. `cd packages/desktop`
  2. `./node_modules/.bin/electron scripts/probe-safe-storage.mjs`
  3. 记录输出的 JSON 与退出码（`echo $?`）
- 预期: `isEncryptionAvailable: true`、`hasAsyncApi: true`、`roundTrip: true`、
  `cipherContainsPlaintext: false`、`vaultAllowed: true`，退出码 `0`
- 实测: （未执行 —— Phase 0 主机为 Linux）
- 修复: —

## MT-00-002 safeStorage on Windows
- 状态: PENDING
- 严重度: major
- 关联: 003 §4.2 / 003 §4.4 / flag:vault.enabled / docs/verification/phase-00.md §4
- 平台: Windows
- 前置: 同上，普通用户会话（DPAPI 可用）
- 步骤:
  1. `cd packages/desktop`
  2. `.\node_modules\.bin\electron.cmd scripts\probe-safe-storage.mjs`
  3. 记录 JSON 与 `$LASTEXITCODE`
- 预期: `isEncryptionAvailable: true`、`roundTrip: true`、`vaultAllowed: true`，退出码 `0`
- 实测: （未执行 —— Phase 0 主机为 Linux）
- 修复: —

## MT-00-003 safeStorage on Linux with a keyring
- 状态: PENDING
- 严重度: major
- 关联: 003 §4.4 / flag:vault.enabled / docs/verification/phase-00.md §4
- 平台: Linux(X11) 或 Linux(Wayland)
- 前置: 桌面会话，已安装并解锁 gnome-keyring 或 kwallet
- 步骤:
  1. `cd packages/desktop`
  2. `./node_modules/.bin/electron scripts/probe-safe-storage.mjs`
  3. 记录 `backend` 字段
- 预期: `backend` 为 `gnome_libsecret` 或 `kwallet*` 之一（**不是** `basic_text`）、
  `vaultAllowed: true`，退出码 `0`
- 实测: （未执行 —— Phase 0 主机无 keyring，实测为 `basic_text` / `vaultAllowed:false`，
  即 003 §4.4 的 fail-closed 分支，该分支已在本机原生验证）
- 修复: —

## MT-00-004 Ctrip renders correctly in a real IAB window
- 状态: PENDING
- 严重度: minor
- 关联: 002 §11.2 / 004 §8 R1 / docs/verification/phase-00.md §5
- 平台: macOS | Windows | Linux(X11)
- 前置: 有显示器的开发机；Phase 0 的 smoke 只在无头 Xvfb + 机房 IP 下验证过可达性与文本内容
- 步骤:
  1. 用 Phase 1 的 IAB 面板（或等价的临时 Electron 窗口）打开 `https://www.ctrip.com/`
  2. 目视检查：布局、图片、字体、是否出现验证码或风控拦截页
  3. 打开 `https://hotels.ctrip.com/`，在目的地输入框手动输入「东京」，观察自动补全浮层是否出现
- 预期: 页面视觉正常，无验证码/拦截页；自动补全浮层正常弹出（这是 `fillWithSuggestion`
  在 Phase 1 依赖的行为）
- 实测: （未执行 —— Phase 0 环境无 GUI。已知：无头下两页均返回真实内容，
  body 文本 3425 / 1275 字符，无拦截页）
- 修复: —
