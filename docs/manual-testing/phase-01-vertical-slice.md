# Phase 1 — manual verification

Template and status machine: [`_template.md`](./_template.md). Evidence and automated results:
[`../verification/phase-01.md`](../verification/phase-01.md).

The Phase 1 host was headless (Xvfb), with no input method and no display, so everything below needs
a real window and a person. The automated and live-site criteria did pass there — navigation,
snapshot, `clickThrough`, `fillWithSuggestion` and `pickDate` all ran against the real Ctrip hotel
form (verification §2).

**MT-01-001 is named in Phase 1's own exit criteria.** Until it passes, the phase stays
`code_complete_manual_pending` and `iab.enabled` stays off by default.

Run these with the pane switched on:

```bash
PENGUIN_FLAGS=iab.enabled pnpm desktop
```

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| MT-01-001 | Chinese IME types into the in-app browser | critical | PENDING |
| MT-01-002 | The user can click and scroll the real page | critical | PENDING |
| MT-01-003 | The pane tracks the layout while the window resizes | major | PENDING |
| MT-01-004 | Agent and user see the same page | major | PENDING |
| MT-01-005 | The pane is absent in a browser tab | major | PENDING |
| MT-01-006 | The pane is absent when the flag is off | major | PENDING |
| MT-01-007 | The splitter drags and takes the keyboard | major | PENDING |
| MT-01-008 | The extension still works with the pane off | critical | PENDING |

---

## MT-01-001 Chinese IME types into the in-app browser
- 状态: PENDING
- 严重度: critical
- 关联: 004 Phase 1 exit criteria / 矩阵 M10 / verification §6
- 平台: macOS | Windows | Linux(X11)
- 前置: `PENGUIN_FLAGS=iab.enabled pnpm desktop`；系统已安装中文输入法
- 步骤:
  1. 点工具栏「浏览器」打开右侧面板
  2. 让 agent 打开 `https://hotels.ctrip.com/`，或在面板里等它自己导航
  3. 切到中文输入法，直接点页面上的「目的地」输入框
  4. 输入「东京」，观察候选词浮层与最终落字
- 预期: 候选词浮层正常出现在输入框下方；确认后输入框内是「东京」；站点自己的自动补全建议随之弹出
- 实测: （未执行 —— Phase 1 主机无显示器、无输入法）
- 修复: —

## MT-01-002 The user can click and scroll the real page
- 状态: PENDING
- 严重度: critical
- 关联: 002 §2 / 矩阵 M2 / M5
- 平台: macOS | Windows | Linux(X11)
- 前置: 同上，面板已打开并加载了携程酒店页
- 步骤:
  1. 用鼠标滚轮在右侧页面上滚动
  2. 点击页面上的一个链接或按钮（例如导航栏的「机票」）
  3. 在页面上右键，确认出现的是页面自身的上下文菜单
  4. 选中一段文字并复制，粘贴到左侧对话输入框
- 预期: 滚动、点击、右键、复制粘贴全部与普通浏览器一致；不是截图、不是只读画面
- 实测: （未执行）
- 修复: —

## MT-01-003 The pane tracks the layout while the window resizes
- 状态: PENDING
- 严重度: major
- 关联: 002 §5.1 / src/browser-pane-layout.ts
- 平台: macOS | Windows | Linux(X11)
- 步骤:
  1. 打开面板，拖动窗口边缘缓慢改变窗口大小
  2. 最大化窗口，再还原
  3. 把窗口拖到很窄（小于约 1024px），观察面板行为
  4. 折叠/展开左侧侧栏
- 预期: 视图始终贴合右栏，不越界、不遮住左侧对话或输入框；窄窗口下面板整体隐藏而不是留下一条细缝；拖动过程中最多有轻微滞后，没有明显撕裂
- 实测: （未执行）
- 修复: —

## MT-01-004 Agent and user see the same page
- 状态: PENDING
- 严重度: major
- 关联: 004 Phase 1 目标 / 矩阵 M5
- 平台: macOS | Windows | Linux(X11)
- 前置: 面板已打开
- 步骤:
  1. 在左侧对话里让 agent 打开携程酒店页并填写目的地「东京」
  2. 全程盯着右侧面板
  3. agent 完成后，自己在同一页面上手动改一个字段
- 预期: agent 的导航与输入在右侧实时可见；随后用户的手动修改也在同一页面上生效——两者操作的是同一个页面，不是两份
- 实测: （未执行）
- 修复: —

## MT-01-005 The pane is absent in a browser tab
- 状态: PENDING
- 严重度: major
- 关联: src/lib/desktop-bridge.ts / verification §4
- 平台: macOS | Windows | Linux(X11)
- 步骤:
  1. `pnpm dev` 起 server + web
  2. 用普通浏览器打开 `http://localhost:5173`（或 dev server 实际端口）
  3. 进入对话页，检查工具栏
- 预期: 工具栏上**没有**「浏览器」按钮，也没有空白右栏——纯 web 部署无主进程可承载视图，能力应当整体缺席而不是显示为禁用
- 实测: （未执行）
- 修复: —

## MT-01-006 The pane is absent when the flag is off
- 状态: PENDING
- 严重度: major
- 关联: 004 §5 / flag:iab.enabled
- 平台: macOS | Windows | Linux(X11)
- 步骤:
  1. `pnpm desktop`（**不带** `PENGUIN_FLAGS`）
  2. 进入对话页，检查工具栏
  3. 检查 relay 日志，确认没有 `/iab` 连接
- 预期: 没有「浏览器」按钮；主进程未创建任何 WebContentsView；relay 上没有 IAB backend 注册。能力是真的没装配，不只是界面藏起来
- 实测: （未执行）
- 修复: —

## MT-01-007 The splitter drags and takes the keyboard
- 状态: PENDING
- 严重度: major
- 关联: browser-pane-split.ts / 矩阵 M1
- 平台: macOS | Windows | Linux(X11)
- 前置: `PENGUIN_FLAGS=iab.enabled pnpm desktop`，面板已打开
- 步骤:
  1. 用鼠标拖动左右两栏之间的分隔线，来回若干次
  2. 拖到最左、最右，观察是否被限制住
  3. 点一下分隔线让它获得焦点，按左右方向键、PageUp/PageDown、Home/End
  4. 打开屏幕阅读器，聚焦分隔线
- 预期: 拖动时浏览器视图实时跟随，无明显滞后或撕裂；两端都停在合理位置（对话栏和浏览器都还能用）；键盘可调节；屏幕阅读器把它读成 separator 并播报当前百分比
- 实测: （未执行 —— Phase 1 主机无显示器）
- 修复: —

## MT-01-008 The extension still works with the pane off
- 状态: PENDING
- 严重度: critical
- 关联: browser-relay.ts planRelay / 004 §5
- 平台: macOS | Windows | Linux(X11)
- 前置: 已装 Penguin Browser 扩展；**先**在终端跑 `penguin-browser serve`，占住 19989
- 步骤:
  1. `pnpm desktop`（**不带** `PENGUIN_FLAGS`，即面板关闭）
  2. 看日志，确认写的是「复用已有 relay」而不是另起一个
  3. 在 Chrome 里点扩展图标授权一个标签页
  4. 让 agent 用扩展模式驱动那个标签页
  5. 关掉桌面 app，确认终端里那个 relay 还活着
- 预期: 桌面 app 不另起 relay，也不杀掉已有的；扩展与 agent 都走同一个 19989，功能与本次改动前一致；退出时不影响别人的进程
- 实测: （未执行 —— 需要真实 Chrome 与扩展）
- 修复: —
