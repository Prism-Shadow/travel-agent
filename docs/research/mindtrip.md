# Mindtrip (mindtrip.ai) 产品调研

| | |
| --- | --- |
| 日期 | 2026-08-17 |
| 方法 | 三路并行网络调研(产品功能 / 公司与商业模式 / 市场反馈与竞品),来源以行业媒体(Skift、PhocusWire、TechCrunch)、官方 PR、第三方实测评测为主。初稿时 mindtrip.ai 本站有 Cloudflare 反爬,一手页面未能直接抓取;**2026-08-19 增补时经 Firecrawl 抓取成功**,官网一手信息见 §11 |
| 用途 | 竞品与路线参照。§10 是与本仓库(travel-agent)的对照,其余章节为客观调研 |
| 可信度 | 每条关键事实附来源链接;聚合站数据与公司自报口径单独标注 |

---

## 1. 一句话

Mindtrip 是目前独立 AI 旅行规划产品中的头部玩家。从「聊天生成行程」起家,2026 年押注 agentic 交易闭环,与 Sabre + PayPal 合作做出了**对话内直接出票付款的机票预订**(不跳转、不离开 chat),走的是 **API/GDS 直连**路线,与本仓库的**浏览器驱动**路线正好是同一问题的两个相反解。

## 2. 公司与融资

- **成立**:2023 年,总部 Palo Alto(一家聚合站写 San Francisco,Palo Alto 证据更强)。2024 年 5 月结束 beta 公开上线。
- **创始团队**:罕见的 12 人创始团队。CEO **Andy Moss**(创办并卖掉汽车电商 Roadster,更早在 FabKids、PopSugar/ShopStyle);**Trey Matteson**(Roadster 联合创始人);**Garrick Toubassi**(前 Gmail 工程负责人)。团队背景覆盖 Google、Apple、Stripe,现约 40–50 人。[TechCrunch](https://techcrunch.com/2023/09/07/mindtrip-ai-travel-agent/)
- **融资**:累计 **$22.5M**(公司口径,2025-12)。
  | 轮次 | 时间 | 金额 | 投资方 |
  | --- | --- | --- | --- |
  | Seed | 2023-09 | $7M | Costanoa Ventures 领投 |
  | Series A | 2024-09 | $12M | Forerunner Ventures 领投 |
  | 战略投资 | ≤2025-12 | 未披露(推算合计 ~$3.5M) | **Amex Ventures、Capital One Ventures、United Airlines Ventures** |
- 估值从未公开。第三方估 2025 年 ARR ~$3.6M(GetLatka,未经证实)。
- **收购**:2025-03 收购创作者旅行攻略平台 **Thatch**,并入 40,000+ 创作者攻略。[PhocusWire](https://www.phocuswire.com/mindtrip-thatch-merge-ai-travel-planning-creators)
- 战略投资方(运通、Capital One、美联航)同时是分销渠道布局。Skift 早在 2024-09 就指出 AI 行程规划赛道融资环境艰难;2026 年赛道的主旋律是整合(Roam Around→Layla→Expedia),Mindtrip 是少数仍独立且能从产业方融到钱的玩家。

## 3. 产品全景

### 3.1 核心流程:聊天 → 结构化行程

自然语言描述(支持多约束,如日期+机场+家庭构成)→ 生成按天、按早/午/晚分段的行程,每项是带图片、评价、价格、天气的 place card,全部落在交互地图上(酒店价格直接标在地图上、站点间车程、路线优化)。行程可对话式修改。实测亮点:知道卢浮宫周二闭馆而绕开、给圣米歇尔山附上潮汐时间、记得团队里有个 7 岁小孩并给出雨天备选。[aitravel.tools 实测](https://aitravel.tools/mindtrip-review/)

### 3.2 Start Anywhere™(2024-07):任何灵感 → 行程

贴 URL(博客/YouTube/TikTok)或传截图(Instagram/出版物),平台抽取地点并结合用户画像生成完整行程。也吃**订单确认邮件/收据**:转发到专属邮箱或传截图,解析航班号、确认码、预订信息进时间线。实测喂俄语 YouTube 视频也能识别内容、抽取地点、给出步行路线。这是他们对「灵感到行动」缺口的核心武器。[TechCrunch](https://techcrunch.com/2024/07/31/travel-startup-mindtrips-new-feature-lets-you-build-an-itinerary-from-a-screenshot-youtube-or-tiktok-video/)

### 3.3 其余面

- **Inspiration 信息流**:浏览其他用户/创作者的行程与攻略,带社交证明("Saved by 23 people"),评测称其为「AI 规划器 + 社交网络的混合体」。支持按主题收藏(Collections)、导入 Google Maps 收藏点。
- **群组协作**(2024-09 随 A 轮上线):共享行程实时协作编辑、点赞评论、群聊里 **@Mindtrip** 让 AI 平衡全组偏好给建议。依据是 90% 的人结伴出行、73% 以家庭为主。
- **移动端**(2025-06,iOS,4.7★/约 700 评分,无 Android 证据):定位「旅途中伴侣」,基于实时位置推附近景点/餐厅/活动,含 Magic Camera(拍照翻译+地标识别)、离线行程。
- **个性化**:注册问卷生成「travel persona」(海滩型/历史控/吃货等),随聊天、收藏行为持续更新,同时影响推荐和聊天语气。
- **创作者计划**(2024-07):创作者拿「magic link」嵌入内容,粉丝点击生成源自该内容的个性化行程;按注册付费(宣传语「最高月入 $10K」)、打赏、卖攻略。移动端有 Creator Hub 管理与收益面板。

## 4. 预订能力演进(本调研最重要的一章)

轨迹清晰:**affiliate 跳转(2024)→ 对话内原生 agentic 交易(2026)**。

| 时间 | 能力 | 形态 |
| --- | --- | --- |
| 2024-05 | 酒店/机票经 **Priceline**、活动经 **Viator** | 平台内下单,本质是合作方分销 |
| 2025-12 | 活动/演出/餐厅进入 in-app 预订 | 餐厅预订合作方(OpenTable?)未公开确认 |
| 2026-02 宣布,**2026-05-06 上线** | **Mindtrip Flights**:业内首个端到端 agentic 机票预订 | 对话内搜索→比价→**PayPal 钱包 in-chat 结账**(含 BNPL 分期),全程不跳转。库存来自 **Sabre Mosaic** agentic-ready Air API,420+ 航司、实时定价、出票与后服务 |
| 2026-07-15 | **Mindtrip Stays**:agentic 酒店 | 理解目标与取舍而非筛选器、主动追问、房型级分析、降价提醒;聚合 Priceline/Nuitee/Expedia/Booking/Agoda 多供给,**可原生预订也可跳转到用户选择的供应商**(混合模式) |

关键架构事实:Mindtrip 的 agentic 交易**不驱动浏览器**。它是对话前端 + GDS API(Sabre)+ 支付方 agentic checkout(PayPal 负责身份验证、支付、购买保护)。对比 OpenAI Operator 的浏览器驱动订票(实测被 CAPTCHA、会话超时、动态价格打败,某评测 3 次失败 2 次),Mindtrip 选了完全相反的架构,且 PhocusWire 报道 OpenAI 后来战略性收缩了直接预订。

覆盖缺口(实测,Stays 上线前):景点/门票仍是外链,且价格是**估算值,迪士尼门票虚高 20–30%**;没有租车。预订流恰好在转化时刻断裂。

## 5. AI 实现与防幻觉

- **模型**:公开绑定 **OpenAI / GPT-4o**(多模态输入支撑截图/视频→行程管线),2024 OpenAI DevDay Community Spotlight;2026 年是否仍是该模型未确认。未发现 Anthropic 关系。
- **护城河主张**(Moss):「就像曾经有垂直搜索,现在会有垂直 AI」。防幻觉核心是把 LLM 输出锚在自有结构化层上,**11M+ POI + 40k+ 本地攻略** + 合作方实时库存 + 地理数据,让推荐落到真实可订的实体(带图片/评价/营业时间/价格),而不是自由生成的文本。
- **实测口碑**:没发现编造地点,营业时间、车程、餐厅名都对;弱点是缺实时数据源的场景(景点票价)会给过期/估算价格。

## 6. B2B 线(第二收入曲线)

1. **Mindtrip for Business / DMO**(2024-11):把 AI 规划器嵌入目的地官网,**35+ 目的地客户**,旗舰是 **Brand USA**(2025-06,"America the Beautiful" 官网,6 语言)。另有 Visit California、Discover Puerto Rico、新奥尔良等。
2. **Mindtrip for Hotels**(2025-11):酒店官网嵌入式 AI 礼宾(代码片段接入),7×24 客询、地理围栏推荐优先自家与合作场所、店内二维码/SMS 入口、分析面板。
3. **Answer Intelligence**(2026-07):面向 DMO 的 AEO 分析产品,挖掘 Mindtrip 上数百万真实旅行者对话,告诉目的地「旅行者在问 AI 什么」、内容缺口在哪,按品牌语气起草 AI 优化内容。卖点数据是 70% 的 DMO 报告 AI 搜索导致自然流量下滑。

## 7. 商业模式小结

消费端**完全免费**(无付费墙、无消息限制),三条收入腿:预订佣金/affiliate、B2B SaaS 订阅、创作者生态(平台抽成逻辑未细披露)。战略投资方 = 分销与支付生态卡位(美联航、运通、Capital One 都有自家旅行门户诉求)。

## 8. 市场反馈

### 好评集中在

视觉化/地图中心的规划体验(AFAR 评为「最精致的 AI plan-and-book 工具」)、群组协作、社媒内容→行程的摄取能力、免费、预订整合逐步加深。iOS ~4.7★。Fast Company 2025 最具创新公司、PhocusWire Hot 25。

### 已证实的失败模式(多来源交叉)

1. **复合约束推理失败**:市中心 AND $300 以下,反复纠正仍只满足单条件(AFAR 实测)。
2. **时间错误**:把未来的出行日期断言为已过去(AFAR)。
3. **价格失真**:规划语境里给过期/估算价,虚高 20–30%。
4. **偶发地点幻觉**:多篇评测建议「下单前自查地点是否存在」。
5. **仲裁力弱**:「整理选项很强,替你做决定很弱」。多城市路线单薄,不帮用户做取舍(哪个街区通勤摩擦最小、多去一城值不值)。有评测总结出「第一小时惊艳、到预订环节悄悄流失」的流失模式。
6. **移动端卡顿**(App Store 差评)。
7. **结构性风险**:无自有流量入口,被 Google AI Mode(占灵感入口)和 OTA 助手(占供给与结账信任)两头夹击。
8. **社区声量反常地稀薄**:Reddit 上几乎搜不到自发讨论,与行业媒体热度不成比例;从未披露过绝对用户数或预订量。

## 9. 竞品格局与行业判断

| 竞品 | 相对 Mindtrip 的定位 |
| --- | --- |
| **Layla** | 最接近的独立对标,**2026-07-31 被 Expedia 收购**(约 €5M 融资、25 人)——赛道被验证的同时,最大的结构性对手拿到了同款武器 + 自有供给 |
| **Google AI Mode / Gemini** | 最大流量威胁。搜索内直接生成逐日行程 + Flights/Hotels/Maps 实时数据,2025-11 起在 200+ 国家开放 agentic 预订。文本为主,视觉与协作弱于 Mindtrip |
| **OpenAI Operator** | 通用浏览器驱动 agent,实测被 CAPTCHA/超时/动态价打败;OpenAI 已战略性收缩直接预订。与 Mindtrip 的 API 路线互为反面 |
| **Expedia**(Romie + Trip Match + Layla) | 正在组装全栈版 Mindtrip:群组助手、Reels→行程(直接对标 Start Anywhere)、自有供给 |
| **Booking.com AI Trip Planner** | 全球最大住宿供给上的对话层,强在行中服务(改签/取消);CEO Fogel 公开对 AI ROI 谨慎 |
| **Trip.com TripGenie** | 赛道**转化率的正面证据**:AI 辅助订单量 +400% YoY、60% 交互与预订相关、用户停留 2 倍(厂商自报)。亚洲强 |
| **飞猪 AI问一问** | 中国市场的 Mindtrip+OTA 合体。通义系多 agent(路线设计、酒店顾问、预算管理)接飞猪实时价格库存,站内成交;宣称 AI 流转化已不低于传统流 |
| 其他 | GuideGeek(WhatsApp 行中问答)、Wonderplan(模板生成器)、Tryp.com(穷游比价,某评测总分压过 Mindtrip)、Kayak AI(元搜索) |

行业层面的三个关键数字/判断:

- **采用是真的**:Skift 2025 调研,30% 美国旅行者重度用 AI 做行程规划,同比翻倍;Phocuswright 称之为「旅行行为最快的一次迁移」。
- **缺口是量化的**:社媒激发 ~$115B 旅行需求,只有 ~$7B 经社媒成交(Skift Research)——这正是 Mindtrip「inspiration into action」瞄的楔子。
- **转化怀疑论很响**:Phocuswright Europe 2026 有从业者直言对话漏斗「It's not working」,会话式搜索用得多、转化几乎没有;飞猪的反例主张在同一篇报道里。信任侧,68% 消费者仍选择信任的品牌下单而非 AI agent,但愿意在 AI 平台内下单的已升至 44%、愿意让 agent 代订的 40%,逐年上升。主要顾虑是失控感与数据隐私。[PhocusWire](https://www.phocuswire.com/news/technology/phocuswright-europe-2026-ai-trust-startup-future)

## 10. 对 travel-agent 的对照与启示

两个产品在「AI 帮人订旅行」这同一个问题上做了几乎每一项都相反的选择,对照本身就是信息:

| 维度 | Mindtrip | travel-agent(本仓库) |
| --- | --- | --- |
| 交易通路 | GDS/API 直连(Sabre Mosaic),供给方给 agentic-ready 接口 | 驱动真实网页(IAB WebContentsView / 用户 Chrome),供给方无需配合 |
| 支付 | PayPal agentic checkout,对话内完成,支付方承担身份验证与购买保护 | 停在支付页(ceiling `fill_form`),支付是 human-only;Phase 4 机器建成但 gated |
| 覆盖 | 只有接了 API 的供给(机票 420+ 航司、酒店聚合);景点/门票断裂 | 理论上任何网站,包括没有 API 的(携程只是演示场景) |
| 防幻觉 | 11M POI 自有数据层锚定 | 所见即所得,agent 操作的就是真实页面上的真实价格 |
| 长任务 | 有价格监控/降价提醒(Stays) | 明确不做长驻进程(001 的产品判断) |
| 隐私/凭证 | 托管给平台与 PayPal | 本地 Vault、OS keychain、模型无值原则 |

启示按重要性排:

1. **验证了「停在支付页不够」是行业共识的方向**。Mindtrip 2026 年全部重注都在打通「最后一公里」(in-chat 付款),且用户「愿意让 agent 代订」的比例在涨(40%)。本仓库 Phase 4 的支付执行机器方向正确,D3 隔离裁决的优先级应该上调,而不是当作可以无限期挂起的 gate。
2. **API 路线的天花板就是我们的机会**。Mindtrip 实测最被诟病的两点——景点/门票在转化时刻断裂成外链、缺 API 的场景只能给估算价——正是浏览器驱动路线天然没有的问题。OpenAI Operator 的失败(CAPTCHA/超时)说明浏览器路线难,但本仓库的 human-in-the-loop 介入模型(六类 `requestUserInteraction`、takeover)恰好是 Operator 缺的那块。
3. **「仲裁力弱」是全赛道的空位**。多家评测独立指出 Mindtrip「整理强、决策弱」,用户在第一小时惊艳、预订阶段流失。本仓库 001 的「压缩选项空间到少数代表 + 每个附理由」的 representatives 设计打的正是这个点,值得在产品叙事里明确对标。
4. **转化怀疑论要认真对待**。「会话漏斗不转化」的批评与 Trip.com/飞猪的反例并存,分野可能在于是否离交易足够近。这支持本仓库「一句话→停在支付页」的短闭环设计,反对往 inspiration/社区方向漂移。
5. **别学的部分**:Mindtrip 的社区/创作者/信息流是它作为免费消费产品换增长的打法,和本仓库的工具定位无关;其无绝对用户数、无预订量披露、Reddit 声量稀薄,也提示这条消费路线本身尚未自证。

## 11. 增补(2026-08-19):官网一手抓取 + UI 解剖

初稿未能抓到的 mindtrip.ai 首页本次抓取成功,连同 [aitravel.tools 实测](https://aitravel.tools/mindtrip-review/)的截图描述,补三类此前缺失的信息。

### 11.1 官网确认的功能矩阵与新功能

首页「🎉 New at Mindtrip」栏(初稿未覆盖):

- **Events**:按位置与偏好推荐附近的演出/市集/体育等活动,可直达购票。入口是预填 prompt 的 chat 链接(`/chat?q=What+are+some+upcoming+events+near+me...`)——**新功能以预填对话为入口,不另做垂直页面**,这个模式贯穿全站。
- **Google Pins 导入**:把 Google Maps 收藏点一键导入为主题 Collection,直接吃 Google 生态的存量沉淀(`/saved?tab=collections&import=google`)。
- **Collections + 协作**、**Start Anywhere®**(注册商标)在首页与 chat 入口并列为一级卖点。
- **Folio 收据管理**:上传或转发订单确认/收据到 `receipts@mindtrip.ai`,旅途中集中访问——行中侧的低调但完整的一环。

预订覆盖(首页「Organize it all in one place」栏,与 §4 互证):Hotels / Flights / Restaurants / Experiences 已上线;**Car Rental 与 Tours 标注 coming soon**——初稿写「没有租车」,现在是「租车在路线图上」。

数据伙伴(首页 footer「adventure allies」):**Priceline、Tripadvisor、Google Places、Viator**——§5 防幻觉锚定层的一手确认:POI 事实与评价来自 Tripadvisor + Google Places,交易库存来自 Priceline + Viator。

### 11.2 UI 解剖(对标重构参照)

从实测截图与官网页面归纳的界面结构,按信息层级:

1. **工作区 = chat + 交互地图双栏**:对话在左,右侧地图实时落点;酒店价格直接标在地图 pin 上;evaluations 一致认为这是与纯文本 chatbot 的决定性差异。
2. **行程视图**:按天分组、天内按 Morning / Afternoon / Evening 三段;每项是 activity card(图片+一句话理由+车程/距离);day view 将 card、笔记、地图放在同一工作区。
3. **Place card(地点详情)七个 tab**:Overview(简介+人口+实时天气+**建议追问**)/ Guides(社区攻略)/ Stays / Restaurants(带 $$ 价位档)/ Things to do / Reviews / Location(地图)。card 内嵌「继续对话」的建议问题按钮,把静态详情页拉回对话流。
4. **预订弹层**:点酒店出 popup,并列多渠道实时价(实测:Expedia $80 / Hotels.com $80 / Agoda / 官网直订),用户选渠道——**比价在卡片内完成,跳转只发生在最后一步**。
5. **预算表**:对话内生成分类汇总表(住宿/餐饮/门票/交通,含油耗、过路费明细),标注「估算」。
6. **分享/输出**:分享链接、二维码、**行程音频播报**(路上听行程)。
7. **入口设计**:首页所有功能演示的 CTA 都指向 `/chat`(常带预填 q 参数);chat 是唯一的功能中枢,其余页面(inspiration/saved/profile)都是喂给 chat 或从 chat 沉淀的。

### 11.3 对 §10 对照表的修正

- 「覆盖」行:Mindtrip 侧租车由「无」改为「coming soon」;门票/景点仍是外链+估算价,该缺口未变。
- §10 启示 2(API 路线天花板)不受影响:租车即使上线也是聚合库存路线,无 API 的长尾场景(本仓库的 Ctrip 演示场景属于此类)仍在其覆盖外。

## 附:时间线速查

| 时间 | 事件 |
| --- | --- |
| 2023-09 | 成立披露,$7M seed |
| 2024-05 | 公开上线(web),Priceline/Viator 预订 |
| 2024-07 | Start Anywhere + 创作者计划 |
| 2024-09 | $12M A 轮 + 群组协作 |
| 2024-11 | Mindtrip for Business(DMO) |
| 2025-03 | 收购 Thatch(40k 创作者攻略) |
| 2025-06 | iOS App;Brand USA 合作 |
| 2025-11 | Mindtrip for Hotels |
| 2025-12 | 活动预订;Amex/Capital One/美联航战投,累计 $22.5M |
| 2026-02 | Sabre + PayPal 合作宣布 |
| 2026-05-06 | **Mindtrip Flights 上线**(in-chat agentic 订票) |
| 2026-07-15 | Mindtrip Stays(agentic 酒店) |
| 2026-07-21 | Answer Intelligence(DMO AEO 分析) |
| 2026-07-31 | (竞品)Expedia 收购 Layla |
