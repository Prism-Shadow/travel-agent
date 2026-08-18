# 005：对标 Mindtrip 的 UI 与功能重构（提案）

| | |
| --- | --- |
| 状态 | **已采纳，实施中**。2026-08-19 正式解冻 `packages/web` 产品 UI；先落地 P0 的旅行消费者主界面，P1/P2 仍按各自协议依赖推进 |
| 日期 | 2026-08-19 |
| 依据 | [docs/research/mindtrip.md](../docs/research/mindtrip.md)（§3 产品、§8 市场反馈、§10 对照、§11 一手 UI 解剖）· [docs/research/competitors.md](../docs/research/competitors.md) · packages/web 现状盘点（本文 §3） |
| 一句话 | 学 Mindtrip 的**呈现层**（卡片、结构化行程、比价弹层、预填 prompt 入口），不学它的**产品面**（社区/灵感/地图探索）；用它的呈现语言放大本仓库自己的差异化——代表集+理由、点击即授权、停在支付页 |

---

## 1. 为什么对标、对标什么

Mindtrip 是独立 AI 旅行产品的头部（调研见 mindtrip.md），评测对它 UI 的评价高度一致：「最精致的 plan-and-book 工具」「UX/UI absolutely brilliant」。但对照表（mindtrip.md §10）已经说明：两个产品在交易通路、支付、覆盖、防幻觉上做了**每一项都相反**的选择。所以对标的正确姿势是：

- **学呈现层**——它把 LLM 输出变成可决策界面的手法，与交易通路无关，直接可搬。
- **不学产品面**——社区/创作者/灵感流是它作为免费消费产品换增长的打法（§10.5 明确「别学」）；地图中心探索服务于 discovery，本仓库是 execution 工具。
- **放大自己的差异化**——Mindtrip 被诟病「整理强、决策弱」「第一小时惊艳、预订环节流失」（§8.5）。本仓库 001 的代表集设计（3–4 个代表 + 每个附理由 + 点击即授权）恰好打这个空位，UI 重构的首要目标是把这件事**做成界面上一眼可见的主张**，而不是埋在 markdown 文本里。

## 2. 对标结论速查

| Mindtrip 的做法（mindtrip.md §11.2） | 采纳？ | 对应到本仓库 |
| --- | --- | --- |
| 结构化 option/place card（图+价+评价+一句话理由） | ✅ 核心 | 代表集卡片（P1），`rationale` 已在 `CardAction.choose` 里 |
| 行程/流程按阶段分段呈现，card+证据+地图同一工作区 | ✅ 改造 | 预订进度时间线（P2）：搜索→代表集→填表→支付页停止；「证据」是浏览器窗格而不是地图 |
| 预订弹层内并列多渠道实时价，跳转只发生在最后一步 | ✅ 原则 | 我们更进一步：不跳转，agent 在真实页面上继续，停在支付页 |
| 所有功能入口 = 预填 prompt 的 chat 链接；chat 是唯一中枢 | ✅ 直接搬 | 示例任务/空态/深链都指向预填 composer（P0） |
| Start Anywhere：贴 URL/截图 → 抽取意图开跑 | ✅ 后置 | P3：附件→意图管线（前端附件能力已有） |
| place card 内嵌「建议追问」按钮，把详情页拉回对话流 | ✅ 低成本 | 卡片尾部追加建议追问（P1 顺带） |
| 交互地图中心、Inspiration 信息流、社区/创作者、Collections | ❌ | discovery 面，与工具定位无关（§10.5） |
| 价格监控/降价提醒 | ❌ | 001 明确不做长驻进程 |
| 行程音频播报、Magic Camera、Events | ❌ | 行中伴侣定位，不在「一句话→支付页」闭环上 |

## 3. 现状盘点：差距在外壳，不在骨架

packages/web 是 PenguinHarness 控制台的冻结快照。逐层看：

**骨架已经够用（不需要新发明）：**

- `interaction-cards.tsx` / `interaction-model.ts`：六类 requestUserInteraction 的卡片渲染，`CardAction` 已有 `choose { optionId, label, rationale }`——代表集点选的协议与渲染入口**已存在**。
- `browser-pane.tsx` / `browser-pane-split.ts`：chat + 浏览器双栏分屏已有，对应 Mindtrip 的 chat+地图双栏——我们的「右栏」天然是真实页面，这是证据层优势。
- `goal-banner.tsx` / `step-banner.tsx`：目标与阶段横幅雏形已有。
- 附件（`attached-files-banner.tsx`）、SSE 流式渲染、i18n（zh/en）都是现成的。

**外壳完全是开发者控制台（重构主战场）：**

- 导航挂着 Agents / Skills / Models / Usage / Traces / Benchmark / Admin（`router.tsx`）——消费者一个都不该看见。
- `example-tasks.ts` 的示例是 webapps（做游戏）和 agents（RAG、benchmark）——与旅行无关。
- 会话语言是「session/agent/task」，不是「行程/预订」。
- 代表集今天以 markdown 文本形式流出（模型直接写），没有结构化卡片消息——Mindtrip 评测里「一切落成卡片和地图」与我们「一切落成文本」的观感差距，根源在这一条。

## 4. 重构方案（按依赖排序）

### P0 消费者外壳（纯前端，零协议改动）

1. 双形态路由：默认形态只有 chat（+设置），开发者页面（traces/benchmark/admin/models/…）收进 `/dev` 或以配置开关隐藏。不删代码，只改 `router.tsx` 与导航。
2. 语言层：locale 字典把 session→行程、task→预订等旅行语言换掉；空态与登录页文案随之。
3. `example-tasks.ts` 换旅行场景文件夹（订酒店/订机票/改期比价），每条是预填 prompt——照搬 Mindtrip 的 `?q=` 入口模式。

### P1 代表集卡片（核心主张的呈现层）

1. 代表集从「模型写 markdown」升级为结构化交互：复用 requestUserInteraction 的 choose 通道（或在 OmniMessage 上加一个 travel 卡片消息类型——需要 core/server 最小配合，取舍见 §5）。
2. 卡片字段对齐 001 §2 的权衡维度：名称/图/价格/关键 tradeoff 一行/**入选理由一句**。理由是第一公民——这是与 Mindtrip「整理不决策」的可见分野。
3. 点击卡片 = 授权（001 的既有语义），卡片状态流转：候选→已选→执行中。
4. 卡片尾部两三个建议追问按钮（低成本抄 §11.2.3）。

### P2 预订进度时间线（把「停在支付页」变成界面承诺）

1. `goal-banner`/`step-banner` 合并升级为阶段时间线：理解需求 → 搜索比价 → 代表集 → 你的选择 → 填表 → **支付页（人接管）**。最后一格永远显示为人的领地——把 003 的支付红线画在界面上，作为信任卖点而不是免责声明。
2. 浏览器窗格定位为「证据层」：时间线每一步可展开对应的页面实况；填表阶段默认展开。
3. 六类交互卡在时间线内就地出现（验证码/接管/确认支付），不打断布局。

### P3 Start Anywhere 式输入（后置，独立成项）

贴酒店/航班 URL 或截图 → 解析出意图与约束 → 直接开跑。前端附件链路已通，缺的是解析→意图的 agent 端管线；协议上无新东西。价值：把「一句话」的门槛降到「一张截图」。

### 不做清单（与 §2 表格的 ❌ 行一致，防漂移）

地图中心探索、Inspiration/社区/创作者、Collections、价格监控、行程音频、Events。每一条都有明确出处（§10.5、001 非目标），重构过程中若有人提议加回，先推翻出处再动手。

## 5. 技术约束与两个待决点

1. **解冻 web 包（2026-08-19 已决定）。** README 已把 `packages/core` / `packages/server` 的引擎基线与持续演进的 `packages/web` 产品 UI 分开表述；web 与 desktop 的界面从此按 travel-agent 的消费者体验独立演进，不再受「冻结快照」约束。
2. **代表集结构化的通道选择**（P1.1，需要拍板）：
   - a. 复用 requestUserInteraction/choose：零协议改动，但语义上代表集呈现不是「请求交互」，且一次只能挂一组选项；
   - b. OmniMessage 新增 travel 卡片消息类型：语义干净、可流式渐进渲染，但动 core/server，且违反「不写平台专有规则」的判据吗？——不违反：卡片 schema 是领域无关的（名称/价/理由/维度），判据见 001 §2.5。
   - 倾向 b，理由：代表集是产品核心，不该寄居在为「打断」设计的通道里。
3. **桌面端跟随。** web 重构后 `pnpm desktop` 自动继承（加载同一 dist），但 P2 的浏览器证据层在桌面端对应 IAB WebContentsView（002），窗格行为要各自验证。

## 6. 留给产品方向讨论的开放问题

1. 重构后的第一验收场景是什么？（M3 撤出后没有验收锚点；建议以 P0+P1 重演 001 的演示脚本作为锚）
2. 消费者形态与开发者形态是配置开关还是两个构建目标？
3. P1 通道选择（§5.2）需要 core 维护者意见。
