# AI 旅行竞品实况调研

| | |
| --- | --- |
| 日期 | 2026-08-17 |
| 方法 | 四路并行网络调研(OTA 巨头 / 中国玩家 / 大厂通用 agent / 独立创业公司),优先采信财报会披露、独立实测、用户评价,PR 通稿单独标注。Skift/PhocusWire 部分页面 403,个别结论来自搜索摘要,均已标注 |
| 姊妹篇 | [`mindtrip.md`](./mindtrip.md)(Mindtrip 单独深调) |
| 用途 | 回答一个问题:每家竞品**今天实际能做到哪一步**(规划 / 导航 / 填表 / 支付),而不是发布会说了什么 |

---

## 0. 先看三个最硬的事实

1. **AI 助手带来的预订量约等于零。** Booking Holdings CFO 在 2026 Q2 财报会披露:所有 AI 助手合计带来的流量「significantly below 1%」(相对其季度 ~3.25 亿间夜),且「最近几个月/几个季度没有实质变化」。Expedia CEO 同期表态:agentic 流量「仍然很小」,自然语言体验「尚未带来预订」,价值在于多捕获 60% 的用户意图信息。[Hospitality.today](https://www.hospitality.today/article/booking-com-just-told-investors-how-little-ai-actually-books) · [Expedia Q2 transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-expedia-beats-q2-2026-estimates-raises-outlook-93CH-4839467)
2. **没有任何一家让 AI 自主完成支付。** 中美两边、大小玩家,闭环终点全部是「把用户送到收银台」。仅有的三个例外都是「结构化协议 + 支付伙伴」形态:Priceline Penny(chat 内订完机酒车)、Perplexity+Selfbook(页面内 PayPal 订酒店)、Mindtrip Flights(Sabre+PayPal in-chat 出票)。
3. **Browser-use 路线被市场实测证伪(以通用 agent 而言)。** Operator 血统在真实订票任务上成功率 <50%,遇 CAPTCHA 直接放弃,比人慢 3–5 倍;OpenAI 2025-08 关停 Operator、2026-03 撤回旅行类原生结账、2026-08 移除 Agent mode;Google 的 Chrome auto browse 刻意在「Place Order」前刹车;Cloudflare 2026-09-15 起新域名默认屏蔽 agent 类 bot。行业集体退回「结构化协议 + 合作方收银台」。[Presenc tracker](https://presenc.ai/research/openai-operator-update-tracker-2026) · [Skift walkback](https://skift.com/2026/03/05/openai-chatgpt-checkout-walkback/) · [Cloudflare](https://blog.cloudflare.com/signed-agents/)

---

## 1. OTA 巨头

### Expedia:高调宣布、低调埋葬,转向专项多 agent

- **Romie**(2024-05 发布的全能 AI 管家):只到过 EG Labs alpha,从未 GA,2026 年被 Skift 证实「deprioritized」——本赛道「announce-big / ship-alpha / quietly bury」的典型标本。Expedia 的结论是全能管家「isn't practical for now」,转向专项化多 agent 架构。[Skift](https://newsletters.skift.com/p/expedia-s-ai-rebuild)
- **Trip Matching**(2025-05,仅美国):DM 一条 Instagram Reel 给 @Expedia,60 秒回行程 + 酒店卡片。实测产出偏「通用贴士 + 酒店推销」,且被批创作者零分成零署名。无任何使用数据披露。
- **收购 Layla**(2026-07-31,金额未披露):~25 人、共融 €5M,实质是 acqui-hire。Layla 暂以独立产品运营,尚无任何 Layla 技术进入 Expedia 产品。
- **真实落地的部分反而不性感**:ChatGPT 内 Expedia app(发现在 chat、结账跳回 Expedia)、Vrbo 自然语言搜索、AI 客服 80% 请求 60 秒内解决、AI 排序/个性化带动转化。PhocusWire 的 Q2 标题一针见血:「Expedia 在投资尚不转化的 AI」。

### Booking.com:刻意克制,交易必须留在自家漏斗

- **AI Trip Planner**(2023-06 起,美英澳新新加坡,移动端):规划、Smart Filter(自然语言转筛选器)、房源问答、评价摘要、7×24 行程服务。**只规划和服务,不代订**。产品团队自己复盘:为防幻觉限制过狠,产出「重复而且说实话有点无聊」。[Booking PM 复盘](https://medium.com/booking-product/8-weeks-to-innovation-lessons-from-building-booking-coms-ai-trip-planner-94adbf138748)
- 一个耐人寻味的信号:2025–2026 几乎所有独立横评(AFAR、MonkeyTravel 等)都**懒得把它列进来测**——有意思的工具是 Mindtrip/Layla/Gemini,不是 OTA 自家 bot。
- Fogel 的立场:「There is no such thing as a moat」;AI 可以规划行程,但 Booking 要守住交易。多栖策略:同时接 OpenAI、Google、Anthropic、Amazon。

### Priceline Penny:最激进的 OTA 实验,带着阴暗面

- 2026-06-03 改版为「fully agentic」:10+ 专项 agent(Anthropic Claude 做推理规划 + OpenAI/Google 做搜索语音),理解多目的地比价请求、**chat 内订完机票/酒店/租车不跳出**、管理已有订单、持久偏好层。Evercore ISI 横评称其为最强端到端 AI 预订体验(单一信源,中等可信)。[Priceline press](https://press.priceline.com/pricelines-penny-goes-fully-agentic/)
- Fogel 披露 Penny 用量「逐月翻倍」、深度用户转化率有「可见提升」——照例无绝对值。
- **用户端的另一面**:Trustpilot 差评集中在 Priceline 强制客服请求先过 Penny,受困用户体验为「挡人墙」。同一个产品,demo 是预订 agent,现实是客服挡箭牌。

### Kayak:自己承认了纯 chat 的失败

- 三代形态:Kayak.ai 独立实验站(2025-04)→ 主站 AI Mode(2025-10)→ **Ask AI**(2026-04-29,现旗舰):chat 面板与**传统实时结果页并排**,chat 里说、结果和筛选器实时变。之所以长这样,CPO 基于每月 10 万+ AI 对话的直白结论:「旅行者还没准备好只凭几条 AI 建议就做决定」——纯对话预订(Kayak.ai 概念)表现不佳的官方承认。[Travolution](https://www.travolution.com/news/technology/kayak-launches-ask-ai-to-simplify-travel-planning/)
- 背景:2025-10 计提 $457M 减值,时任 CEO 直指 Google 挤压元搜索;22 年 CEO Hafner 离任。曾预言「第一笔 AI 旅行交易会像大坝决堤」——截至 2026-08,坝还在。
- 注:调研中未找到「Kayak PathFinder」这个产品存在的任何证据,相关说法按未证实处理。

---

## 2. 中国玩家

**总体节奏**:2023–24「大模型嫁接」→ 2025 上半年「多智能体规划」→ 2026-08「履约/办事竞赛」。头部三家都打通了「对话 → 商品卡片 → 预订页」,但**支付环节全部交还用户**;2026 年的新边界是履约侧(值机、升房、退改),不是支付代理。

### 携程:问道 + TripGenie + AI 行程助手

- 国内外两套产品:国内「问道」智能体 + 「AI 行程助手」(2025-09,PC 规划/手机调整,2000 万 POI,**配人工定制师团队兜底**);海外 TripGenie(行程生成、对话内嵌预订链接、菜单翻译、拍照识景点)。
- **+400% 的真相**:出自 TripGenie 三周年通稿——AI-assisted bookings +400% YoY、核心工具使用 +300%、60% 交互与预订决策相关。全部是百分比、零绝对值,低基数上不惊人;「AI-assisted」口径未定义(大概率 = 预订前发生过任意 AI 交互即计入)。相对最有信息量的是「60% 交互与预订相关」——用户确实把它当购前工具。
- **最狠的负面实测**(澎湃):三四轮对话即持续幻觉;「不想 Citywalk」后仍重复原建议;找「上海中山公园附近酒店」推荐了全国各地的中山公园;结论「最多是网络素材整合工具」。[澎湃](https://m.thepaper.cn/newsDetail_forward_28997226)
- 最扎实的其实是**行中服务**:2024 年机票/酒店问题 AI 自助解决率 78%/68%。战略上是防御:AI 搜索绕过 OTA 入口、抖音酒旅 GMV 900 亿(2024)低佣金抢供给,携程的 AI 更多是守城。

### 飞猪:问一问 → 帮帮,阿里生态级打法

- **问一问**(2025-04):约 9 个角色的多智能体「定制团队」(路线定制师、酒店顾问、预算管理师……),按任务混用通义千问多模型 + DeepSeek。数据护城河是 GDS 秒级舱位、EBK 房态、300 万条攻略清洗出的 2 万条真实行程模板。
- **帮帮**(2026-08-10,最新动向):从「能聊」到「能办事」——行前机酒预订/接送机,行中**值机选座、酒店升房、填入境卡**,行后退改、开票报销。这是国内目前最激进的「办事」边界。
- 实测口碑两面:因能调真实价格库存,方案「可执行性高于表演型 AI 规划」;但生成慢(完整方案约 4 分钟)、**忘订返程高铁票**、预算不会算多人拼房、多次卡死。官方指标全是使用量(Token +20 倍、调用 +7.7 倍、「13 亿次谢谢」这类虚荣指标);「异常中断率 −97%」反而最诚实——等于承认早期极不稳定。**未披露 AI→订单转化率**。
- 战略:飞猪已成为**千问 App 的旅行执行层**(2026-01 接入,「一句话订机票酒店」),阿里是唯一「通用助手入口 + 垂直供应链」双线并进的玩家。

### 其他

- **同程「程心 AI」**:2025-03 接 DeepSeek,宣称业内首个「AI 推荐→决策+预订执行」闭环,首批 210 万用户;横评表现意外扎实(多日期航班+准点率/机龄)。
- **美团**:先 B 后 C——B 端「既白」(酒店商家工具),C 端「问小团」(App 内 AI 搜索)+ 独立 agent App「小美」(自研 LongCat 模型,能执行「订明天下午 3 点故宫门票」)。实测口碑分化,「有点鸡肋」。
- **马蜂窝「AI 小蚂」**:内容强、交易缺失的典型——AI 路书单次生成约 40 分钟、每天限 1 次、不可二次修改。
- **去哪儿**:最保守,首页「AI 旅行工具箱」,无强闭环宣称。
- **抖音/小红书**:均无 C 端 AI 旅行预订助手。抖音的威胁是渠道性的(酒旅 GMV 900 亿、佣金 ~8%),不是 AI 产品。小红书「点点」只做种草→规划。
- **信任鸿沟数字**:中国 77% 受访者愿用 AI 做行程规划(全球最高),但全球仅 **2%** 愿全权交给 AI;46% 嫌建议太通用、39% 遇过错误/过时信息。[环球旅讯转引 Skift](https://www.traveldaily.cn/article/187809)

---

## 3. 大厂通用 agent

### Google:做入口和协议,坚决不碰交易主体

- **AI Mode + Canvas 行程规划**已上线(需 Labs opt-in),体验被评为规划类最佳之一。「200+ 国家 agentic booking」的真相:200+ 国家指的是 **Flight Deals 工具全球化**,不是代订。
- agentic 预订实际分三档:餐厅订位真实可用(美英印度,跨 OpenTable/Resy/Tock);**酒店代订 2026-08-07 刚进入美国小流量测试**(合作方 Booking/Expedia/万豪/IHG + Amadeus/Sabre,技术框架是 I/O 2026 发布的 Universal Commerce Protocol),Google 明确**不做 merchant of record**,当前测试可能仍跳转合作方完成;机票代订仍是「working on it」。
- Chrome auto browse(Gemini agentic mode)实测能填表跨站操作,但**在杂货结账「Place Order」前拒绝点击**——Google 刻意在支付前刹车。
- 供给侧集体**主动合作**(六大酒店集团、两大 OTA、两大 GDS),与对 browser-use agent 的封锁形成鲜明对照。

### OpenAI:从 Operator 到全面退守

时间线:Operator 上线(2025-01)→ 并入 ChatGPT Agent(2025-07)→ Operator 关停(2025-08)→ Apps in ChatGPT 上线,Expedia/Booking 首批(2025-10)→ Accor 成首个上 app 的酒店集团(2026-01)→ **撤回旅行类原生结账**(2026-03-05,Expedia +12%、Booking +8% 应声上涨)→ Agent mode 移除、Atlas 浏览器停更(2026-08)。

- 撤退原因(TourismTribe 复盘):实时变价、退改政策差异、多币种、售后责任、销售税——「哪怕挪动交易流程中很窄的一段都很难」。
- 实测:真实网站订机票类任务成功率 **<50%**;遇 CAPTCHA 直接放弃而非求助人类;遇阻碍会放弃原任务改做泛泛研究;比人慢 3–5 倍。评语:「第一天上班的聪明实习生」。[AI Fire 十项实测](https://www.aifire.co/p/chatgpt-agent-mode-review-a-10-part-real-world-test)
- 三个酒店 app 横评(2026-02):Expedia 对话最顺、Booking 报价与卡片不一致、Accor 最笨拙;**三家的最终预订全部跳出 ChatGPT**。
- **结论:2026 年「在 ChatGPT 里订机票/酒店并付款」不成立。**

### Perplexity:唯一在自家页面内闭环酒店支付的,和最惨烈的对抗案例

- **结构化线**(真闭环):Selfbook + Tripadvisor 集成,约 14 万家酒店,Perplexity 页面内 Selfbook 结账、PayPal/Venmo/BNPL 支付,不跳第三方。这是目前唯一大规模落地的「AI 对话产品内完成酒店支付」。
- **Comet 浏览器 agent 线**(browser-use):实测极不稳定——订错日期、死循环、复制错数据、同一动作时好时坏;TechCrunch 测订车位给出完全错误的日期且没订成。
- **Amazon v. Perplexity**:Amazon 起诉 Comet 把 AI bot 伪装成普通 Chrome 访问用户账户;地方法院初步禁令 → **上诉法院推翻**,案件未了。这是「agent 是否有权代用户操作网站」的标志性判例,值得持续跟踪。[Engadget](https://www.engadget.com/2230471/perplexity-has-successfully-overturned-amazon-injunction-on-its-ai-shopping-bot/)

### 其余简述

- **Claude in Chrome / Cowork**:可导航、填表、多标签,经 app 集成(含 Booking.com)在聊天内发起预订类任务,敏感操作强制人工确认;无专门旅行产品,无闭环支付实测。
- **Microsoft Copilot Actions**:伙伴名单豪华(Booking/Expedia/Kayak 等 8 家),称可在 Expedia/Vrbo 代订(执行前确认),但几乎没有独立实测,可靠性未知。
- **Amazon Alexa+**:OpenTable/Uber 可用,Expedia 订酒店 2026-04 宣布年内落地,8 月尚无用户实测。反差:Amazon 自己是对外部 agent 最强硬的封锁方。
- **航空公司在所有 agentic booking 合作名单中集体缺席**——机票闭环是全行业空白(仅 Mindtrip×Sabre 一例)。

---

## 4. 独立创业公司

### Layla:最好的独立样本,也是最清楚的告别

- 柏林,2023 年创立,~25 人,~€5M(Firstminute、M13);2024-02 吞并 Roam Around(初代 GPT 套壳行程 bot,1000 万行程/50 万月访客)。产品真的能订:BudgetAir 机票、Vio/Skyscanner 酒店,实测数据准确度全场最佳(4/5)。
- 但**死于商业模式而非 AI 质量**:免费层只给总览+总价,逐日明细锁在 $49.99/年付费墙后;Trustpilot 仅 3.5/5,差评集中在自动续费、拒退款、用户被迫拒付;无移动 App。对上免费的 ChatGPT、对下 OTA 免费送同款功能,$49/年的订阅撑不起 venture 曲线。
- 2026-07-31 被 Expedia 收购,Skift 定性为「technology and tech talent」——人才收购;明言「无论 Layla 平台几年后是否还独立存在,人才都值这个价」。

### GuideGeek(Matador):C 端做不动,转身卖给旅游局

- WhatsApp/IG DM/Messenger 内免费 concierge,无 App 无账号,**只 link-out**。370 万+ 问题、42 语言;著名幻觉案例(凭空发明匹兹堡冰淇淋店「Crete Freeze」连创始人故事都编好了),自称经护栏+实时数据把幻觉率从 14% 压到 ~2%。
- 2026 年战略重心已转 **B2B 白标**:「为每个目的地做定制 AI」,客户含 New Brunswick、Travel Manitoba 等旅游局。

### 长尾生死簿

| 产品 | 一句话 | 预订 | 状态 |
| --- | --- | --- | --- |
| Tryp.com | AI「虚拟联程」拼低价机票+青旅成套餐(哥斯达黎加 8 天 $266),2025 年融资 >$3M | **原生** | 活得最好,横评冠军 |
| Gondola | 积分党酒店预订层,现金 vs 里程比价,2026 年中还发了 MCP server | 原生 | 活,细分可信 |
| Tripsy | Apple 生态行程整理器(邮件解析),4.7★,$59/年,不做 AI 规划 | 无 | 健康的独立开发者生意 |
| Airial | 前 Meta/Waymo 工程师,2025-06 $3M 种子(Montage/Peak XV) | — | 活,早期 |
| Trip Planner AI | 免费档常胜将军,干净的逐日行程 | link-out | 活 |
| Wonderplan | 「模板生成器」,编辑功能疑似坏了 | link-out | **僵尸/疑似弃维护** |
| Copilot2trip | 付费通道坏了、找不到客服 | link-out | 僵尸边缘 |
| iplan.ai | 30 秒出分钟级行程;JustUseApp 信誉分 33/100,频发 500 错 | link-out | 活但质量/运维堪忧 |
| SearchSpot / Wanderboat | 只在 AI 工具目录里出现,无独立评测/流量证据 | link-out | 活,零 traction |
| Roam Around | → Layla → Expedia,两度被吞;现存同名 App 是蹭名 clone | — | 已消亡 |

**死亡模式**:这个品类几乎没人公告关停——要么被吞并(Roam Around→Layla→Expedia、Thatch→Mindtrip、Lucia→Tern),要么转 B2B(GuideGeek、Tripesa),要么静默腐烂(Wonderplan、Copilot2trip)。「没有干净的关停公告」本身就是发现。

### 商旅 agent(简)

- **Otto**(Madrona 孵化,ex-Expedia CPO 掌舵,$6M 种子):**原生订**机+酒+租车(2026-07 补齐),建在 Spotnana/Booking 集成上,个人/SMB 免费 12 个月、赚佣金。活,早期营收,团队可信。
- **Navan Cognition/Ava**:~50% 客服交互端到端解决(含改签退订),公司自报口径。
- **TravelPerk**:AI 只做增量(查询/客服/费用 OCR),明显比 Otto/Navan 保守。

---

## 5. 横向结论与对 travel-agent 的含义

### 五条横向结论

1. **规划已商品化,预订没有。** 人人都能生成行程(Canvas 类体验最好);但 AI 带来的真实预订量,行业最大玩家亲口说 <1% 且不增长。「plan ≠ book」是 2026 年这个赛道唯一确定的事。
2. **闭环只在「结构化协议 + 支付伙伴」路径上成立**:Penny(自家供给)、Perplexity×Selfbook、Mindtrip×Sabre×PayPal、Google UCP(测试中)。全部依赖供给方主动配合;航司集体缺席,机票闭环全行业只有 Mindtrip 一例。
3. **通用 browser-use agent 被证伪,但证伪的是「无人值守通用 agent」**:<50% 成功率、CAPTCHA 即弃、慢 3–5 倍、Cloudflare 默认封锁、Amazon 诉讼。OpenAI/Google 都用产品动作(砍 Agent mode、支付前刹车)投了票。
4. **全能管家概念在两大巨头都失败了**(Romie 埋葬、Kayak.ai 退回 chat-beside-results),幸存形态是**专项化**:专项 agent、窄场景、明确边界。
5. **真实赚到钱的 AI 都不性感**:客服成本(Booking −10%/contact)、排序个性化、代码生产力。消费级对话层是意图捕获渠道,不是成交渠道。

### 对本仓库的含义(逐条对应设计文档)

1. **「一句话 → 停在支付页」的短闭环设计被双向验证。** 用户侧:全球仅 2% 愿全权交给 AI,「失控感」是头号顾虑——停在支付页恰好是把控制权还给用户的那个点。行业侧:所有代付尝试都退回了人工确认。001 §4.2 的 ceiling 默认值不是保守,是当前行业均衡点。
2. **本仓库的差异化恰好落在被证伪路线的「反例窗口」里。** 被证伪的是无人值守 + 无介入模型的通用 agent;Operator 实测三大死因(CAPTCHA 即弃、放弃任务、无人求助)每一条都对应 003 §7 的六类 `requestUserInteraction`——「遇阻求助人类」正是 Operator 缺的那块。用户在场 + 人机同页(002 §6.5 控制权状态机)是与 Operator 拉开差距的结构性设计,不是锦上添花。
3. **协议路线与浏览器路线的竞争边界清晰了**:协议路线覆盖「供给方愿意接协议的部分」(大酒店集团、420 航司经 Sabre),浏览器路线覆盖剩下的一切(没有 API 的携程活动、门票、小众供给)。两条路线不互斥——中国 OTA 全部无 agentic API,恰是浏览器路线在国内场景的天然空间。
4. **对抗环境在恶化,要有预案。** Cloudflare 2026-09-15 新政、Amazon v. Perplexity 判例未定。本仓库用「用户自己的 Chrome/IAB + 用户在场」与无人值守爬虫做切割,在事实和法律叙事上都站得住,但反爬升级(002 §11.2 已列为首要产品风险)值得持续监控。
5. **别做的事再次确认**:长驻进程/价格监控(Layla 的 PriceLock 没救它)、全能管家(Romie 之死)、纯 chat 界面(Kayak 用 10 万对话/月的数据退回了 chat-beside-results——对本仓库「左聊右览」双面板是直接背书)、消费级免费换增长(独立玩家全灭的路)。
