# Codex 风格单窗口 IAB：内嵌浏览器工作区与统一 BrowserBackend

| | |
| --- | --- |
| 状态 | **架构方向定稿，待 P0 验证**（§11.3 尚有 6 项待验证，其中第 1 项可能改变 `tabs.open()` 的实现路径）。**涉及个人资料与支付的能力另受 003 §0.3 的 OS 级隔离硬前提阻塞** |
| 日期 | 2026-08-15 |
| 基线 | travel-agent `8cead1d` · Electron 43.2.0 · pnpm 11.18 |
| 目标 | **单一 Travel Agent 应用窗口**：左侧对话，右侧内嵌真实可交互浏览器（IAB），中间可拖动分隔线 |
| 明确不是 | 不是 screencast / 截图镜像；不是外部 Chrome 与本应用并排的双窗口 |
| 关系 | 补充 `001-architecture.md`（其 §2.2 一条论断需修订，见 §11.1）；**人工介入部分由 [`003-agent-first-private-profile-and-payment-confirmation.md`](./003-agent-first-private-profile-and-payment-confirmation.md) 取代，见 §0.5** |

---

## 0. Supersedes：这份文档取代了什么

### 0.1 被取代的两版方案

定稿前有过两版错误方向。记下来是因为**否掉它们的理由构成了本方案的边界**。

| 版本 | 主张 | 为什么错 |
| --- | --- | --- |
| 初版 | screencast 把用户真实 Chrome 的画面镜像进 Electron 面板 | 镜像出来的是像素。中文输入法不可用、文件上传做不到、滑块验证码是合成轨迹、**无障碍归零**。它解决的是「看」，而需求是「真实可交互」 |
| 二版 | 放弃嵌入，改为本应用窗口与用户真实 Chrome 做 OS 级左右平铺（双窗口并排） | 不是产品要的形态——目标是 Codex 风格的**单一应用窗口**。且 Wayland 协议禁止客户端定位窗口，两个窗口的 Alt-Tab 与跨屏行为也无法统一 |

### 0.2 这两版方案的载体，以及建议如何处理

**两版都没有写进本仓库。** 它们只存在于一个对话期间发布的 Artifact 页面：

- 标题「镜像与接管」→ 后被就地改为「并排与接管」（同一 URL，v2 覆盖 v1）
- URL：`https://claude.ai/code/artifact/83ecf9b3-954d-4e0e-9d15-82c25d8ea255`
- 仓库内**没有**对应文件。`design/` 下只有 `001-architecture.md`（先于本次会话存在）与本文件。

因此**没有任何需要删除的仓库文件**，也不存在误删用户文件的风险。建议按以下方式处置那个 Artifact，三选一：

| 方案 | 操作 | 适用 |
| --- | --- | --- |
| **推荐** 就地作废 | 在该 Artifact 页面顶部加一段作废声明，指向本文件路径 | 想保留决策过程的痕迹，避免以后有人翻到它并当成有效方案 |
| 删除 | 在 claude.ai 的 Artifact 列表里删掉 | 认为过程记录没有保留价值 |
| 原样留着 | 不动 | 仅当确定不会再有人打开它 |

**不建议把那两版内容搬进 `design/`。** 它们的结论已被本文件 §0.1 完整吸收，正文本身没有独立价值，留在 `design/` 只会制造「哪份是当前方案」的歧义。

### 0.3 本文件的定位

`design/002-codex-style-single-window-iab.md` 是**浏览器工作区的唯一当前设计**。

规则：**浏览器工作区本身的方案变化，就地修订本文件**并在 §0.1 的表里追加一行，不要为同一主题新开编号。

跨越到另一个设计边界的主题应当独立成文——`003-agent-first-private-profile-and-payment-confirmation.md` 就是这样一份：它的主题是**隐私数据与交易授权**，与浏览器工作区正交（换掉浏览器方案它依然成立），因此独立编号不违反上面这条规则。两份文档通过 §0.5 与 003 §0.2 双向引用保持一致。

---

### 0.5 本文档中被 003 取代的部分

产品目标已改为 **Agent-first：尽量不让用户接管整个浏览器**。[`003-agent-first-private-profile-and-payment-confirmation.md`](./003-agent-first-private-profile-and-payment-confirmation.md) 是隐私资料与付款确认的独立详细设计，并**取代本文档中「默认完整 `user_control`」的部分**。

| 本文档原设计 | 003 修订为 |
| --- | --- |
| §6.5 `user_control`（用户完整接管浏览器）是与 `agent_control` 并列的常规状态 | 仅由 `browser_takeover` 触发，**last resort**，需记录理由 |
| §5.3 / §8.3 `requestHelp` 是标准移交入口 | `requestUserInteraction` 六类，**只有 `human_challenge` 与 `browser_takeover` 会碰浏览器** |
| 用户在 IAB 页面里输入敏感值 | 敏感值在左侧卡片的安全输入框内输入；**输入值不经 agent / server / SSE**，必要时在 `secret_phase` 内由 Electron main 原子 fill + submit，**字段未证明清空前不恢复 agent**（003 §7.3） |

保留的 human-only 流程（003 §0.2）：滑块/图形验证码、系统钱包确认、passkey/生物识别、站点强制的真实点击、以及兜底接管。除这五类外，「让用户自己去点浏览器」视为设计缺陷。

**另有一条 003 认定的 P0 硬前提影响本文档的实施顺序 —— 且它比「加固沙箱」更根本。**

`exec_command` 是不受限的 `bash -lc`，且**与 Electron 应用同一 OS 用户**。因此 agent 可以读写 `userData`、探测 broker IPC socket、修改应用二进制，部分平台还能调试同用户进程或走 UI 自动化。

**「Electron main 是 agent 无法触及的可信进程」这个说法不成立。** 删除 `executor.ts:1850` 的 `import()` 逃逸只是修一个漏洞，不能建立信任边界。

真正的边界必须在操作系统层：agent / server / relay 运行于独立低权限用户、容器或 VM，只允许 workspace 白名单与一条能力化 broker 通道，禁止访问 userData、keychain、应用二进制、主进程 IPC 与其他进程（调试 / ptrace / UI 自动化）。**未满足时 Vault 只能标注为「防误泄漏」，L2/L3 一律停用；开发模式默认 dummy vault。** 完整要求与攻击测试验收见 003 §0.3、§2 T0、§12。

对本文档的影响：把浏览器工作区做出来（P1–P4）不受这条阻塞；**但一旦要接入真实证件号或支付凭证，隔离必须先落地。**

---

## 0.4 定稿方向与第一条硬约束

**右侧是 Electron 自己渲染的真实网页（IAB），不是镜像，不是外部窗口。**

由此得到的第一条硬约束：**IAB 用的是 Electron 自带的 Chromium 与独立的 session 分区，拿不到用户 Chrome 里的登录态。** 这不是可以绕过的实现细节，它决定了本方案必须保留 penguin-browser 的外部 Chrome 后端作为第二条路，也决定了 §7 那条切换边界。

---

## 1. 现状分析

### 1.1 Electron 外壳

`packages/desktop`，Electron 43.2.0，2090 行。

| 事实 | 位置 | 对本方案的意义 |
| --- | --- | --- |
| 单个 `BrowserWindow`，加载 `http://localhost:<serverPort>` | `src/main.ts:59` | IAB 视图要作为这个窗口的子视图挂上去 |
| **`sandbox: true` / `contextIsolation: true` / `nodeIntegration: false`，无 preload、无 IPC 通道** | `src/main.ts:69`，注释「every capability flows through the server's HTTP API」 | **必须修改。** 见 §5 |
| server 作为 `utilityProcess` fork，端口动态 | `src/server-process.ts` | 不变 |
| relay 作为 `utilityProcess` fork，端口硬编 `19989` | `src/browser-relay.ts:16` | 端口常量需要在 desktop / server 之间共享 |
| 窗口尺寸、位置相关 API 出现次数 **0** | `grep setBounds\|getBounds\|screen\.` | 布局逻辑全部是新增 |
| `setWindowOpenHandler` 已有 app-origin 白名单策略 | `src/main.ts:85` | IAB 的弹窗策略要单独一套，不能复用 |

### 1.2 penguin-browser 控制链路

关键发现：**relay 已经有后端概念，而且是三个。**

`cdp-relay.ts` 的 `POST /cli/session/new`（`:2275`）按 body 分派：

| mode | 触发条件 | executor 侧 | 位置 |
| --- | --- | --- | --- |
| `headless` | `body.headless` | `chromium.launch()` | `executor.ts:841` |
| `direct` | `body.cdpEndpoint` | `chromium.connectOverCDP(url)` | `executor.ts:857-860` |
| `extension` | 默认 | 经 `/extension` WS 隧道 | `executor.ts` 其余分支 |

`CdpConfig`（`executor.ts:304-313`）就是这个抽象的现有形态。**统一 `BrowserBackend` 不是从零发明，是把第四个 mode 加进一个已存在的分派点。**

扩展与 relay 之间的协议薄得出乎意料（`protocol.ts:5-40`）：

```ts
type ExtensionCommandMessage = { id, method: 'forwardCDPCommand', params: { method, sessionId?, params? } }
type ExtensionEventMessage   = { method: 'forwardCDPEvent',   params: { method, sessionId?, params? } }
```

就是一条 CDP 隧道。扩展侧把它落到 `chrome.debugger.sendCommand`（`background.ts:60`）。
**Electron 主进程可以用 `webContents.debugger` 落同一条协议**——这是 §4 选型的基础。

### 1.3 已有且在 IAB 下继续可用的能力

| 能力 | 位置 | IAB 下 |
| --- | --- | --- |
| ARIA 快照 / 截图 / 清洗 HTML / Markdown | `aria-snapshot.ts` `clean-html.ts` `page-markdown.ts` | ✅ 纯 CDP + 页内注入 |
| 通用交互原语 | `interaction.ts`（`clickThrough` / `fillWithSuggestion` / `pickDate` / `submitAndClassify` / `classifyOutcome`） | ✅ 纯 Playwright API |
| 人工移交 | `request-help.ts` + `help-overlay-client.ts` | ✅ 页内浮层机制可用，但**适用范围按 003 收窄为 `human_challenge` / `browser_takeover` 两类**；其余四类改走左侧卡片 |
| 可见光标 | `ghost-cursor*.ts` | ✅ 页内注入 |
| tab 归属锁 | `tab-ownership.ts` | ✅ 按 CDP target id 键控，IAB 的 WebContents 同样有 target id |
| 事务层四件套 | `packages/transaction` | ✅ 与浏览器无关。**但至今无调用方** |
| 代表集 / 对齐 / 下单守卫 | `packages/travel-domain` | ✅ 同上 |

### 1.4 前后端消息链路

```
Agent ──exec_command(bash -lc)──> penguin-browser CLI ──HTTP──> relay:19989 ──WS──> 扩展 ──chrome.debugger──> Chrome
                                                                    ▲
web(renderer) ──HTTP/SSE──> penguin-server ──────────────────────╳  当前无连接
```

- SSE 基础设施完备：`server/src/http/sse.ts`（心跳 20s、`Last-Event-ID` 重放、`resync_required`）、`runtime/channel.ts`（环形缓冲 10k/8MB）。
- `ServerEvent` 判别联合在 `server/src/api/types.ts:1066`，新增事件类型在此处扩展。
- **`packages/server` 与 `packages/web` 中 penguin-browser / 19989 的引用数为 0。**
- 右侧停靠面板的外壳现成：`use-panel-width.ts`（模块级 store + `useSyncExternalStore`，拖拽调宽、跨面板共享宽度、持久化）、`use-files-panel.ts` / `use-subagents-panel.ts`（1024px 断点降级 Drawer，两面板互斥，协调逻辑在 `chat-page.tsx:331-360`）。

### 1.5 tab 与 session 模型

三个正交概念，本方案不合并它们：

| 概念 | 位置 | 语义 |
| --- | --- | --- |
| `tabRegistry` | `tab-ownership.ts:202`，relay 进程内单例 | 跨 session 的建议性归属，防两个 agent 写同一页 |
| `syncTabGroup` | `background.ts:1012` | Chrome 侧按窗口一个 cyan 组，成员是**已连接**的 tab |
| 任务级 tab 生命周期 | **不存在** | 见 §6.4——IAB 把它从「对外部 Chrome 的不可控清理」变成「应用拥有、可确定管理的生命周期」，仍需显式定义策略 |

---

## 2. 目标 UI

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ≡  travel-agent                                            ─  □  ✕      │
├───────┬─────────────────────────────────┊───────────────────────────────┤
│       │                                 ┊ ┌──────┬──────┬──────┐  ⊕     │
│ 侧栏  │  会话 / 计划 / 工具执行过程     ┊ │ 携程 │ 飞猪 │ 东航 │        │ ← 我们画的 tab strip
│ (可   │  确认卡片 / 代表集             ┊ ├──────┴──────┴──────┴────────┤
│  折叠)│                                 ┊ │ ← → ⟳ │ hotels.ctrip.com  │ ← 我们画的地址栏
│       │                                 ┊ ├─────────────────────────────┤
│       │                                 ┊ │                             │
│       │                                 ┊ │   WebContentsView           │
│       │                                 ┊ │   真实可交互网页            │
│       │                                 ┊ │   用户可点击/输入/拖滑块     │
│       │                                 ┊ │   agent 通过 CDP 操作        │
│       │                                 ┊ │   ↖ ghostCursor 可见         │
│       │  ┌───────────────────────────┐  ┊ │                             │
│       │  │ 确认付款                  │  ┊ │  ┌─────────────────────┐    │
│       │  │ 携程 · MU5137 · ¥1280    │  ┊ │  │ 请拖动滑块完成验证  │    │
│       │  │ CVV [___]   [确认] [取消] │  ┊ │  └─────────────────────┘    │
│       │  └───────────────────────────┘  ┊ │   ↑ 只有 human_challenge     │
│       │        ↑ 敏感值在这里输入        ┊ │     与兜底接管才注入页面      │
│       │          直达 main，不经页面     ┊ │                             │
└───────┴─────────────────────────────────┴─┴─────────────────────────────┘
                                          ↑
                                    可拖动分隔线
```

关键点：

1. **tab strip 与地址栏是我们用 HTML 画的**，不是 Chrome 的原生控件。它们位于 WebContentsView 上方的独立区域（相邻，不重叠）。
2. **WebContentsView 是真实网页**，用户可以直接点击、用中文输入法打字、拖滑块、上传文件、使用系统屏幕阅读器。
3. `ghostCursor` 注入在页面内部，在 IAB 中原样可用。页面内浮层按 003 收窄为只服务 `human_challenge` 与 `browser_takeover`。
4. **信息补充、方案选择、付款确认、敏感值输入全部在左侧卡片完成**，用户不碰浏览器（003 §7）。敏感值经 preload 具名通道直达 Electron main，**不经 agent / server / SSE**；填写本身发生在 `secret_phase` 内（agent 轮次暂停 + 该 target 的 CDP capability detach），由 main 原子 fill + submit，**字段未证明清空前不恢复 agent**（003 §7.3）。优先走 PSP hosted field / 系统钱包等根本不进入我们可填 DOM 的路径。
5. 面板可折叠 / 展开 / 全屏；宽度可拖动并持久化。

---

## 3. 架构总览

```
┌─ Electron 主进程 (Node) ────────────────────────────────────────────────┐
│                                                                         │
│  BrowserWindow                                                          │
│   ├── contentView (renderer)  ← penguin-web，sandbox，窄 preload         │
│   └── WebContentsView[]       ← IAB 页面，独立 session 分区，无 preload   │
│         │                                                               │
│         │ webContents.debugger（控制面）                                 │
│         │ webContents 事件（状态面）                                     │
│         ▼                                                               │
│  BrowserPaneManager ──WS /iab──> relay                                  │
│                                                                         │
│  utilityProcess: penguin-server                                         │
│  utilityProcess: penguin-browser relay :19989                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                   WS /iab                 WS /extension
                   (新增)                   (已有)
                        │                       │
                 IAB WebContents          用户的 Chrome
                 默认后端                  切换后端
```

**两个平面必须分开，这是本设计最重要的结构决定：**

| 平面 | 方向 | 路径 | 理由 |
| --- | --- | --- | --- |
| **控制面** | agent → 页面 | relay → `/iab` WS → `webContents.debugger` | 复用 relay 的全部 executor / Playwright 机制，agent 侧 API 一字不改 |
| **状态面** | 页面 → UI | Electron 主进程事件 → IPC → renderer | `did-navigate` / `page-title-updated` / `did-start-loading` 在主进程直接可得，**不必绕 relay**，延迟最低，且 relay 崩溃时状态栏仍然准确 |

二版方案曾把状态面也塞进 relay，那是多余的一跳。IAB 下页面就在本进程里，主进程本来就知道它在干什么。

---

## 4. BrowserBackend 抽象与传输选型

### 4.1 抽象落点

不新建抽象层，扩展已有的分派点：

```ts
// executor.ts —— 现有
export interface CdpConfig {
  host?: string; port?: number; token?: string; extensionId?: string | null
  directCdpUrl?: string
  headless?: boolean
  iab?: { paneId: string }        // ← 新增
}

// cdp-relay.ts POST /cli/session/new —— 现有分派点加一支
type SessionMode = 'iab' | 'extension' | 'direct' | 'headless'
```

对 agent 完全透明：`penguin-browser session new` 的返回多一个 `mode: 'iab'`，`-e '<js>'` 的 API 表面（`page` / `tabs` / `snapshot` / 交互原语）一字不变。唯一变化来自 003：`requestHelp` 重构为 `requestUserInteraction`，且新增 `secure_fill` / `execute_payment` 两个 builtin tool（不在 executor 的 vm 作用域里，理由见 003 §6.2）。

### 4.2 传输：三个候选，一个被否决

**候选 A — Electron 开 `--remote-debugging-port`，走现有 `direct` 模式。**

诱惑很大：**relay 与 executor 零改动**，`chromium.connectOverCDP()` 直接连上，Playwright 立刻能驱动 WebContentsView。

**否决。** Chromium 的远程调试端口**没有任何认证**，而它暴露的不只是 IAB——**还包括承载用户已登录 app 会话的主窗口**。任何本地进程都能连上去读走 cookie、token、请求头，并完全控制这个正在替用户订票付钱的应用。这是 Electron 安全文档与所有渗透测试指南都明确列出的高危项：production 构建不得携带 `--remote-debugging-port`。

对一个花用户真金白银的应用，这条不是「安全债」，是不能上线的缺陷。**仅允许作为 §9 P0 的开发期验证手段，且必须由 fuse / 构建检查确保它进不了签名包。**

**候选 B — 主进程自建 CDP-over-WS 服务，relay 仍走 `direct` 模式。**

安全性合格（路径带 secret、校验 Host/Origin），relay 零改动。代价是**主进程要自行合成浏览器级 target 语义**（`Target.getTargets` / `setAutoAttach` / `attachToTarget` / `Browser.getVersion`），才能让 `connectOverCDP` 满意。而这正是难点。

**候选 C — 主进程接入 relay 的 `/iab` WS，复用既有隧道协议。✅ 选定**

relay 已经在为扩展做同一件事：它把「每个 tab 一个 `chrome.debugger` 会话」合成为一个浏览器级 target 树（`cdp-relay.ts` 里 `isRestrictedTarget`、target 过滤、事件转发共约 2800 行）。**这套合成逻辑对 IAB 同样适用**，因为两边的输入形状一样：一组独立的 debugger 会话 + `forwardCDPCommand` / `forwardCDPEvent`。

主进程侧因此只需一个薄适配器：

```ts
// desktop/src/iab-transport.ts
ws.on('message', ({ id, method, params }) => {
  if (method !== 'forwardCDPCommand') return
  const contents = resolveContents(params.sessionId)   // targetId → WebContents
  contents.debugger.sendCommand(params.method, params.params)
    .then(result => ws.send({ id, result }))
    .catch(error => ws.send({ id, error: String(error) }))
})
contents.debugger.on('message', (_e, method, params, sessionId) =>
  ws.send({ method: 'forwardCDPEvent', params: { method, params, sessionId } }))
```

一句话概括选型：**IAB 就是「用 Electron 主进程实现的一个扩展」。**

### 4.3 `/iab` 端点的认证

`/extension` 端点强制要求 `origin` 为 `chrome-extension://<已知 id>`（`cdp-relay.ts:1570-1583`），Node 客户端一律 403。因此需要新端点而非复用：

- 仅接受 loopback 远端地址（复制 `/extension` 的 `getConnInfo` 检查）。
- 携带**共享密钥**：desktop 在 `startBrowserRelay()` fork relay 时通过 env 注入一次性随机串，IAB 传输层在 WS 查询参数里回传。密钥不落盘、不进日志。
- 一次只允许一个 IAB 连接（一个 app 实例一个主进程）。

---

## 5. IPC 与安全边界

### 5.1 必须打破「无 preload」纪律，但打破得要窄

`main.ts:70` 那条注释是有道理的：窗口是纯浏览器，一切能力走 server HTTP API。但 WebContentsView 的**位置与尺寸由主进程持有**，renderer 无法用 CSS 摆放它。没有 IPC 就没有 IAB。

替代方案都更差：让 renderer 经 server 再回到主进程，会给分隔线拖动引入一整个 HTTP 往返；`<webview>` 标签能免掉布局 IPC，但 Electron 官方长期不推荐、性能更差，且仍需主进程 attach debugger。

**结论：加一个能力受限的 preload，只挂在主窗口，不挂在任何 IAB 视图上。**

```ts
// desktop/src/preload-browser.ts
contextBridge.exposeInMainWorld('travelAgentBrowser', {
  // renderer → main：只传语义参数，不传任意对象
  setLayout: (ratio: number, chromeHeight: number) => ipcRenderer.invoke('iab:layout', ratio, chromeHeight),
  setVisible: (visible: boolean) => ipcRenderer.invoke('iab:visible', visible),
  setOccluded: (occluded: boolean) => ipcRenderer.invoke('iab:occluded', occluded),
  openTab: (url?: string) => ipcRenderer.invoke('iab:tab:open', url),
  closeTab: (id: string) => ipcRenderer.invoke('iab:tab:close', id),
  activateTab: (id: string) => ipcRenderer.invoke('iab:tab:activate', id),
  navigate: (id: string, url: string) => ipcRenderer.invoke('iab:navigate', id, url),
  goBack: (id: string) => ipcRenderer.invoke('iab:back', id),
  goForward: (id: string) => ipcRenderer.invoke('iab:forward', id),
  reload: (id: string) => ipcRenderer.invoke('iab:reload', id),
  requestControl: (mode: 'agent' | 'user') => ipcRenderer.invoke('iab:control', mode),
  // main → renderer：状态面
  onState: (cb: (state: PaneState) => void) => { /* ipcRenderer.on('iab:state', …) */ },
})
```

三条纪律：

1. **没有通用 `invoke(channel, ...args)`**。每个能力一个具名通道，穷举。
2. **主进程侧全部校验**：`ratio` 必须是 `[0.2, 0.8]` 的有限数，`url` 必须是 `http:` / `https:`（拒绝 `file:` / `chrome:` / `javascript:`），tab id 必须在本进程持有的集合里。校验不通过就抛，不做「宽容处理」。
3. **preload 只给主窗口**。IAB 视图的 `webPreferences` 里 `preload` 必须为空——那里跑的是携程的代码。

### 5.2 IAB 视图的 webPreferences

渲染的是不受信任的第三方站点，且与用户的订单、支付共处一个应用窗口。以下每一项都不可协商：

```ts
new WebContentsView({
  webPreferences: {
    session: session.fromPartition('persist:travel-iab'),  // 与 app origin 完全隔离
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: undefined,
    spellcheck: false,
  },
})
```

配套策略：

| 面 | 措施 |
| --- | --- |
| 弹窗 | `setWindowOpenHandler` → **不开系统浏览器，也不开新 BrowserWindow**，而是在我们的 tab 模型里新建一个 IAB tab。订票流程大量依赖 `target=_blank`（`submitAndClassify` 的注释就写明搜索结果常开在新标签页） |
| 导航 | `will-navigate` 放行 http/https；`file:` / 自定义 scheme 一律拒绝 |
| 权限 | `session.setPermissionRequestHandler` 默认拒绝摄像头 / 麦克风 / 定位 / 通知；地理位置在酒店场景可能需要，走显式白名单 |
| 下载 | `session.on('will-download')` 引导到会话 scratchpad，不落用户下载目录 |
| UA | 覆写为对应版本的 Chrome UA，去掉 `Electron/43`（见 §11.2 风险） |
| 分区 | `persist:travel-iab` 与 app origin 的 cookie 彻底分离；**app 的会话 cookie 绝不能被携程页面读到** |

### 5.3 z-order：一条会影响整个 UI 的限制

**WebContentsView 渲染在 DOM 之外，HTML 无法覆盖其上。** 这不是 bug，是 Chromium Views 的结构。后果：

- 现有的 `Modal`、`Dropdown`、`Toaster`（`app.tsx` 里 portal 到 body，注释写「z-index above modals」）**只要与浏览器面板重叠就会被遮住**。
- 处理方式三选一，按场景分：
  1. **收窄**——下拉、气泡尽量约束在左侧区域内。
  2. **遮蔽**——打开全屏模态时主进程 `setVisible(false)`，关闭后恢复。这就是 preload 里 `setOccluded` 的用途。
  3. **画进页面里**——必须叠在网页上的提示走页面注入。**既有的 shadow DOM 浮层天生就是这个形态**，改造量极小。按 003 它只保留两种用途：`human_challenge` 与 `browser_takeover`。

第 3 条值得强调：二版方案里页面内浮层是「用户要去另一个窗口点」；IAB 里它就在用户正看着的那半屏上。**这是嵌入方案在体验上真正优于并排的地方，而且是零成本得到的。**

**但按 003，页面内浮层的适用范围大幅收窄**：只服务 `human_challenge`（滑块/图形验证码）与 `browser_takeover`（兜底接管）两类。其余四类都在**左侧卡片**里完成，用户不碰浏览器——其中 `info_request` / `selection` / `commitment_confirmation` 控制权不变，而 `secret_entry` 虽然用户同样只操作卡片，系统仍会进入独立的 `secret_phase`（003 §7.3）。因此 z-order 遮挡问题的压力也随之下降——需要覆盖在页面上的东西变少了。

---

## 6. 状态模型

### 6.1 后端选择（任务级）

```
                 desktop?
                ┌───┴────┐
               是         否（纯 web 部署）
                │          └──> backend = 'extension' | 'direct'，无 IAB
                │
          开场在场检查 (001 §2.2)
                │
        ┌───────┴────────┐
   IAB 分区有有效登录态    没有
        │                 │
   backend='iab'    ┌─────┴──────┐
                 用户选择在 IAB 登录   用户选择用自己的 Chrome
                    │                    │
              backend='iab'        backend='extension'
```

**默认 `iab`。** 切换是任务级决定，在开场检查时做完，**不在任务中途切**——中途切等于丢掉整个页面状态。

### 6.2 面板状态

| 字段 | 取值 | 归属 |
| --- | --- | --- |
| `visibility` | `hidden` / `docked` / `fullscreen` | renderer 持有，IPC 同步给 main |
| `ratio` | `[0.2, 0.8]`，持久化 | 复用 `use-panel-width.ts` 的 store 模式 |
| `occluded` | bool | 模态打开时置真，main 据此 `setVisible(false)` |
| `backend` | `iab` / `extension` / `direct` / `headless` | server 持有，随 session |

### 6.3 页面状态（IAB 专有）

主进程持有唯一真相，通过状态面推给 renderer：

```ts
interface PaneState {
  tabs: Array<{
    id: string            // 我们生成的稳定 id
    targetId: string      // CDP target id，与 tabRegistry 对齐
    url: string
    title: string
    loading: boolean
    canGoBack: boolean
    canGoForward: boolean
    ownedByTask: string | null
  }>
  activeTabId: string | null
  control: ControlMode
  backend: 'iab' | 'extension'
}
```

事件来源全部是 Electron 原生：`did-start-loading` / `did-stop-loading` / `did-navigate` / `did-navigate-in-page` / `page-title-updated` / `did-fail-load` / `destroyed`。

### 6.4 任务级 tab 生命周期——问题的性质改变了，但没有消失

前两版把「任务结束怎么清理标签页」列为待建能力，因为标签页在用户自己的 Chrome 里：我们既不完全拥有它们，也无法保证清理不误伤用户手动开的页。

**IAB 下这个问题从「对外部 Chrome 的不可控清理」转化为「应用拥有、可确定管理的生命周期」。** 这是一次实质简化——tab 集合由我们创建、持有、销毁，用户的 Chrome 标签栏完全不受影响，误伤风险归零。**但它仍然是一份必须显式定义的策略**，而不是可以省略的能力：谁在什么时候关掉哪一页，用户能不能拦住，崩溃之后还剩什么，都要有确定答案。

以下四条策略是 P1 的交付内容，不得留到「以后再说」。

**一 · 任务结束：retain / close**

| 结束情形 | 默认 | 理由 |
| --- | --- | --- |
| 只读离场段（搜索、比价） | `close` | 没有需要回看的不可逆结果 |
| 产生了订单或停在支付页 | `retain` | 用户大概率要回看凭证；关掉等于丢证据 |
| 任务失败 / 被中止 | `retain` | 现场是排查依据 |
| 用户在该 tab 上手动标记过「保留」 | `retain`，覆盖上面所有 | 用户意图优先于任何自动策略 |

`retain` 的 tab 脱离任务归属（`ownedByTask = null`），留在 tab strip 里由用户自行关闭；不再接受 agent 写入。

**二 · 会话恢复**

任务级 checkpoint（`001` §4.4）记录 tab 集合的 **URL 列表 + 活动 tab**，不记录 WebContents（它跨进程不可序列化）。恢复时重新导航到记录的 URL，并**重新走一次归属认领**。恢复出来的页是新页——凡是依赖页面内瞬时状态（未提交的表单、一次性令牌）的流程，必须由 `Journal` 的 replay 语义兜底，不能假设页面还在原处。

**三 · 崩溃恢复**

- **单个 IAB 页崩溃**（`render-process-gone`）：只重建该 tab 并导航回最后已知 URL，不动其他 tab，不重载主窗口。注意 `main.ts:125` 现有的 `render-process-gone` → `reload()` 只针对主窗口，**不要让 IAB 视图落进那条路径**。
- **整个 app 崩溃**：下次启动时读 checkpoint，向用户展示「上次任务留下 N 个页面」，由用户选择恢复或丢弃。**不自动恢复**——自动重开一批页面是在替用户做他没要求的事，而且可能重新触发站点的风控。

**四 · 用户手动保留 / 关闭**

tab strip 上每个 tab 提供关闭按钮与「保留」开关。用户关闭一个 agent 正在使用的 tab 时：该 session 的后续写调用返回结构化错误（与 §6.5 的闸门同一条错误通道），agent 据此重新规划，**不自动重开**。

`tabRegistry` 保留并继续工作（按 CDP target id 键控，IAB 的 WebContents 同样有 target id），它解决的是正交的另一个问题：多个 agent session 并发时不写同一页。任务归属（`ownedByTask`）与并发归属（`tabRegistry`）是两层，不要合并。

### 6.5 控制权状态机

```
                        info_request / selection /
                        commitment_confirmation
                        （卡片解决，状态不变）
                                   ⤾
disconnected ──backend 就绪──> agent_control
                                   │  ▲   ▲
      ┌────────────────────────────┤  │   │ 证明字段已清空 → 恢复
      │                            │  │   │
      │ human_challenge /          │  │   └──────────────┐
      │ browser_takeover           │  │                  │
      │ (last resort，需 reason)   │  │ 用户点「交还」    │
      │                            ▼  │ (+留言)          │
      │                     handing_over                 │
      │                            │                     │
      │                            ▼                     │
      │                      user_control ──> resuming ──┘（回 agent_control）
      │
      │ secret_entry
      ▼
  secret_phase  ──── 用户只操作左侧卡片，不碰浏览器
      │              agent 轮次暂停 + 该 target 的 CDP capability 被 detach
      │              main 原子 fill + submit
      │
      ├─ 证明字段已清空 ─────────────> 恢复 CDP capability → agent_control
      ├─ 无法证明清空 ───────────────> 该 target 保持 human-only（不交还 agent）
      └─ 无法证明且流程需继续 ───────> 销毁该 target / session，在新 target 重建
```

**两条分支的性质完全不同，不要混：**

- `user_control` —— **用户操作浏览器**。入口只有 `human_challenge` 与 `browser_takeover` 两个 human-only 情形。
- `secret_phase` —— **用户不操作浏览器**（只在左侧卡片输入），但 **agent 被结构性暂停**：轮次挂起，该 target 的 CDP capability 被撤掉。它既不是 `agent_control`，也不是 `user_control`。

| 状态 | agent 写权限 | 说明 |
| --- | --- | --- |
| `agent_control` | 开 | **默认，且是绝大多数时间所处的状态**。`ghostCursor` 可见。用户此时仍可直接点页面——IAB 里我们能可靠检测（`before-input-event`），但不阻止 |
| `handing_over` | 关（排空中） | 不可省略。按下按钮那一刻 executor 里可能有 `await page.click()` 在飞。3s 硬上限 |
| `user_control` | **关，由 executor 强制拒绝** | 返回结构化错误而非静默阻塞——agent 要知道「现在人在操作」。读类调用照常。**按 003，本状态只由 `human_challenge` 或 `browser_takeover` 进入**；后者必须携带非空 `reason` 并写入审计 |
| **`secret_phase`** | **关，且 CDP capability 被 detach** | 比 `user_control` 更强：不是"写调用被拒绝"，而是**通道被撤销**，读类调用同样不可用。恢复以「证明字段已清空」为前提，证明不了就不恢复（003 §7.3） |
| `resuming` | 恢复中 | 留言经既有语义转 `[user_steering]` 注入当前任务，不新开任务 |

**三类完全不改变控制权的介入**（003 §7）：`info_request`、`selection`、`commitment_confirmation` 全程在左侧卡片完成，控制权始终停留在 `agent_control`。

**`secret_entry` 不属于这三类**：用户同样只操作左侧卡片，但系统进入 `secret_phase`。敏感值经 preload 具名通道直达 Electron main，不经 SSE、不经 agent；main 原子完成 fill + submit，随后按上图三条出口之一决定是否交还。

**闸门要枚举不要抽样**：`click / fill / type / press / goto / selectOption / check / setInputFiles`，加四个封装原语 `clickThrough / fillWithSuggestion / pickDate / submitAndClassify`，加 `tabs.open`。漏一个就是一个能绕过接管的洞。

`user_active` 软信号：IAB 下 `webContents.on('before-input-event')` 给出可靠的用户输入检测——这是并排方案拿不到的。用途是**提示**（「检测到你在操作，要接管吗」），不是自动转移状态：误判冻结 agent 的代价高于漏判。

---

## 7. IAB 与 Chrome 后端的边界

### 7.1 何时必须切到用户的 Chrome

| 情形 | 判据 |
| --- | --- |
| 站点需要用户已有的登录态，且用户不愿在 IAB 重新登录 | 用户选择 |
| IAB 分区被反爬 / 风控拦下 | `classifyOutcome()` 返回 `challenge` 且在 IAB 重试后仍然如此 |
| 需要企业 SSO / 硬件密钥 / 系统级证书 | 开场检查即判定 |
| 用户显式要求 | 用户选择 |

### 7.2 切换时移交什么

**不移交浏览器状态。** 迁移 cookie 既跨越安全边界，也是最典型的反爬信号（同一会话突然换指纹）。

按 `001-architecture.md` §2.1，离场段的产出本来就不是浏览器状态，而是**结构化的代表集**。所以移交内容是：

- 目标 URL（深链接）
- 已构造的候选集 / 代表集
- Intent 与 Commitment

在场段拿着深链接在目标后端重新打开即可。这条判断让「双后端共存」从难题变成常规工程。

### 7.3 不做的事

- **不做 IAB 与 Chrome 同时驱动同一个任务。** 一个任务一个后端，全程不变。
- **不做后端自动降级。** 切换必须是用户可见的决定——它改变了「用谁的登录态、在谁的浏览器里下单」，这不是可以静默发生的事。

---

## 8. 组件与数据流

### 8.1 一次 agent 操作

```
Agent
 └─ exec_command: penguin-browser -e 'await clickThrough("搜索")'
     └─ HTTP POST relay:19989 /cli/execute { sessionId }
         └─ PlaywrightExecutor (vm sandbox)   ← 代码一字不改
             └─ Playwright → CDP over relay
                 └─ WS /iab → Electron 主进程
                     └─ webContents.debugger.sendCommand('Input.dispatchMouseEvent', …)
                         └─ IAB 页面
```

### 8.2 一次状态更新

```
IAB 页面导航
 └─ webContents 'did-navigate'
     └─ BrowserPaneManager 更新 PaneState
         ├─ IPC 'iab:state' → renderer（地址栏、tab strip、加载指示）
         └─ HTTP → server（可选：只在需要写进 trace / 供 agent 读时）
```

**状态面默认不经过 server。** 只有当某个状态需要进入会话记录或跨设备可见时才上报。

### 8.3 一次用户介入

按 003 §7，介入分**三条**性质不同的路径。区分的两个维度是「用户要不要碰浏览器」与「agent 的控制权是否改变」——这两者不重合。

**路径甲 · 卡片解决，控制权不变**（`info_request` / `selection` / `commitment_confirmation`，占绝大多数）：

```
Agent: await requestUserInteraction({ kind: 'selection', options: [...] })
 └─ SSE → 左侧卡片渲染（renderer 内，不在 IAB 页面里）
     └─ 用户选择 / 回答 / 确认
         └─ 应答回到 agent
             └─ Agent 继续执行，控制权始终为 agent_control
```

**路径乙 · 卡片输入，但 agent 被结构性暂停**（`secret_entry`）：

```
Agent: await requestUserInteraction({ kind: 'secret_entry', field: 'cvv', … })
 └─ 进入 secret_phase：暂停 agent 轮次 + **detach 该 target 的 CDP capability**
     └─ SSE 只送「要什么、为什么」→ 左侧卡片渲染安全输入框
         └─ 用户输入（**不碰浏览器**）
             └─ preload 具名通道 iab:secret:submit → Electron main
                （**不经 server、不经 SSE、不经 agent**）
                 └─ main 校验 grant → 原子完成 fill + submit → 清零 → 写审计
                     ├─ 证明字段已清空 ──> 恢复 CDP capability → agent_control
                     ├─ 无法证明清空 ────> 该 target 保持 human-only，不交还
                     └─ 需继续但证明不了 ─> 销毁 target / session，新 target 重建
```

用户在这条路径上依然不碰浏览器，**但不能说「控制权始终在 agent」**：整个 `secret_phase` 内 agent 的调试通道是被撤掉的，且恢复以「证明清空」为前提。理由见 003 §7.3——CVV / OTP 一旦进入普通 DOM input，agent 恢复后可反读。

值不进 SSE 是硬性不变量：SSE 事件会进 `channel.ts` 的环形缓冲并在重连时重放（003 §1.7、§4.6）。SSE 只承载**请求**，不承载**答案**。

**路径丙 · 必须碰浏览器**（`human_challenge`，以及兜底的 `browser_takeover`）：

```
Agent: await requestUserInteraction({ kind: 'human_challenge', prompt: "请拖动滑块" })
 └─ 页面注入 shadow DOM 浮层（已有实现，跨导航重注入）
     └─ 控制权 → handing_over → user_control
         └─ 用户在 IAB 里真实拖拽 —— 合成轨迹会被风控识破，这类必须是人
             └─ 点击浮层确认 (+ 可留言) → { resolved, message, reason, waitedMs }
                 └─ message → [user_steering]；控制权 → resuming → agent_control
```

三条路径都在左侧渲染状态，但**只有路径丙注入页面浮层，也只有它进入 `user_control`**。`browser_takeover` 额外要求非空 `reason` 并写入审计——目的是让「退回让用户自己操作」成为可被审阅的决定，而不是方便的默认。

---

## 9. 分阶段实施

### P0 · 打穿两个前提（0.5–1 天）

1. `pnpm install && pnpm build`（lockfile 已随 `8cead1d` 变更，`node_modules` 是旧的）。
2. **验证 Playwright 能驱动 Electron WebContents。** 开发期用候选 A 最快：临时给 Electron 加 `--remote-debugging-port`，起一个 `direct` 模式 session，跑 `page.goto` + `snapshot()` + `clickThrough()`。
3. **验证 target 创建路径。** 见 §11.3——`context.newPage()` 在 Electron 上大概率不会创建 WebContentsView。

**验收**：Playwright 能对一个 WebContentsView 完成导航、ARIA 快照、点击。
**若不通**：候选 C 的 relay 侧合成逻辑需要按 Electron 的 target 行为改造，工期上浮，但方案主干不变。
**纪律**：这个端口只存在于 P0 的本地分支，不进任何提交。

### P1 · IAB 视图与布局（4–6 天）

新增 `desktop/src/browser-pane.ts`（视图生命周期、tab 集合、导航、事件）、`browser-pane-layout.ts`（纯函数：ratio + chrome 高度 + 窗口尺寸 → 矩形）、`preload-browser.ts`、`ipc.ts`（具名通道 + 校验）、`session-partition.ts`。
修改 `main.ts`（挂 preload、创建 pane manager、窗口 resize 时重算布局）。
web 侧新增 `browser-pane.tsx` + `use-browser-pane.ts` + `lib/desktop-bridge.ts`（`window.travelAgentBrowser` 缺失时整个面板不渲染，纯 web 模式自动降级）。

同时交付 §6.4 的四条 tab 生命周期策略：`src/tab-lifecycle.ts`（retain/close 判定、任务归属、checkpoint 的 URL 快照与恢复、崩溃分级处理）。

**验收**：
- 能在右侧打开携程首页并用鼠标键盘正常操作；拖动分隔线时视图跟随且无明显撕裂；打开模态时视图正确遮蔽后恢复。
- 只读任务结束后其 tab 自动关闭；标记为「保留」的 tab 不被关闭且脱离任务归属。
- 单个 IAB 页 `render-process-gone` 后只重建该 tab，主窗口不重载、其他 tab 不受影响。
- 杀掉整个 app 后重启，提示「上次任务留下 N 个页面」并等待用户选择，**不自动恢复**。
- 用户手动关闭 agent 正在用的 tab 后，该 session 的下一次写调用返回结构化错误而非崩溃或静默重开。

### P2 · IAB 传输接入 relay（4–6 天）

新增 `desktop/src/iab-transport.ts`；relay 新增 `/iab` WS 端点 + `mode: 'iab'` 分派；`executor.ts` 加 `cdpConfig.iab` 分支；`relay-state.ts` 把 `extensions` 泛化为 backends。

**验收**：
- `penguin-browser session new --iab` 后，`-e 'await snapshot()'` 对 IAB 页面返回 ARIA 树。
- `clickThrough` / `fillWithSuggestion` / `pickDate` 在 IAB 上跑通携程酒店表单（`001` §7.5 记录过这条流程在真实 Chrome 上一次跑通，可直接对照）。
- `tabs.open()` 在 IAB 模式下创建的是 WebContentsView 且带上 `ownedByTask`，`tabs.available()` / `claim()` 对该 target id 正常工作——即 §6.4 的任务归属与 `tabRegistry` 的并发归属两层同时成立且互不干扰。

### P3 · 控制权与最小化介入（4–5 天）

**范围按 003 修订**：目标不是把接管做顺手，而是把接管压到最少。

- `executor.ts` 写闸门（枚举，见上）。
- **删除 `executor.ts:1850` 的 `import()` 逃逸、`process` 代理改白名单**——003 §1.2 列为 P0-B。注意它只是修漏洞、缩小误用面；**建立信任边界靠的是 003 §0.3 / §1.1 的 OS 级隔离（P0-A）**，两者不可互相替代。
- `request-help.ts` 重构为 `requestUserInteraction` 六类（003 §7）；`help-overlay-client.ts` 收窄为只服务 `human_challenge` 与 `browser_takeover`。
- 前四类的左侧卡片渲染 + `ServerEvent` 扩展（`server/src/api/types.ts:1066`）。
- `before-input-event` 软信号；web 侧控制权徽章。

**验收**：
- `info_request` / `selection` / `commitment_confirmation` 三类**全程无任何浏览器操作**即可完成，且控制权始终为 `agent_control`。
- `secret_entry` 用户同样不碰浏览器，但系统进入 `secret_phase`：agent 轮次被暂停、该 target 的 CDP capability 被 detach；**期间 agent 的任何 CDP 调用（含读类）都失败**；只有在证明字段已清空后才恢复，否则该 target 保持 human-only 或被销毁。
- `browser_takeover` 缺 `reason` 时被拒绝；调用被写入审计。
- `user_control` 期间每个写方法逐个断言被拒。
- 交还留言进入 `[user_steering]` 且不新开任务。
- 沙箱逃逸用例 `await import('child_process')` 被拒绝。

### P4 · 后端切换（2–3 天）

开场检查里的后端选择 UI；切换时的 URL + 候选集移交；`SKILL.md` 升到 v5，写明 IAB 默认、何时切 Chrome、以及**不得中途切换**。

### P5 · 事务层接入（5–8 天，可与 P1–P4 并行）

与浏览器方案完全正交，但决定产品是否成立。`@travel-agent/transaction` 与 `@travel-agent/domain` 至今**没有任何调用方**（除 domain 依赖 transaction）。

需要：`EscalationChannel` 的 app 内实现（escalation → SSE → 左侧卡片 → 点击 → `resolve`）、`Journal` / `CheckpointStore` 接进 session 生命周期。

**「怎么强制 `submitBooking` 是唯一下单路径」由 003 §10.3 给出解法，但它有前提。** 解法不是加固沙箱（003 §1.2 论证了 vm 不构成边界），而是**把执行权从 agent 手里拿走**：agent 调 builtin tool `execute_payment({ capabilityId, actualPlan })`，真正的 `submitBooking()` 在 Electron main 内运行并持有一次性 capability 与支付凭证。走商户 token / 系统钱包 / PSP 托管字段时，agent 手里没有可用于付款的凭证。

**前提是 003 §0.3 的 OS 级隔离已落地**——未隔离时 agent 可直接读取 Vault 中的 token 并绕过整条路径（003 T0 与 T3 的交汇点）。所以这条保证是有条件的结构性保证，不是无条件的。

残余：不需要支付凭证的订单（到店付）agent 仍可直接提交，靠 skill 约束 + trace 审计覆盖，记在 003 §2 的 T3 残余风险栏。

本阶段的具体交付、Vault 与付款确认的完整设计，见 [`003`](./003-agent-first-private-profile-and-payment-confirmation.md) §11–§12。

---

## 10. 文件级改动清单

### packages/desktop

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/browser-pane.ts` | 新增 | `BrowserPaneManager`：WebContentsView 生命周期、tab 集合、导航、事件聚合、`setVisible` |
| `src/browser-pane-layout.ts` | 新增 | 纯函数 `computeLayout({ windowSize, ratio, chromeHeight, sidebarWidth })` → 矩形。**可单测** |
| `src/iab-transport.ts` | 新增 | relay `/iab` WS 客户端；`forwardCDPCommand` ↔ `webContents.debugger`；重连与密钥 |
| `src/preload-browser.ts` | 新增 | `contextBridge` 窄 API，见 §5.1 |
| `src/ipc.ts` | 新增 | 具名 `ipcMain.handle` + 参数校验 |
| `src/session-partition.ts` | 新增 | `persist:travel-iab` 分区、UA 覆写、权限/下载处理器、分区清空入口（§11.3 第 6 项） |
| `src/tab-lifecycle.ts` | 新增 | §6.4 四条策略：retain/close 判定、`ownedByTask` 归属、checkpoint 的 URL 快照与恢复、崩溃分级 |
| `src/main.ts` | 修改 | 主窗口挂 preload；创建 pane manager；窗口 `resize` / `enter-full-screen` 重算布局；退出时销毁视图 |
| `src/browser-relay.ts` | 修改 | fork relay 时注入 `PENGUIN_IAB_SECRET`；导出端口常量供 server 复用 |
| `test/browser-pane-layout.test.ts` | 新增 | 布局纯函数：多分辨率、极窄、chrome 高度变化、ratio 边界 |
| `test/iab-transport.test.ts` | 新增 | 假 WS + 假 debugger：命令转发、事件转发、错误映射、断线重连 |
| `test/tab-lifecycle.test.ts` | 新增 | 四种结束情形的 retain/close 判定、用户标记覆盖自动策略、checkpoint 往返、崩溃分级不误伤主窗口 |

### packages/browser-cli

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/cdp-relay.ts` | 修改 | `/iab` WS 端点（loopback + 密钥 + 单连接）；`/cli/session/new` 增 `mode: 'iab'` 分派 |
| `src/relay-state.ts` | 修改 | `extensions` 泛化为 backends；IAB 的身份与生命周期 |
| `src/executor.ts` | 修改 | `CdpConfig.iab` 分支；`tabs.open()` 在 IAB 模式下路由到主进程建视图（见 §11.3） |
| `src/protocol.ts` | 修改 | 复用 `forwardCDPCommand` / `forwardCDPEvent`；新增 IAB hello / identity 消息 |
| `src/session-lifecycle.ts` | 修改 | IAB 断连的错误语义（对照已有 `SESSION_EXTENSION_DISCONNECTED`） |
| `src/tab-ownership.ts` | 不变 | — |
| `src/interaction.ts` | 不变 | — |
| `src/request-help.ts` | 修改 | 重构为 `requestUserInteraction` 六类（003 §7）；`browser_takeover` 强制非空 `reason` |
| `src/help-overlay-client.ts` | 修改 | 收窄为只服务 `human_challenge` 与 `browser_takeover` |
| `src/executor.ts`（安全） | 修改 | **删除 `:1850` 的 `import()` 逃逸**、`process` 代理改白名单（003 §1.2，P0-B）；接入 `secret_phase` 的 CDP capability detach / 恢复 |

### packages/server

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/services/browser-bridge.ts` | 新增 | relay 客户端单例：后端状态、session 模式、handoff 事件 |
| `src/http/routes/browser.ts` | 新增 | `GET /api/browser/status`、`POST /api/browser/backend`、`POST /api/browser/control`、`POST /api/browser/handoff/:id/resolve` |
| `src/api/types.ts` | 修改 | `ServerEvent` 联合增加 `browser_state` / `browser_handoff`（在 `:1066` 处扩展） |
| `src/app.ts` | 修改 | 挂载 browser 路由 |
| `test/routes/browser.test.ts` | 新增 | 路由单测 |

### packages/web

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/lib/desktop-bridge.ts` | 新增 | `window.travelAgentBrowser` 的类型化包装；**缺失时返回 null，纯 web 模式据此隐藏面板** |
| `src/features/chat/browser-pane.tsx` | 新增 | tab strip、地址栏、前进/后退/刷新、控制权徽章、为 WebContentsView 预留的空白区（一个带 ref 的 div，只用来测量） |
| `src/features/chat/use-browser-pane.ts` | 新增 | 面板状态、ratio、可见性、遮蔽协调；测量 div 的 rect 并节流上报 |
| `src/features/chat/chat-page.tsx` | 修改 | 三面板协调（现为两面板互斥，`:331-360`）；模态开关时置 `occluded` |
| `src/features/chat/use-panel-width.ts` | 修改 | 允许浏览器面板参与共享宽度，或为其单独一个 key |
| `src/components/ui/modal.tsx` `toast.tsx` | 修改 | 打开/关闭时通知遮蔽 |

### packages/skills

| 文件 | 动作 |
| --- | --- |
| `skills/penguin-browser/SKILL.md` | 修改到 v5：IAB 为 desktop 默认；`session new` 的 mode 语义；何时切 Chrome；**不得中途切换后端** |

### design

| 文件 | 动作 |
| --- | --- |
| `002-codex-style-single-window-iab.md` | 本文档 |
| `001-architecture.md` | **待修订，未在本次改动**：§2.2 与 §3 需要按 §11.1 调整 |

---

## 11. 风险与待验证项

### 11.1 `001-architecture.md` §2.2 的论断需要修订

原文：**「扩展模式不是可选项：它是唯一携带用户真实登录态的模式」**。

本方案的 IAB 使用 `persist:travel-iab` 分区（§5.2）。**这是本项目自己做出的明确选择**，目的就是让用户在工作区里登录一次之后不必反复重登。分区是否持久、保留多久、如何清空，完全由我们决定，见 §6.4 与 §11.3 第 6 项。

作为对照：Codex 的内置 Browser 同样使用**与用户常规浏览器相分离的 profile**，不会自动共享用户已有的 tabs 或 session，用户可以在其中直接登录（见 [Codex 官方文档 · Browser](https://learn.chatgpt.com/docs/browser?surface=app)）。**本文档不对 Codex 是否跨重启保留登录态作任何断言**——那既非公开明确说明的行为，也不影响本方案的取舍。有参考价值的只有那一条结构事实：内置浏览器的 profile 与用户日常浏览器是分开的，因此拿不到后者已有的登录态。

因此 `001` §2.2 的论断应修订为：**IAB 能持有它自己分区内的登录态；扩展模式是唯一携带「用户在自己 Chrome 里已有的」登录态的模式。** 由此，§2.2 中「开场在场检查」的必要性理由不变，但「必须用扩展模式」的结论降级为「默认 IAB，特定条件下切扩展」。

**本次未改 001。** 建议在 P4 完成后一并修订，避免文档描述超前于实现。

### 11.2 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **IAB 指纹被风控识别** | 携程等站点对新 profile + Electron UA 可能更严格 | 覆写 UA 去掉 `Electron/`；持久分区让 profile 随使用变「老」；`classifyOutcome()` 已能区分 `auth_wall` / `challenge`，触发即建议切 Chrome。**这是本方案最大的产品风险，P0 应顺手实测一次携程** |
| **`--remote-debugging-port` 泄漏进发布包** | 严重安全缺陷：任意本地进程可窃取用户会话 | P0 的端口只在本地分支；构建期加检查（grep 命令行开关 + Electron fuses）；CI 上把它做成硬失败 |
| **z-order 遮挡导致 UI 缺陷** | 下拉/模态/toast 在面板上不可见 | §5.3 三条策略；遮蔽逻辑要覆盖所有 portal 组件，逐个清点而非抽样 |
| **拖动分隔线时视图撕裂** | 观感差 | renderer 只上报 ratio（节流），主进程算矩形；拖动中可临时 `setVisible(false)` 显示占位 |
| **Playwright 与 Electron target 语义差异** | P2 工期上浮 | P0 先验；relay 的 target 合成层是可改的，不是外部依赖 |
| **IAB 页面崩溃拖累主窗口** | 整个 app 不可用 | 视图是独立 renderer 进程；监听 `render-process-gone` 单独恢复该 tab，不重载主窗口（现有 `main.ts:125` 的重载逻辑只针对主窗口，不要误伤） |
| **tab 生命周期策略缺失或过度自动** | 两个方向都伤：不清理会攒页；自动关掉有订单的页会丢凭证；崩溃后自动重开一批页可能触发风控 | §6.4 四条策略是 P1 交付项而非「以后再说」；默认偏向 `retain`，用户标记覆盖一切自动策略；整机崩溃后**不自动恢复**，只提示 |
| **恢复出来的页是新页** | 依赖页面瞬时状态的流程会静默失败 | checkpoint 只记 URL 不记 WebContents；不可逆动作一律由 `Journal` 的 replay 语义兜底，不假设页面还在原处 |
| **Agent 与主进程同 OS 用户** | 主进程不是相对 agent 的信任边界；Vault、broker IPC、capability 全部退化 | **003 §0.3 的 OS 级隔离**，攻击测试验收见 003 §12。未满足时 L2/L3 停用，Vault 降为「防误泄漏」 |
| **纯 web 部署没有 IAB** | 功能不对等 | `desktop-bridge.ts` 缺失即隐藏面板，降级到 extension / direct 后端 |
| **事务层仍无调用方** | 产品不成立 | P5，与本方案正交但不可省 |

### 11.3 待验证项

1. **`context.newPage()` 在 Electron 上会发生什么。** Playwright 的建页走 `Target.createTarget`；Electron 不像 Chrome 那样据此创建窗口。预期结论：**IAB 模式下 `tabs.open()` 必须路由到主进程创建 WebContentsView**，而不是走 Playwright 的建页路径。这会影响 `executor.ts` 中 `openOwnedTab` 的实现。P0 必须验证。
2. **`Page.captureScreenshot` / ARIA 快照在 WebContentsView 上的行为**，特别是视图被 `setVisible(false)` 遮蔽期间是否仍能取到内容（涉及模态遮蔽与 agent 并行工作是否冲突）。
3. **`webContents.debugger` 是否覆盖 Playwright 所需的全部 CDP 域**——尤其 `Fetch` / `Network.setBlockedURLs` / `Emulation.setFocusEmulationEnabled`（后者在 `background.ts:52` 的超时表里，说明扩展路径用到了它）。
4. **多个 `WebContentsView` 同时 attach debugger 的开销**，以及并行比价开 3–5 个页时的内存占用。
5. **`before-input-event` 能否可靠区分用户输入与 CDP 合成输入**——若不能，`user_active` 软信号会持续误报。
6. **持久分区下的存储配额与清理策略**，以及用户想「退出登录 / 清空」时的入口。
