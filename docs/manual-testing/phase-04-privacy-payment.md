# Phase 4 — manual verification

Template and status machine: [`_template.md`](./_template.md). Evidence and automated results:
[`../verification/phase-04.md`](../verification/phase-04.md).

What the automated suites cannot answer is whether the machine *behaves* the way the design says on
a real desktop, with a real keychain, on a real booking form. Two things in particular need a human:
the fail-closed decisions (does the vault actually refuse to start with no keyring? does a screenshot
actually refuse to emit rather than leak?), and the secret phase against a live site (does the agent
really lose the page while a code is typed, and get it back only when the field is clear?).

Every case here is `PENDING`. Use dummy data throughout — invented document numbers, a test card,
a booking you are willing to abandon at the payment page. **Do not complete a real purchase for a
test case** unless the case says to, and none does in this phase.

```bash
# The vault is off by default. Turn it on for these cases; the gated capabilities below it stay off
# on their own because nothing reports an isolated runtime this phase.
PENGUIN_FLAGS=iab.enabled,vault.enabled,audit.chain,secret_entry.contract pnpm desktop
```

`vault.l2l3`, `secret_entry.live` and `payments.execute` cannot be turned on in this phase — their
dependency chain runs through an isolated agent runtime that does not exist yet (design/004 §5).
MT-04-012 is the case that confirms that.

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| MT-04-001 | The vault stores a value, and it is not on disk in the clear | critical | PENDING |
| MT-04-002 | With no keyring (Linux), the vault refuses to start and says why | critical | PENDING |
| MT-04-003 | A grant card names the site, purpose and fields, and can be declined | critical | PENDING |
| MT-04-004 | An L1 projection reaches the agent masked; an L2 value never does | critical | PENDING |
| MT-04-005 | secure_fill types an identity number the agent never sees | critical | PENDING |
| MT-04-006 | The same value is redacted from a snapshot the page echoes it into | critical | PENDING |
| MT-04-007 | A screenshot is refused while an un-located sensitive value is on the page | critical | PENDING |
| MT-04-008 | A grant does not survive a navigation to another domain | critical | PENDING |
| MT-04-009 | The secret phase: the agent loses the page while a code is typed | critical | PENDING |
| MT-04-010 | The secret phase does not return the page until the field is clear | critical | PENDING |
| MT-04-011 | The audit viewer shows events by name, and integrity-checks the chain | major | PENDING |
| MT-04-012 | The three gated flags cannot be turned on this phase | critical | PENDING |
| MT-04-013 | The capability panel shows a denied capability with its reason | major | PENDING |
| MT-04-014 | Export re-authenticates with the OS, and audits | major | PENDING |
| MT-04-015 | Delete-all removes every value and leaves the vault usable | major | PENDING |
| MT-04-016 | Rotate re-keys the vault with values still readable | minor | PENDING |
| MT-04-017 | An agent command cannot read the vault file or the keychain (A1/A2) | critical | PENDING |
| MT-04-018 | An agent cannot reach the broker without the token (A3) | critical | PENDING |
| MT-04-019 | `secret_entry.live` first real OTP fill — only after isolation ships | critical | PENDING |
| MT-04-020 | A real payment via `execute_payment` — only after isolation ships | critical | PENDING |

MT-04-019 and MT-04-020 are recorded now but cannot be run this phase: they need `secret_entry.live`
and `payments.execute`, which need the isolation of Phase 5. They stay `PENDING` here as the first
real-material checks to run once that flag can be turned on, per design/004 §5's exit note.

---

## MT-04-001 The vault stores a value, and it is not on disk in the clear
- 状态: PENDING
- 严重度: critical
- 关联: 003 §4.2 / flag:vault.enabled
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库已启用（keychain 可用）
- 步骤: 1. 在 Vault 设置页添加一个 L2 字段（如身份证号，用虚构值 `310101199001011234`）。2. 关闭应用。3. 用文本编辑器打开 `userData/vault/profile-vault.json`。
- 预期: 文件里搜不到明文值；`masterKey`/`auditKey` 是 keychain 包裹后的密文；文件权限 0600。
- 实测: （测试时填写；含 commit sha / 版本 / OS）
- 修复: —

## MT-04-002 With no keyring (Linux), the vault refuses to start and says why
- 状态: PENDING
- 严重度: critical
- 关联: 003 §4.4 / 攻击 A9
- 平台: Linux(X11) | Linux(Wayland)
- 前置: 在无 gnome-keyring / kwallet 的环境启动（或临时停用 keyring 服务）
- 步骤: 1. `PENGUIN_FLAGS=iab.enabled,vault.enabled pnpm desktop`。2. 打开 Vault 设置页。
- 预期: 保管库未启用；本机能力面板显示「私密资料保管库 · 条件未满足」并给出安装 keyring 或 `--password-store` 的提示；未创建 vault 文件。
- 实测: —
- 修复: —

## MT-04-003 A grant card names the site, purpose and fields, and can be declined
- 状态: PENDING
- 严重度: critical
- 关联: 003 §5.1
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库已启用并存有若干字段
- 步骤: 1. 让 agent 在某订票站点请求使用资料（触发 `request_profile_grant`）。2. 阅读弹出的授权对话框。3. 点「拒绝」。
- 预期: 对话框写明域名、用途、精确字段；拒绝后 agent 收到「已拒绝」并不再代填；审计记录 `grant_denied`（无值）。
- 实测: —
- 修复: —

## MT-04-004 An L1 projection reaches the agent masked; an L2 value never does
- 状态: PENDING
- 严重度: critical
- 关联: 003 §3 / §5.2
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库存有一个 L1 字段（如联系邮箱）和一个 L2 字段（如手机号）
- 步骤: 1. 批准一个 projection 授权覆盖两者。2. 查看 agent 上下文 / trace。
- 预期: L1 邮箱以掩码形式出现（`m***@…`）；L2 手机号完全不出现，只有 handle；trace 里无完整值。
- 实测: —
- 修复: —

## MT-04-005 secure_fill types an identity number the agent never sees
- 状态: PENDING
- 严重度: critical
- 关联: 003 §6.1
- 平台: macOS | Windows | Linux(X11)
- 前置: L2 字段已存；已获得 handle 授权
- 步骤: 1. 让 agent 对某表单字段调用 `fill_saved_field`。2. 检查表单已填入正确值。3. 检查 agent 的工具返回与 trace。
- 预期: 页面被正确填入；工具只返回「已填 / 字段名」；trace 与审计无值；审计记录 `fill_performed`。
- 实测: —
- 修复: —

## MT-04-006 The same value is redacted from a snapshot the page echoes it into
- 状态: PENDING
- 严重度: critical
- 关联: 003 §6.5
- 平台: macOS | Windows | Linux(X11)
- 前置: 已通过 secure_fill 填入一个值，且页面在别处回显它（如确认区）
- 步骤: 1. 让 agent 取一次 DOM / markdown 快照。2. 搜索快照中的值。
- 预期: 值被替换为 `[REDACTED:<field>]`，回显处也被替换；快照中搜不到原值。
- 实测: —
- 修复: —

## MT-04-007 A screenshot is refused while an un-located sensitive value is on the page
- 状态: PENDING
- 严重度: critical
- 关联: 003 §6.5
- 平台: macOS | Windows | Linux(X11)
- 前置: 存在一个已登记但无 bounding box 的敏感值（如 secret phase 中）
- 步骤: 1. 让 agent 请求 `screenshot`。
- 预期: 出图被拒绝，理由指明覆盖不完整；不产生可能泄漏的图片。已定位的值则以像素遮罩覆盖后出图。
- 实测: —
- 修复: —

## MT-04-008 A grant does not survive a navigation to another domain
- 状态: PENDING
- 严重度: critical
- 关联: 003 §5.2
- 平台: macOS | Windows | Linux(X11)
- 前置: 已在 A 域获得 handle 授权
- 步骤: 1. 页面跳转到另一域名。2. 让 agent 再次尝试 `fill_saved_field`。
- 预期: 被拒绝（wrong_domain），理由指明两个域名不一致；审计记录拒绝。
- 实测: —
- 修复: —

## MT-04-009 The secret phase: the agent loses the page while a code is typed
- 状态: PENDING
- 严重度: critical
- 关联: 003 §7.3
- 平台: macOS | Windows | Linux(X11)
- 前置: 到达一个需要 OTP/CVV 的真实页面（用测试卡 / 测试短信）
- 步骤: 1. 触发 secret phase。2. 在此期间让 agent 尝试读取或操作该页面。
- 预期: agent 的 CDP 通道被撤销，读写均被拒；用户在页面自行输入；审计记录 `secret_phase_enter`（无值）。
- 实测: —
- 修复: —

## MT-04-010 The secret phase does not return the page until the field is clear
- 状态: PENDING
- 严重度: critical
- 关联: 003 §7.3 出口 (a)(b)(c)
- 平台: macOS | Windows | Linux(X11)
- 前置: 同上
- 步骤: 1. 输入后字段仍留有值（不清空）。2. 观察是否交还。3. 再测：字段清空 / 页面跳转后观察交还。
- 预期: 值未证明清空前不交还（保持 human-only 或销毁 target）；证明清空后才恢复 agent；审计记录退出条件（无值）。
- 实测: —
- 修复: —

## MT-04-011 The audit viewer shows events by name, and integrity-checks the chain
- 状态: PENDING
- 严重度: major
- 关联: 003 §5.3 / 攻击 A10
- 平台: macOS | Windows | Linux(X11)
- 前置: 已产生若干审计事件
- 步骤: 1. 打开「校验审计完整性」。2. 用外部工具删除审计文件中间一行。3. 再次校验。
- 预期: 正常时报告链连续、末尾摘要匹配；篡改后报告不一致并指出位置；任何视图都不含值。
- 实测: —
- 修复: —

## MT-04-012 The three gated flags cannot be turned on this phase
- 状态: PENDING
- 严重度: critical
- 关联: 004 §5
- 平台: macOS | Windows | Linux(X11)
- 前置: 无
- 步骤: 1. `PENGUIN_FLAGS=iab.enabled,vault.enabled,vault.l2l3,secret_entry.live,payments.execute pnpm desktop`。2. 打开本机能力面板。
- 预期: `vault.l2l3` / `secret_entry.live` / `payments.execute` 全部显示「条件未满足」，理由指向隔离前提；`execute_payment` 实际调用返回 `payments_disabled`。
- 实测: —
- 修复: —

## MT-04-013 The capability panel shows a denied capability with its reason
- 状态: PENDING
- 严重度: major
- 关联: 004 §5
- 平台: macOS | Windows | Linux(X11)
- 前置: 请求了某个因本机条件被拒的能力
- 步骤: 1. 打开 Vault 设置页顶部的「本机能力」。
- 预期: 被拒能力显示为「条件未满足」并附服务器给出的整句理由；未请求的显示「未启用」；已启用的显示「已启用」。
- 实测: —
- 修复: —

## MT-04-014 Export re-authenticates with the OS, and audits
- 状态: PENDING
- 严重度: major
- 关联: 003 §4.5
- 平台: macOS | Windows
- 前置: 保管库存有若干字段
- 步骤: 1. 触发导出。2. 观察是否要求系统重认证（Touch ID / Windows Hello / 密码）。
- 预期: 未重认证不导出；重认证后导出全部值；审计记录 `export`（字段名，无值）。
- 实测: —
- 修复: —

## MT-04-015 Delete-all removes every value and leaves the vault usable
- 状态: PENDING
- 严重度: major
- 关联: 003 §4.5
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库存有若干字段
- 步骤: 1. 执行「删除全部」。2. 重新添加一个字段并读回。
- 预期: 文件中搜不到旧值；保管库与审计链仍在；新字段可正常存取。
- 实测: —
- 修复: —

## MT-04-016 Rotate re-keys the vault with values still readable
- 状态: PENDING
- 严重度: minor
- 关联: 003 §4.2
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库存有若干字段
- 步骤: 1. 触发轮换主密钥。2. 关闭并重开应用。3. 读回字段。
- 预期: 文件中的 `masterKey` 与各字段 DEK 密文变化，值密文不变；重开后仍可读回。
- 实测: —
- 修复: —

## MT-04-017 An agent command cannot read the vault file or the keychain (A1/A2)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §12 A1/A2
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库已启用
- 步骤: 1. 让 agent 用 `exec_command` 尝试 `cat userData/vault/profile-vault.json`。2. 尝试 `security find-generic-password` / `secret-tool`。
- 预期: 未隔离环境下这属于已知残余（T0），必须如实呈现：本 Phase 不声称能阻止；记录实际结果，供 Phase 5 隔离达标后复测转为「拒绝」。
- 实测: —
- 修复: —

## MT-04-018 An agent cannot reach the broker without the token (A3)
- 状态: PENDING
- 严重度: critical
- 关联: 003 §12 A3
- 平台: macOS | Windows | Linux(X11)
- 前置: 保管库已启用（broker 运行）
- 步骤: 1. 让 agent 尝试连接 broker socket 且不带 / 带伪造 token。
- 预期: 被拒（unauthorized），审计记录 `broker_rejected`。注意 §11.3 残余：未隔离时 token 对 agent 可读——如实记录，不用「有认证」制造安全感。
- 实测: —
- 修复: —

## MT-04-019 secret_entry.live first real OTP fill — only after isolation ships
- 状态: PENDING
- 严重度: critical
- 关联: 003 §7.3 / 004 §5 / flag:secret_entry.live
- 平台: macOS | Windows
- 前置: **Phase 5 隔离达标后** `secret_entry.live` 方可开启；本 Phase 不可运行
- 步骤: （隔离达标后）1. 到达真实 3DS/OTP 页面。2. 在卡片安全输入框输入真实一次性码。
- 预期: main 原子填入并提交；证明清空后交还 agent；全程 agent detach；审计无值。
- 实测: —
- 修复: —

## MT-04-020 A real payment via execute_payment — only after isolation ships
- 状态: PENDING
- 严重度: critical
- 关联: 003 §8.6 / 004 §5 / flag:payments.execute
- 平台: macOS | Windows
- 前置: **Phase 5 隔离达标 + 真实 PaymentPort 接入后**；本 Phase 不可运行
- 步骤: （达标后）1. 卡片确认一笔真实小额订单。2. agent 调 `execute_payment`。3. 中途 SIGKILL 后恢复。
- 预期: 五道检查通过后扣款一次；SIGKILL 后为 dangling intent，恢复时要求对账不重复扣款；capability 一次性。
- 实测: —
- 修复: —
