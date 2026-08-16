# Codex 对齐生产路线图

| | |
| --- | --- |
| 状态 | **Phase 0–4 代码完成、Phase 5 工程轨代码完成、人工验收待做**（`code_complete_manual_pending`；安全轨隔离 D3 未决；逐 Phase 状态以 §2.1 总表为准） |
| 日期 | 2026-08-16 |
| 基线 | 规划基线 travel-agent `8cead1d` · Electron 43.2.0 |
| 终点 | **Codex App 同等级的单窗口浏览器体验 + 可生产上线（GA）**。MVP / vertical slice 只是内部里程碑，不是终点 |
| 依据 | [`001-architecture.md`](./001-architecture.md)（产品定位与判断）· [`002-codex-style-single-window-iab.md`](./002-codex-style-single-window-iab.md)（浏览器工作区）· [`003-agent-first-private-profile-and-payment-confirmation.md`](./003-agent-first-private-profile-and-payment-confirmation.md)（隐私与交易） |
| 纪律 | 本文引用 002/003 而不复述其细节；发现矛盾时按 §0.2 的优先级规则裁决，**不修改 001/002/003** |

---

## 0. 优先级规则与已知矛盾裁决

### 0.1 三条规则

1. **效果与行为对齐，不要求内部实现相同。** 对齐目标是用户可感知的行为（§1 矩阵），不是 Codex 的内部架构——我们走自己的 relay + `webContents.debugger` 路线（002 §4），只要行为列达标即为对齐。
2. **002/003 在各自边界内权威。** 002 管浏览器工作区怎么做，003 管隐私数据与交易授权怎么做。本 Roadmap 只裁两件事：**排序**（什么先做）与**发布门槛**（什么挡 GA）。
3. **安全按风险分阶段，不做前期一刀切。** 003 的 fail-closed 原则不放松，但其作用域收窄为「真实 L2/L3 数据与存储的支付凭证」；非敏感的浏览器主体开发不被阻断。安全项分三级（§5）：**GA 必须 / 强烈建议 / 可延期**，均由 feature flag 控制。

### 0.2 已知矛盾与裁决

| # | 矛盾 | 裁决（只影响排序与门槛，不改原文） |
| --- | --- | --- |
| C1 | 003 §12 把 P0-A（OS 级隔离）列为「其余全部阶段的硬前提」 | **收窄作用域**：P0-A 是 **Phase 4 启用真实 L2/L3 与存储支付凭证** 的硬前提，也是含这些能力的 GA 的硬前提；不是浏览器 Phase 0–3 的前提。003 §0.3 自身的降级条款（L2/L3 停用、dummy vault、非敏感功能不受影响）支持这个读法 |
| C2 | 003 §8 的完整 capability/journal 机器 vs 「模型主动暂停 + 用户确认」作为主交互层 | **分两层落地**：Phase 3 先做交互层（模型在付款前必须暂停并请求卡片/明确对话确认）+ 轻量确定性兜底（`checkDrift` 金额/商户/行程漂移即拒，复用 `transaction/src/commitment.ts`）。此层定位是**防误操作**，不是对抗性保证。003 §8 的完整机器（digest、capability、`execute_payment` 于 main 执行）在 Phase 4 落地，才构成对抗性保证。两层不冲突，是先后 |
| C3 | 002 状态行「涉及个人资料与支付的能力另受 003 §0.3 阻塞」 | 与 C1 一致：阻塞的是**那些能力**，不是 002 的 P1–P4 |
| C4 | 003 §0.2 human-only 清单含「系统钱包确认」，但 Phase 3 想尽早跑通付款闭环 | Phase 3 的付款闭环允许两种终态：用户在场自行完成钱包/OTP（human-only 路径原样保留），或**停在支付页**（ceiling `fill_form`，001 §4.2 的默认）。agent 代点「支付」按钮在 Phase 4 机器就位前默认 flag 关闭 |
| C5 | 003 §7.3 scoped secret phase 是完整机制，Phase 3 若先行「main 基础代填」会制造无 detach/无清空证明的窗口期 | **不允许该窗口期**：Phase 3 的 `secret_entry` 只交付契约、卡片 UI 与 synthetic/dummy 测试；真实 CVV/OTP/3DS 在 Phase 4 完整 scoped secret_phase 验收前**一律 human-only 或 flag off**（`secret_entry.live` 默认 off）。Agent 主动停顿，用户在页面/系统 UI 自行完成 |

---

## 1. 产品对齐矩阵

基准是 Codex App 的单窗口浏览器体验。**行为对齐，不复刻实现。**

| # | 能力 | Codex 行为基准 | travel-agent 目标 | 现状（截至 Phase 2 代码完成，人工验收待做） | Phase |
| --- | --- | --- | --- | --- | --- |
| M1 | 单一应用窗口 | 左对话右浏览器，可拖分隔线 | 同，002 §2 | Phase 1 已交付：左右分栏 + 可拖分隔线 | 1 |
| M2 | 真实 IAB | Electron WebContents 渲染真实网页，可直接交互 | `WebContentsView` + `persist:travel-iab`，002 §5.2 | Phase 1 已交付：`WebContentsView` + 独立 partition | 1 |
| M3 | 标签 / 地址栏 | 内嵌浏览器有自绘 tab 与地址栏、前进后退刷新 | 002 §2 自绘 chrome | Phase 2 代码完成、人工验收待做 | 2 |
| M4 | 对话绑定 | 浏览器会话与对话线程绑定，@Browser 引用 | tab 带 `ownedByTask`；切换会话切换活动 tab 集；agent 经既有 session 模型驱动 | Phase 2 代码完成：任务归属 + 会话作用域已落地（@Browser 引用未做，属后续 Phase） | 2 |
| M5 | 用户与 Agent 同页操作 | 用户可随时点页面；agent 操作可见 | `ghostCursor` + `before-input-event` 软信号 + 控制权状态机（002 §6.5） | ghostCursor 已有 | 2–3 |
| M6 | 浏览器 profile | 与用户日常浏览器分离的独立 profile，可登录、可清空 | `persist:travel-iab`，清空入口（002 §11.3-6） | Phase 1 建 profile、Phase 2 加清空入口，代码完成 | 2 |
| M7 | IAB / Chrome 双后端 | IAB 默认 + Chrome 扩展接真实登录态 | `mode:'iab'` 默认，extension 模式保留，任务级切换（002 §6.1、§7） | Phase 1 加 iab 后端、Phase 2 加每对话切换，代码完成 | 1（iab）/ 2（切换） |
| M8 | 恢复 | 崩溃/重启后会话与页面可恢复 | 002 §6.4 四条策略：retain/close、URL 快照恢复、崩溃分级、手动保留 | Phase 2 代码完成、人工验收待做 | 2 |
| M9 | 快捷键 | 新标签/关闭/地址栏聚焦/切换等浏览器惯用键 | Cmd/Ctrl+T·W·L·R·[·]·1-9，主窗口与 IAB 焦点各自路由 | Phase 2 代码完成、人工验收待做 | 2 |
| M10 | 输入法 / 剪贴板 / 上传 | 原生可用 | WebContentsView 原生能力，重点在**验证**而非实现（中文 IME 三平台、文件对话框） | 理论可用，未验证 | 1 验证 / 6 全平台复验 |
| M11 | 无障碍 | 页面对辅助技术可达 | 页面侧靠真实 Chromium；自绘 tab strip / 地址栏 / 卡片补 ARIA 与键盘导航 | 页面侧天然满足；自绘件 Phase 2 已补 ARIA 与键盘导航，验证在 6 | 2 实现 / 6 验证 |
| M12 | 跨平台 | macOS / Windows / Linux | 同；Linux Wayland 单窗口方案无窗口编排问题，仅 keyring 缺失时 Vault 停用（003 §4.4） | CI 已跑 Ubuntu/Windows；macOS 签名公证链路已通（见下注） | 6 |
| M13 | Agent-first 介入 | Codex 以审批/确认为主，接管为例外 | `requestUserInteraction` 六类，takeover 为 last resort（003 §7） | Phase 3 代码完成：六类齐备，四类为对话卡片、两类才碰浏览器；takeover 强制 reason | 3 |
| M14 | 付款确认 | —（Codex 无此场景，本产品的核心差异化） | 模型主动暂停 + 确认卡/明确对话；确定性兜底；Phase 4 后对抗性保证（003 §8） | Phase 3 代码完成：七字段卡片 + Commitment + submitBooking 兜底 + 写闸门拒点付款；capability/digest 全量机器在 4 | 3 / 4 |

注：M12 现状中 macOS 签名公证链路指上游快照提交 `d14be6f`（001 基线）随仓带入的 `desktop-build.yml`/`release.yml` 与 entitlements 配置。

---

## 2. 阶段规划

### 2.0 Pre-Phase 规划 checkpoint

当前 002 + 003 + 004 三份文档将以一个**规划 checkpoint** 提交：

> `docs(design): define Codex-parity browser architecture and production roadmap`

该 commit **只表示规划定稿，不表示 Phase 0 完成**。Phase 0 仍需在此之后按 §3 协议执行，并产生它自己的 checkpoint commit。§2.1 总表的状态在 Phase 0 开工时才流转为 `in_progress`。

### 2.1 总表

| Phase | 名称 | 状态 | 粗略工期 | 依赖 |
| --- | --- | --- | --- | --- |
| 0 | 规划与关键验证 | completed | 2–3 d | 规划 checkpoint 已 push（`8474f0c`）；结论见 [`docs/verification/phase-00.md`](../docs/verification/phase-00.md) |
| 1 | Vertical slice：左聊右览 | code_complete_manual_pending | 5–8 d | 0；结论见 [`docs/verification/phase-01.md`](../docs/verification/phase-01.md) |
| 2 | 浏览器功能完整 | code_complete_manual_pending | 8–12 d | 1；结论见 [`docs/verification/phase-02.md`](../docs/verification/phase-02.md) |
| 3 | Agent-first 交互与付款确认（交互层） | code_complete_manual_pending | 8–12 d | 2；结论见 [`docs/verification/phase-03.md`](../docs/verification/phase-03.md) |
| 4 | 隐私 Vault 与交易机器 | code_complete_manual_pending | 10–15 d | 3；**L2/L3 启用另需 §5 隔离达标**；结论见 [`docs/verification/phase-04.md`](../docs/verification/phase-04.md) |
| 5 | 生产加固 | in_progress（工程轨代码完成；安全轨隔离 D3 未决） | 6–10 d | 3（可与 4 并行开始）；结论见 [`docs/verification/phase-05.md`](../docs/verification/phase-05.md) · [`isolation.md`](../docs/verification/isolation.md) |
| 6 | 跨平台 Beta | planned | 6–10 d | 5 |
| 7 | 灰度与集中人工验收 | planned | 5–8 d（日历更长） | 6 |
| 8 | GA | planned | 2–3 d（发布执行） | 7；D5 go |

每个 Phase 统一九项字段：**目标 / 范围 / 非目标 / 依赖 / 代码与文档模块 / 自动测试 / 退出标准 / 人工测试 / Checkpoint commit**。

### Phase 0 · 规划与关键验证

- **目标**：把 002 §11.3 中会改变实现路径的未知消掉；搭好本 Roadmap 的执行骨架。
- **范围**：
  - `pnpm install && pnpm build`（lockfile 随 `8cead1d` 已变）。
  - 验证 Playwright 经 relay 语义能驱动 `WebContentsView`（002 P0；开发期临时 `--remote-debugging-port` 仅限本地分支，002 §4.2 候选 A 纪律）。
  - 验证 `context.newPage()` / `Target.createTarget` 在 Electron 上的行为（002 §11.3-1，决定 `tabs.open()` 路由）。
  - `safeStorage` 三平台探测脚本（003 P0-C 的探测部分，不建 Vault）。
  - **feature flag 骨架**：只读 flag 模块 + 构建期/运行期开关，§5 与后续所有受控能力都挂它。
  - 建 `docs/manual-testing/` 目录与模板（§4）。
  - 实测一次携程首页在临时 WebContentsView 中的反爬表现（002 §11.2 首要产品风险，早知道早转向）。
- **非目标**：不写任何面板 UI；**不修改 001/002/003**。
- **依赖**：规划 checkpoint（§2.0）已 push。
- **代码与文档模块**：`scratch/` 验证脚本（不进产品路径）、`packages/core/src/state/feature-flags.ts`（或 desktop 侧，验证后定）、`docs/manual-testing/_template.md`、`docs/verification/phase-00.md`。
- **自动测试**：flag 模块单测（默认值、覆盖优先级）。
- **退出标准**：三项验证结论、flag 骨架说明与携程反爬初判**全部写入 `docs/verification/phase-00.md`**；结论不回写 001/002/003（如需修订 002 §11.3 勾选，另行发起文档修订，不属本 Phase）。
- **人工测试**：`docs/manual-testing/phase-00-verification.md`——携程页面在 IAB 中的视觉/交互抽查（PENDING 不阻塞）。
- **Checkpoint commit**：`chore(roadmap): phase 0 — feature flags, manual-testing scaffold, and the three verdicts that shape phase 1`

### Phase 1 · Vertical slice：左聊右览

- **目标**：单窗口内跑通「一句话 → 右侧真实 IAB 里看到 agent 搜索携程 → 用户可直接点页面」。丑但真。
- **范围**（002 P1+P2 的最小并集）：单 tab 的 IAB 视图与布局；`/iab` 传输接入 relay；executor `iab` 分支；web 侧最小面板（URL 显示 + 测量 div）；纯 web 部署降级（bridge 缺失即隐藏）。
- **非目标**：tab strip、多 tab、恢复、快捷键、控制权状态机、遮蔽协调。
- **依赖**：Phase 0（`tabs.open()` 路由结论、flag 骨架）。
- **代码与文档模块**：`desktop/src/browser-pane.ts`、`browser-pane-layout.ts`（纯函数）、`preload-browser.ts` + `ipc.ts`（具名通道，002 §5.1 三条纪律）、`session-partition.ts`（002 §5.2 全项不可协商）、`iab-transport.ts`；relay `/iab` WS + `mode:'iab'` 分派（002 §4.2 候选 C、§4.3 密钥）；`executor.ts` `cdpConfig.iab`；web `browser-pane.tsx` 最小版、`desktop-bridge.ts`。
- **自动测试**：布局纯函数；iab-transport 假 WS+假 debugger（命令/事件/错误/重连）；relay `/iab` 认证（无密钥 401、非 loopback 403）；executor iab 分支下 `snapshot()`/`clickThrough` 真 Electron 冒烟（CI 用 Xvfb，`scripts/dev-browser.sh` 先例）。
- **退出标准**：`penguin-browser session new --iab` 后 `-e 'await snapshot()'` 返回 IAB 页 ARIA 树；`clickThrough`/`fillWithSuggestion`/`pickDate` 跑通携程酒店表单（对照 001 §7.5 真 Chrome 一次跑通的记录）；中文输入法在 IAB 输入一次成功（开发机冒烟，正式验证在 Phase 6）。
- **人工测试**：`docs/manual-testing/phase-01-vertical-slice.md`——分隔线拖动、直接点击页面、IME 首验。
- **Checkpoint commit**：`feat(iab): vertical slice — WebContentsView pane, /iab transport, and an agent that searches Ctrip on screen`

### Phase 2 · 浏览器功能完整

- **目标**：右侧从「能用」到「像一个浏览器」，覆盖矩阵 M3–M9、M11 实现侧。
- **范围**：自绘 tab strip / 地址栏 / 导航控件（含 ARIA 与键盘导航）；多 tab 与弹窗进 tab 模型（002 §5.2 弹窗策略）；任务绑定 `ownedByTask` 与会话切换（M4）；tab 生命周期四条策略（002 §6.4）；快捷键与焦点路由（M9）；z-order 遮蔽协调（002 §5.3，逐个清点 portal 组件）；profile 清空/登出入口（M6）；extension 后端切换 UX（M7，002 §7：开场检查里选、任务中不切、移交 URL+候选集）。
- **非目标**：requestUserInteraction、付款、Vault。
- **依赖**：Phase 1。
- **代码与文档模块**：`web/src/features/chat/browser-pane.tsx` 全量、`use-browser-pane.ts`；`desktop/src/tab-lifecycle.ts`、`browser-pane.ts` 多 tab 扩展；`PaneState` 事件聚合（002 §6.3）；快捷键路由表；`chat-page.tsx` 三面板协调；分区清空入口（002 §11.3-6）。
- **自动测试**：`tab-lifecycle.test.ts`（四种结束情形、用户标记覆盖、checkpoint 往返、崩溃分级不误伤主窗口——002 P1 验收全项）；PaneState 聚合；快捷键路由表；遮蔽状态机。
- **退出标准**：002 P1 验收 5 条 + P2 验收 3 条全绿；三平台 CI 构建绿；现有两面板测试无回归。
- **人工测试**：`docs/manual-testing/phase-02-browser-shell.md`——多 tab 实操、快捷键手感、屏幕阅读器过自绘件、崩溃恢复实杀、双后端切换全流程。
- **Checkpoint commit**：`feat(iab): a real browser shell — tabs, address bar, task-scoped lifecycle, and crash-scoped recovery`
- **本 Phase 额外补完的契约（规划时未预见）**：仓库里**原本不存在任何 task 级标识**——core 只有 Session id，server 用状态位 + `AbortController` 追踪在跑的 turn，`taskIndex` 是事后重扫 Trace 得到的序号。因此本 Phase 先补完了 `formatTaskId` → `RunOptions.taskId` → `Environment.enterTask/exitTask` → 子进程环境变量 → CLI → relay → BrowserPane 的完整链路，并在 relay/shell 两层**强制**归属（`ownedByTask` 不再只是 tab strip 上的一个字段）。详见 verification §1–§2。
- **本 Phase 顺带关闭的 Phase 1 遗留**：19989 端口被占用时「扩展模式仍连 19989、IAB 走临时端口」的分裂——现在所有命令解析同一个 relay，且该情形下扩展后端**明确不可用并给出可操作原因**，而不是把一个会话劈成两个 relay（verification §6）。
- **§5.2 下载策略已实现**（按会话 scratchpad 落盘 + 文件名净化），不再是「取消下载」的临时形态。目录归属由 server 的 session→project/agent 映射给出（新增 `GET /api/sessions/browser-tasks`），落盘前再做一次 realpath 包含校验（TOCTOU），文件名以内存预留避免并发同名互相覆盖。
- **任务权威改由 main 进程 reconcile**：renderer 只发不带参数的提示，`TaskSupervisor` 轮询上述 server 路由并应用结果。这条在第二轮 review 中替换了原先 renderer 侧的 watcher（重载即丢、投递失败即丢），也是 tab 归属唯一的授权来源。
- **状态**：代码完成、人工验收待做。`docs/manual-testing/phase-02-browser-shell.md` 全部 `PENDING`，因此本 Phase **尚未验收通过**；自动化门禁结果逐项记录在 verification §8。

### Phase 3 · Agent-first 交互与付款确认（交互层）

- **目标**：介入模型换成 003 §7 的六类；付款前模型**必须**主动暂停并取得用户确认；确定性兜底防误操作。这是主交互层（§0.2 C2）。**敏感一次性码在本 Phase 一律 human-only（§0.2 C5）。**
- **范围**：
  - `request-help.ts` → `requestUserInteraction` 六类；`help-overlay-client.ts` 收窄为 `human_challenge`/`browser_takeover`；takeover 强制非空 `reason`。
  - 控制权状态机全量实现（002 §6.5 修订版，含 `secret_phase` 状态与 CDP detach 代码路径）——**但 `secret_entry` 只交付契约、卡片 UI 与通道形状，全部用 synthetic/dummy 数据测试**。`secret_entry.live` flag 默认 **off**：真实 CVV/OTP/3DS 场景下 Agent 主动停顿并提示，用户在页面或系统 UI 自行完成输入；**不存在「先 main 代填、detach/证明清空以后再补」的窗口期**。
  - executor 写闸门（枚举清单，002 §6.5）；`import()` 逃逸删除与 `process` 白名单（003 P0-B 在此落地）。
  - 四类卡片渲染 + `ServerEvent` 扩展（`server/src/api/types.ts:1066`）+ `EscalationChannel` app 内实现（escalation→SSE→卡片→resolve；飞书降为可选不投入）。
  - **付款确认交互**：skill/goal-prompt 层写死「付款/最终下单前必须 `commitment_confirmation`」；卡片绑定 003 §8.1 七字段；确认后生成 `Commitment` 接 `submitBooking()` 四道检查作确定性兜底——漂移即拒（`checkDrift`），默认精确金额即硬上限（003 §8.5 规则先行采纳）。
  - `Journal`/`CheckpointStore` 接进 session 生命周期（001 §4.4）。
  - 付款终态两种（§0.2 C4）：停在支付页，或用户在场自行完成钱包/OTP。`payments.agent_click_pay` 默认 **off**。
- **非目标**：Vault、真实 L2/L3 值的任何代填路径、capability/digest 全量机器、broker IPC。
- **依赖**：Phase 2。
- **代码与文档模块**：`browser-cli/src/request-help.ts`（重构）、`help-overlay-client.ts`（收窄）、`executor.ts`（写闸门 + 安全修复 + secret_phase detach 路径）；`server/src/api/types.ts`、`http/routes/interaction.ts`、app 内 `EscalationChannel`；web 四类卡片组件；skill `penguin-browser` v5 与 travel goal-prompt 的付款停顿条款。
- **自动测试**：六类分派与卡片载荷（敏感位只允许掩码/handle 形状）；写闸门逐方法断言；takeover 无 reason 拒绝；**`secret_entry` 契约测试全部用 dummy 值**（通道形状、状态机全转换、`secret_entry.live` 默认 off、off 时真实类调用被拒并转 human-only 提示）；`submitBooking` 兜底路径（漂移即拒、无确认通道即拒）；journal 接线后的 SIGKILL 复验（001 §7.3 手法在真实 session 路径重跑）；逃逸用例 `await import('child_process')` 被拒。
- **退出标准**：上列自动测试全绿；一次完整演示：搜索→选择卡→确认卡→停在支付页，全程用户未碰浏览器（遇 OTP 类节点时 Agent 停顿、用户在页面自行完成——这正是本 Phase 的合规形态）；`secret_entry.live` 默认 off 有测试钉住。
- **人工测试**：`docs/manual-testing/phase-03-agent-interaction.md`——六类各走一遍（`secret_entry` 用 dummy 演示）；真实 OTP 场景验证 **Agent 停顿且绝不代填**；模糊确认话术抽查（「可以」「付吧」必须回退卡片）；takeover 兜底体验。
- **Checkpoint commit**：`feat(interaction): agent-first payment confirmation and handover state machine`
- **实现与规划的差异（如实记录）**：
  - **卡片走 harness，不走 relay**：四类卡片由 agent 的命令经 `POST /api/agent/interactions` 送到会话（凭本轮 task token 鉴权），SSE 推卡片，用户在对话里回答。规划文本只说了「EscalationChannel app 内实现」，没有指定 agent→server 这一跳；选它是因为卡片属于对话，而 relay 只有浏览器。
  - **付款闸门是两层**：浏览器侧按控件文案拒绝点击（`IAB_PAYMENT_CLICK_BLOCKED`，护栏不是边界），harness 侧五道检查（未确认/过期/换商户/漂移/本档不许点）。`payments.agent_click_pay` 在本 Phase **不可能被打开**（依赖链要 vault + 隔离），已有测试钉住。
  - **journal 括的是「授权」而非「点击」**：`submitBooking` 的 `submit` 在 agent 回报结果时才 resolve，因此 intent 在放行前落盘、result 在回报后写入；中途崩溃留下 dangling intent，下一次同一笔被拒并要求对账。SIGKILL 复验以此形态实现（`server/test/payment-guard.test.ts`）。
  - **付款条款写在 skill，不写进 core 的 `[goal]` 块**：core 的 goal prompt 是产品中立的；把旅行付款规则塞进去会让 harness 带上产品语义。真正不依赖 prompt 的强制在写闸门与付款守卫。
  - **`secret_entry` 契约态**：卡片只解释「需要什么、做什么用」，**没有输入框**——本 Phase 应用不代填，`secret_entry.live` 不可开启。状态机（含 secret_phase 三出口）已完整实现并测试，detach 与「证明清空」属 Phase 4。

### Phase 4 · 隐私 Vault 与交易机器

- **目标**：003 的完整机器。**真实 L2/L3 与存储支付凭证的启用受 §5 隔离门槛控制**；机器本身（代码、测试、dummy 联调）不受阻。
- **范围**：Vault 核心（safeStorage 异步 API、字段级 DEK、Linux basic_text fail-closed）、三级分级与用户覆盖、grant/handle、hash-chain 审计、secureFill、**`secret_phase` 完整版（detach + 证明清空 + 三出口）——验收通过后方可开启 `secret_entry.live`**、broker IPC（认证+能力化+绑定）、`PaymentCapability` + `commitmentDigest` + 自然语言判定器（纯函数）、`execute_payment` builtin tool、`booking.ts` 第五道检查、脱敏（文本等值/指纹 + 截图 bounding-box 遮罩 + OCR 兜底不作绝对保证）。
- **非目标**：OS 隔离本身的实施属 Phase 5 安全轨；本 Phase 只消费其结果。
- **依赖**：Phase 3；`vault.l2l3` / `payments.execute` / `secret_entry.live` 的开启另需 §5 门槛。
- **代码与文档模块**：003 §11 文件清单为准（desktop `vault/*`、`secure-fill.ts`、`payment/*`；browser-cli `redaction.ts` 等；transaction/travel-domain/server/core 各修改项），此处不复述。
- **自动测试**：003 §12 P1/P2/P4 全部矩阵（grant 六种拒绝、capability 过期/重放/域名不符、模糊话术逐条回退、SIGKILL 后 `DanglingIntentError` 副作用恒 1、审计 grep 无值、secret phase 内 CDP 调用失败、A8–A10）。
- **退出标准**：全矩阵绿（dummy vault 环境）；三个受控 flag 的门控逻辑有测试证明「探测失败→off→UI 明示」；`secret_entry.live` 仅在 scoped secret_phase 全量验收通过后才允许开启且有测试钉住该次序。
- **人工测试**：`docs/manual-testing/phase-04-privacy-payment.md`——dummy 数据全流程、CVV 卡片输入→站点消费→agent 恢复（live flag 开启后的首次真实验证亦记于此，PENDING）、导出的 OS 重认证、审计查看器。
- **Checkpoint commit**：`feat(vault): private profile vault, payment capabilities, and an execute path the agent cannot hold`
- **实现与规划的差异（如实记录）**：
  - **host-tool 钩子放在 core，工具实现放在 server**：`execute_payment` / `fill_saved_field` / `request_profile_grant` 不是 core 的 builtin，而是通过新的 `EnvironmentConfig.hostTools`（产品中立）由 server 贡献、仅在有 broker 时提供。规划说的是「builtin tool」，选它是因为把旅行支付语义写进 core 会污染中立运行时——与 Phase 3 把付款规则留在 skill 同一判断。
  - **broker 无 peer-credential UID 校验**：Node 不暴露可移植的 `SO_PEERCRED`/`getpeereid`，故 socket 侧执行力是 0700 目录内的 0600 socket + fork 环境里的一次性 token；§11.2 的 UID 校验列为 Phase 5（在平台允许处）。已在 verification §10 与代码注释如实说明。
  - **grant 询问是原生对话框、全量批准**：本 Phase 用 shell 自绘的模态对话框问「是否允许」，逐字段裁剪的卡片形态留给交互卡片层，记为已知限制。
  - **`currentTarget` 接 pane 的每轮活动 tab**：`"current"` 由 `BrowserPane.taskTargetId(taskId)` 解析到该轮正在看/最近拥有的 tab；无活动 tab 或尚无 target id 时返回 null，broker handler 按「无页面」fail-closed，绝不猜错目标。（Phase 4 首版曾把 `"current"` 一律拒绝，本收尾补齐。）
  - **脱敏靠指纹分工两进程**：main 只发「盐化截断 HMAC + 长度 + 字符形状」，relay 侧匹配替换、绝不拿到值；两包各自实现 shape/fingerprint，用共享 golden 值双向钉住防止静默漂移。OCR 兜底在 `redaction.ocr` 之后，本 Phase 不实现且不作保证。

### Phase 5 · 生产加固

- **目标**：把「能演示」变成「敢发布」。安全轨与工程轨并行。
- **范围**：安全轨——§5「GA 必须」项落地；隔离方案选型与实施（决策点 D3）；`--remote-debugging-port` 构建期硬检查进 CI（002 §11.2）。工程轨——崩溃报告（main/renderer/utilityProcess 三层，载荷过脱敏，与 003 §4.6 同一不变量：无值）；结构化日志与脱敏；观测指标（takeover 率、secret_phase 触发率、卡片回退率——003 §13-6/8 埋点）；错误恢复口径统一（relay 崩溃、extension 断连、IAB renderer gone 三类都有用户可读状态）。
- **非目标**：不加新功能面；不含 L2/L3 数据的实际启用（那是 flag 门控的运行期决定）。
- **依赖**：Phase 3（可与 Phase 4 并行开始；隔离结果供 Phase 4 flag 门控消费）。
- **代码与文档模块**：CI 检查脚本（debug 端口、fuses）；`desktop/src/crash-reporting.ts`（暂名）；日志脱敏模块；指标埋点；隔离实施物与结论 `docs/verification/isolation.md`。
- **自动测试**：CI 安全检查本身；脱敏器对已知值形状的注入测试；崩溃上报载荷快照测试（断言无值字段）。
- **退出标准**：§5「GA 必须」全部 verified 或有 flag-off 豁免记录；崩溃报告三平台冒烟收到；003 §12 A1–A7 在隔离方案下通过，或明确记录「本版 GA 走 A 档，A1–A7 豁免」（§9 分档）。
- **人工测试**：`docs/manual-testing/phase-05-hardening.md`——断网/杀 relay/杀扩展下的恢复体验、崩溃上报后台抽查（含无值抽验）。
- **Checkpoint commit**：`chore(hardening): crash reporting with no values, CI guards, and the isolation verdict`
- **进度（如实记录）**：
  - **工程轨代码完成**（两个 commit）：CI 安全守卫（debug 开关源码扫描 + 打包期 Electron fuses 校验）；`core` 的秘密形状脱敏 `redactSecrets`/`redactDeep`（供日志与崩溃载荷共用，Luhn 判卡号以免误伤任务 id）；`desktop/src/crash-reporting.ts` 三层崩溃上报（本地、结构化、无值、记录不吞异常）；`server` 观测指标 `ObservabilityMetrics` + `GET /api/metrics`（takeover/secret_phase/卡片回退率，小样本 rate 为 null）；`desktop/src/recovery-status.ts` 统一恢复状态词表。结论见 [`docs/verification/phase-05.md`](../docs/verification/phase-05.md)。
  - **安全轨（隔离，决策点 D3）未决**：隔离方案未选型未实施，A1–A7 未跑；`vault.l2l3`/`secret_entry.live`/`payments.execute` 仍 fail-closed。裁决与选项记于 [`docs/verification/isolation.md`](../docs/verification/isolation.md)。这是 Phase 5 收尾与「含 L2/L3 的 GA」的前置。
  - **两处收尾项**（verification §8）：卡片回退率待自然语言确认路径接线后才有分母；统一恢复状态词表已交付，逐个 handler 渲染接线与 `browser.recovery.*` 文案待补。

### Phase 6 · 跨平台 Beta

- **目标**：三平台可安装、可自动更新、可回滚的 Beta。
- **范围**：打包与签名（沿用 `electron-builder.yml` publish:github、`desktop-build.yml`/`release.yml`、`scripts/package-release-bundles.sh`、macOS 签名公证既有链路）；自动更新升/降级实测 + beta/stable 双通道；**数据迁移**（`userData` schema 版本戳：vault 格式、tab checkpoint 格式；N→N+1 迁移与 N+1→N 兼容读）；支持矩阵定稿并写入 README 与安装器检查；M10/M11/M12 全平台复验；`test-installer.sh/ps1` 跑通（若仍引用 `packages/landing`，顺手拆掉那两处引用——001 §3 遗留项）。
- **非目标**：不加新功能；发现的功能缺陷回流为 Phase 7 修复项，不在本 Phase 展开。
- **依赖**：Phase 5。
- **代码与文档模块**：`desktop/src/data-migration.ts`（暂名）+ schema 版本常量；electron-builder 双通道配置；README 支持矩阵段；安装器测试脚本修订；`changelog/` Beta 版本目录。
- **自动测试**：迁移 N±1 往返自动化；安装器测试进 CI；更新元数据（latest.yml 等）生成校验；三平台构建矩阵绿。
- **退出标准**：三平台「安装→使用→自动更新→回滚」各一遍绿；迁移测试（含降级）自动化通过；Beta 构建分发给用户。
- **人工测试**：`docs/manual-testing/phase-06-beta.md`——三平台安装体验、更新弹窗、中文 IME/剪贴板/上传逐平台、屏幕阅读器逐平台。
- **Checkpoint commit**：`feat(release): signed cross-platform beta with migrating, rollback-safe auto-update`

### Phase 7 · 灰度与集中人工验收

- **目标**：真实使用暴露问题；清人工测试债。
- **范围**：灰度节奏（自用 → 小圈子 → 放开）由 flag + beta/stable 通道控制；生成并汇总 `docs/manual-testing/release-acceptance.md`（§4.3）；用户按册集中测试；FAIL→修复 commit→重测循环；观测指标复盘（takeover 率、回退率、崩溃率）。**功能冻结自本 Phase 起：只收修复。**
- **非目标**：不引入任何新特性或新 flag 默认开启。
- **依赖**：Phase 6。
- **代码与文档模块**：`docs/manual-testing/release-acceptance.md`；灰度 flag 配置；各修复 commit（携带回归测试）。
- **自动测试**：全量回归保持绿；每个修复项附带钉死该缺陷的回归测试。
- **退出标准**：release-acceptance 全部 critical = PASS；major 无未决或均有 WAIVED 记录；崩溃率与关键指标达 §9 阈值；无未修复的安全回归。
- **人工测试**：即本 Phase 的主体（release-acceptance.md 全册执行）。
- **Checkpoint commit**：`chore(release): rollout fixes — <n> manual findings closed`（按批次多次）

### Phase 8 · GA 发布

- **目标**：正式发布 1.0.0（档位按 §9：默认 A 档；B 档取决于 D3/D5）。
- **范围**：按 §9 DoD 清单逐项核验并留痕；`changelog/1.0.0/` 版本目录（沿既有 changelog 流程）与发布说明；`release.yml` 触发三平台签名产物；stable 通道推送；支持矩阵随发布公布；回滚预案（上一版产物保留 + 数据 N-1 兼容已验）确认就位；002 §11.3 / 003 §13 待验证项逐条关闭或降级为已记录的已知限制。
- **非目标**：任何新功能、任何 flag 默认值变更（除本次发布明确宣布开启的能力）。
- **依赖**：Phase 7 全部 critical `verified`；决策点 D5 go。
- **代码与文档模块**：`changelog/1.0.0/`、README 支持矩阵终稿、`docs/manual-testing/release-acceptance.md` 终版（全 PASS 存档）、发布说明。
- **自动测试**：发布流水线端到端演练一次（tag → 构建 → 签名 → 更新元数据 → 安装冒烟），产物哈希与元数据校验。
- **退出标准**：§9 DoD 八条全部勾选（按 A 或 B 档）；D5 通过；stable 通道更新在三平台各实收一次。
- **人工测试**：`docs/manual-testing/phase-08-ga.md`——正式发布产物三平台安装抽验；从 Beta 通道升级到 stable 的真实路径各一次。
- **Checkpoint commit**：`release: 1.0.0 — GA`

---

## 3. 协作治理

| 角色 | 承担者 | 职责 |
| --- | --- | --- |
| 开发 agent（cc） | **Fable 5**（当前会话）；Fable 不可用时 **Opus 5** | 按任务实现代码/文档 + 自动测试；产出完整 diff 与验收命令 |
| 主 agent | 用户或用户指定的编排会话 | 从本 Roadmap 拆任务（含验收标准）；**审查完整 commit diff（不抽样）**；独立执行验收；裁决 WAIVE |

**Push 协议**（每 Phase 一次 checkpoint，批次内允许多个中间 commit）：

1. cc 完成 → 全部自动测试绿 → **准备本地 checkpoint commit**（消息见各 Phase；遵循仓库 conventional 风格；附 `changelog/unreleased/` 条目）。**cc 的权限到此为止：可 commit 到本地，绝不执行 push。**
2. 主 agent 审查**完整 commit diff**（不抽样）+ 独立跑验收命令 → 批准或退回。
3. push 前 `git fetch`：**origin/main 有新提交或任何冲突 → 停止并上报**，由主 agent 决定处置。
4. 批准后由主 agent（或经主 agent 对该次 push 的明确授权）push origin main；**禁止 force push**。每个 checkpoint commit 必须**单独可回滚**：不跨 Phase 边界混改、flag 默认值保守（新能力默认 off 直至该 Phase 退出标准达成）。

---

## 4. 人工测试制度

### 4.1 原则

人工验证**不阻塞后续代码开发**。每 Phase 的人工项写入 `docs/manual-testing/phase-XX-<slug>.md`，初始状态 PENDING；对应代码合入后该 Phase 标记 `code_complete_manual_pending`。人工 FAIL 产出修复 commit 并回到 IN_TEST。**关键（critical）人工项未 PASS 不得 GA。**

### 4.2 用例模板与状态机

```markdown
## MT-<phase>-<nnn> <标题>
- 状态: PENDING | IN_TEST | PASS | FAIL | FIX_COMMITTED | WAIVED
- 严重度: critical | major | minor
- 关联: 002 §x / 003 §y / flag:<name> / 矩阵 M<n>
- 平台: macOS | Windows | Linux(X11) | Linux(Wayland)
- 前置: …
- 步骤: 1. … 2. …
- 预期: …
- 实测: （测试时填写；含 commit sha / 版本 / OS）
- 修复: commit <sha>（FAIL 时填写）
```

```
PENDING → IN_TEST → PASS
                  → FAIL → FIX_COMMITTED → IN_TEST（重测）
任意态 → WAIVED（仅 major/minor；需理由 + 主 agent 批准；critical 不可 WAIVED）
```

### 4.3 汇总

`docs/manual-testing/release-acceptance.md` 在 Phase 7 生成：聚合所有 phase 文件中 critical + 未 PASS 的 major 项，加发布级端到端场景（完整订一单、崩溃中断恢复、更新后数据完好）。它是 GA 门槛的唯一人工清单。

---

## 5. 安全分级（风险驱动，flag 控制）

| 项 | 级别 | flag / 门控 | 落点 |
| --- | --- | --- | --- |
| 付款前模型强制暂停 + 确认卡/明确对话（主交互层） | **GA 必须** | 无 flag，常开 | Phase 3 |
| 确定性 commitment/金额/商户/行程漂移兜底 | **GA 必须** | 常开 | Phase 3 |
| `import()` 逃逸删除、`process` 白名单（003 P0-B） | **GA 必须** | — | Phase 3 |
| 敏感一次性码在 secret_phase 就位前一律 human-only（§0.2 C5） | **GA 必须** | `secret_entry.live` 默认 off | Phase 3 起 |
| `--remote-debugging-port` 构建期硬检查 | **GA 必须** | CI | Phase 5 |
| 日志/崩溃报告无值（003 §4.6 不变量） | **GA 必须** | — | Phase 5 |
| L3 永不持久（CVV/OTP/密码/passkey） | **GA 必须** | 结构性，无开关 | Phase 3 起 |
| Vault（L1 投影） | 强烈建议 | `vault.enabled` | Phase 4 |
| `secret_entry.live`（main 代填真实一次性码） | 随 scoped secret_phase 全量验收（Phase 4）；**与真实 L2/L3 同门槛**——它处理真实 L3 材料，故依赖 `vault.l2l3`，运行期未隔离即强制 off | flag，默认 off | Phase 4 |
| **真实 L2/L3 + 存储支付凭证** | **启用即要求 003 §0.3 隔离 + A1–A7 攻击测试通过；做不到则 fail closed（能力关闭，功能不发布）** | `vault.l2l3`、`payments.execute`（运行期探测强制） | Phase 4 门控 / Phase 5 达标 |
| OS 级隔离（003 P0-A） | 含 L2/L3 的 GA **必须**；否则强烈建议 | 见上 | Phase 5 |
| broker IPC 全量（003 §11） | 随 L2/L3 | 同上 | Phase 4 |
| 脱敏 OCR 兜底 | 可延期 | `redaction.ocr` | Phase 5+ |
| 审计远端 append-only sink | 可延期 | `audit.remote` | GA 后 |
| hash-chain 审计（本地） | 强烈建议 | `audit.chain` | Phase 4 |

**要点**：浏览器主体（Phase 0–3）不被 003 的隔离前提阻断；隔离只门控「真实敏感数据与自动扣款」。fail-closed 的含义是**关能力不发布**，而不是降级成明文继续跑。

---

## 6. 发布工程

| 面 | 现状（已核实） | 待补 | 落点 |
| --- | --- | --- | --- |
| 签名包 | `electron-builder.yml`；macOS 签名+公证链路已通（随 001 基线带入）；`desktop-build.yml`/`release.yml` | Windows 签名证书接入；Linux AppImage/deb 复核 | 6 |
| 自动更新 | `updater.ts` + electron-updater + publish:github 元数据 | 升级/回滚实测；beta/stable 双通道 | 6 |
| 数据迁移 | 无版本戳 | `userData` schema 版本（vault/checkpoint 格式）+ N±1 兼容 | 6 |
| feature flags | 无 | Phase 0 骨架；§5 全部受控项挂接 | 0 起 |
| 观测/崩溃报告 | 无 | 三进程层崩溃上报（无值）；关键行为指标 | 5 |
| 日志脱敏 | 无 | 003 §4.6 不变量的实现 + 注入测试 | 5 |
| 回滚 | electron-updater 支持装旧版 | 数据格式 N-1 兼容读；发布页保留上一版 | 6 |
| 支持矩阵 | 未定稿 | Phase 6 定稿并写入 README/安装器 | 6 |
| changelog | `changelog/` 版本目录 + unreleased 流程已在 | 每 checkpoint commit 附条目 | 全程 |

---

## 7. 状态定义

| 状态 | 含义 | 谁流转 |
| --- | --- | --- |
| `planned` | 已规划未开工 | 主 agent |
| `in_progress` | cc 开发中 | cc |
| `code_complete_manual_pending` | 自动验收绿、已 push；人工项 PENDING | 主 agent（审查通过时） |
| `verified` | 该 Phase 人工 critical 全 PASS | 主 agent |
| `released` | 该 Phase 能力随正式版发布且 flag 默认开启 | 主 agent（发布时） |

Phase 允许长期停在 `code_complete_manual_pending`——这正是「人工测试可延后」的机制表达；但 §9 要求 GA 前全部关键项抵达 `verified`。

---

## 8. 工期、关键路径、并行与风险

**关键路径**：0 → 1 → 2 → 3 → 5 → 6 → 7 → 8，代码工期合计约 **42–66 个工作日**；日历上因人工测试与灰度约 **3–5 个月**。

**可并行**：Phase 4 的 Vault 核心/判定器（纯函数居多）可在 Phase 2 后并行开发（dummy 数据）；Phase 5 工程轨（崩溃报告、日志）可与 Phase 4 并行；人工测试始终与下一 Phase 开发并行；`docs/` 与 SKILL.md 更新随各 Phase。

**风险登记**：

| # | 风险 | 概率/影响 | 缓解 | 关联决策 |
| --- | --- | --- | --- | --- |
| R1 | IAB 指纹被携程等风控识别 | 中/高 | Phase 0 早验；UA 覆写；extension 后端兜底（M7） | D2 |
| R2 | Playwright 与 Electron target 语义不合 | 中/中 | Phase 0 验证；relay 合成层可改 | D1 |
| R3 | 隔离方案代价过高（安装权限/体验） | 中/高 | 三方案并评（独立用户/容器/VM）；不达标则 GA 走 A 档 | D3 |
| R4 | 系统钱包在 WebContentsView 不可用 | 中/中 | 003 §9.1 优先级退化到 PSP/手输；Phase 4 早验 | D4 |
| R5 | 人工测试债堆积 | 高/中 | §4 制度化；每 Phase 文件即建；Phase 7 专清 | — |
| R6 | 单开发 agent 带宽 | 中/中 | 并行轨最小化耦合；主 agent 拆任务粒度控制 | — |
| R7 | 引擎冻结错过上游修复 | 低/中 | 001 §3 既定策略：需要时 cherry-pick | — |

**决策点**：D1（Phase 0 后：target 语义结论 → 是否需要对 002 §4.2 实现细节发起单独文档修订）；D2（Phase 0/1：IAB 反爬实测 → extension 后端权重与默认值）；D3（Phase 5 前：隔离方案选型 → GA 档位，即 §9）；D4（Phase 4 内：钱包可用性 → 支付路径优先级）；D5（Phase 7 末：GA go/no-go）。

---

## 9. GA Definition of Done

GA 分两档，**默认走 A 档，B 档取决于 D3**：

- **A 档（不含真实 L2/L3 存储）**：Vault 仅 L1 或 dummy；付款终态为「停在支付页 / 用户在场自行完成」；`vault.l2l3`、`payments.execute`、`secret_entry.live` 保持 off。
- **B 档（全量）**：A 档 + 隔离达标 + 003 §12 A1–A7 通过 + L2/L3、`secret_entry.live` 与 `execute_payment` 开启。

**两档共同的 DoD 清单**：

1. §1 矩阵 M1–M13 全行 `verified`（M14 按档：A 档到确认卡与兜底，B 档到 capability 执行）。
2. `release-acceptance.md` 全部 critical PASS；major 无未决（或 WAIVED 有记录）。
3. §5 「GA 必须」全部落地并有测试证明；A 档需另证明 L2/L3 探测失败/关闭路径工作正常且 UI 明示。
4. 三平台签名安装包 + 自动更新升/降级实测 + 数据迁移含回滚测试绿。
5. 崩溃率与关键指标达灰度期设定阈值；崩溃报告经抽查无任何值泄漏。
6. 002 §11.3 与 003 §13 的待验证项全部关闭或降级为已记录的已知限制。
7. `changelog/` 发布目录齐备；支持矩阵公布；回滚预案演练过一次。
8. 全部 push 历史无 force push；每 checkpoint 可独立回滚已抽验一次。

---

## 附：Phase ↔ 002/003 阶段映射

| Roadmap | 002 | 003 |
| --- | --- | --- |
| 0 | P0 | P0-C（探测部分） |
| 1 | P1+P2 最小并集 | — |
| 2 | P1/P2 全量 + P4 | — |
| 3 | P3 + P5 前半 | §7 交互层（`secret_entry` 仅契约+dummy，live 关闭）+ P0-B + §8.1/§8.5 规则先行 |
| 4 | P5 后半 | P0-C/D、P1–P5 全量（含 scoped secret_phase 完整版） |
| 5 | — | P0-A（隔离）+ §12 A1–A7 |
| 6–8 | — | —（发布工程为本文档新增轨道） |
