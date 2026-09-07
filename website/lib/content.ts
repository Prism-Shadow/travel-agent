export type Locale = "zh" | "en";

export const links = {
  github: "https://github.com/Prism-Shadow/travel-agent",
  releases: "https://github.com/Prism-Shadow/travel-agent/releases/latest",
  downloadBase: "https://github.com/Prism-Shadow/travel-agent/releases/latest/download/",
  engine: "https://github.com/Prism-Shadow/penguin-harness",
  license: "https://github.com/Prism-Shadow/travel-agent/blob/main/LICENSE",
  guideZh: "https://github.com/Prism-Shadow/travel-agent/blob/main/README.zh.md",
  guideEn: "https://github.com/Prism-Shadow/travel-agent#readme",
  extension:
    "https://github.com/Prism-Shadow/travel-agent/tree/main/packages/browser-extension#getting-started",
};

export const downloads = [
  {
    system: "macOS",
    variants: [
      { name: "Apple silicon", file: "travel-agent-darwin-arm64.dmg" },
      { name: "Intel", file: "travel-agent-darwin-x64.dmg" },
    ],
  },
  { system: "Windows", variants: [{ name: "Windows · x64", file: "travel-agent-win32-x64.exe" }] },
  {
    system: "Linux",
    variants: [
      { name: "AppImage · x64", file: "travel-agent-linux-x86_64.AppImage" },
      { name: "Debian / Ubuntu", file: "travel-agent-linux-amd64.deb" },
    ],
  },
] as const;

export const demos = {
  route: {
    source: "https://github.com/user-attachments/assets/f785b356-7eaf-4535-927f-1912d3c88bc1",
    duration: "0:38",
  },
  hotel: {
    source: "https://github.com/user-attachments/assets/3665959b-3704-4f92-9cc6-cefd37326993",
    duration: "1:16",
  },
} as const;
export type DemoId = keyof typeof demos;

export const content = {
  zh: {
    locale: "zh-CN",
    title: "Travel Agent — 会操作浏览器的开源 AI 旅行助手",
    description:
      "会操作浏览器的开源 AI 旅行助手。查攻略、看路线、比较机票与酒店，在真实网页上推进旅行安排，最后付款由你完成。",
    skip: "跳转到主要内容",
    nav: ["功能", "任务演示", "使用指南"],
    menu: "打开导航",
    close: "关闭",
    language: "语言",
    theme: "主题",
    systemShort: "系统",
    languageOptions: { system: "跟随系统", zh: "简体中文", en: "English" },
    themeOptions: { system: "跟随系统", light: "浅色", dark: "深色" },
    download: "下载应用",
    downloadFull: "下载 Travel Agent",
    watch: "观看演示",
    eyebrow: "基于 PenguinHarness 构建",
    hero: ["会操作浏览器的", "开源 AI 旅行助手。"],
    intro: ["查攻略、看路线、比较机票与酒店。", "打开真实网页，帮你一步步推进旅行安排。"],
    key: "使用你自己的模型 API Key",
    artCaption: "下一程，一起安排。",
    heroAlt: "Travel Agent 桌面界面：左侧对话，右侧内置浏览器显示北京至上海的携程航班搜索结果",
    heroAction: "看看它如何完成旅行任务",
    heroCaption: "一句需求，对话和浏览器一起推进。",
    demoEyebrow: "看看它怎么做",
    demoLabels: ["路线规划", "酒店预订"],
    demoWalkthrough: "查看演示步骤",
    demoTitle: "把来回切换的网页，变成下一步。",
    demoIntro: "从找灵感，到核对每一个出行条件。看两段实际操作演示。",
    routeTitle: "从旅行攻略，到两日路线",
    routeDescription: "阅读小红书攻略，整理北京两日游顺序，再打开高德地图路线。",
    hotelTitle: "从筛选酒店，到确认预订",
    hotelDescription: "比较预算、评分和取消政策，选择房型并推进到支付页。",
    historical: "酒店演示含历史任务录屏，界面经过品牌更新；不代表当前版本的完整验收结果。",
    routeTranscript:
      "演示过程：提出北京两日游需求 → 阅读小红书攻略 → 整理景点和游玩顺序 → 打开高德地图路线。",
    hotelTranscript:
      "演示过程：提出住宿条件 → 比较酒店与房型 → 查看预订表单 → 到达支付页。最后付款由用户完成。",
    videoUnavailable: "视频暂时无法加载，可以打开原始视频重试。",
    videoOriginal: "打开原始视频",
    videoNote: "演示经过剪辑与加速，敏感信息已遮挡。",
    tripEyebrow: "围绕同一段旅程",
    tripTitle: ["聊过的计划，", "都回到这段行程。"],
    tripDescription: "交通、住宿和每日安排可以分开聊。目的地、日期与预算，在同一行程里延续。",
    tripPoints: [
      "共享出行条件，不必反复解释",
      "计划和讨论，放在同一段行程里",
      "行程文件保存在自己的电脑上",
    ],
    tripLink: "了解行程管理",
    tripAlt: "我的行程界面示例，包含上海、京都和里斯本的参考行程",
    tripCaption: "我的行程 · 界面示例",
    browserEyebrow: "在你熟悉的浏览器里",
    browserTitle: ["用应用内浏览器，", "也能连接自己的 Chrome。"],
    browserDescription:
      "在一个窗口里推进任务，或接着使用你熟悉的网站账号。开始任务前，选好这段对话使用的浏览器。",
    browserTabs: ["应用内浏览器", "Travel Browser"],
    browserDetails: [
      "默认使用。网页与对话并排显示，不需要安装 Chrome 扩展。",
      "连接你自己的 Chrome，延续网站登录状态。使用扩展时，请保持桌面应用运行。",
    ],
    browserAlt: ["应用内浏览器和对话并排展示", "Travel Browser 中文欢迎页与使用指南"],
    browserGuide: "查看 Chrome 扩展指南",
    controls: ["看得见操作", "选择后再继续", "付款由你完成"],
    startEyebrow: "准备好，就出发",
    startTitle: "三步开始，第一段旅行对话。",
    steps: [
      { title: "下载桌面应用", text: "选择适合你电脑的安装包，安装并打开 Travel Agent。" },
      { title: "配置你使用的模型", text: "在「模型配置」中填写自己的 API Key，选择使用的模型。" },
      { title: "说出你的旅行需求", text: "从一句话开始。先聊想法，也可以直接请助手查看旅行网站。" },
    ],
    example: "“周末想去上海，帮我看看地铁附近、每晚500元以内的酒店。”",
    exampleLabel: "从一个具体需求开始",
    faqTitle: "开始之前，你可能想知道",
    faqs: [
      {
        q: "使用 Travel Agent 需要付费吗？",
        a: "Travel Agent 是 Apache 2.0 开源项目。使用时需要配置自己的模型 API Key，模型调用费用由你选择的服务商收取。",
      },
      {
        q: "需要安装 Chrome 扩展吗？",
        a: "不需要。桌面应用默认使用内置浏览器。想在自己的 Chrome 中延续网站登录状态时，再安装 Travel Browser 扩展。扩展需要配合运行中的桌面应用使用。",
      },
      {
        q: "它会自动完成付款吗？",
        a: "不会。预订流程会在支付环节停下，由你在网页上完成最终付款。浏览器付款控件有工程拦截，但这不等同于完整的运行时安全隔离。",
      },
      {
        q: "我的行程数据保存在哪里？",
        a: "行程文件和对话数据保存在你的电脑上。模型请求会发送给你配置的服务商，浏览器会访问相应网站。本地保存不等于离线处理。",
      },
      {
        q: "安装时出现系统安全提示怎么办？",
        a: "当前安装包尚未进行代码签名。macOS 用户可在「系统设置 → 隐私与安全性」中确认打开；Windows 可能显示 SmartScreen 提示。请核对下载来源，并查看发布页的安装说明与 SHA256SUMS。",
      },
    ],
    downloadEyebrow: "为你的下一程准备",
    downloadTitle: "下一程，一起安排。",
    downloadDescription: "下载应用，配置模型，说出你的旅行需求。",
    allReleases: "全部版本与安装说明",
    checksum: "校验下载文件",
    unsigned: "当前安装包未签名；首次打开可能出现系统提示。",
    footerEngine: "基于 PenguinHarness 构建",
    footerTagline: "把旅行想法，慢慢变成下一程。",
    guide: "使用指南",
  },
  en: {
    locale: "en",
    title: "Travel Agent — Open-source AI travel assistant that operates your browser",
    description:
      "An open-source AI travel assistant that operates real websites. Research routes, compare flights and hotels, and keep the final payment in your hands.",
    skip: "Skip to main content",
    nav: ["Features", "Demos", "Get started"],
    menu: "Open navigation",
    close: "Close",
    language: "Language",
    theme: "Theme",
    systemShort: "System",
    languageOptions: { system: "Follow system", zh: "简体中文", en: "English" },
    themeOptions: { system: "Follow system", light: "Light", dark: "Dark" },
    download: "Download",
    downloadFull: "Download Travel Agent",
    watch: "Watch a demo",
    eyebrow: "BUILT ON PENGUINHARNESS",
    hero: ["Open-source travel AI", "that operates your browser."],
    intro: [
      "Find inspiration, plan routes, compare flights and hotels.",
      "An assistant that opens real websites to help you move forward.",
    ],
    key: "Bring your own model API key",
    artCaption: "Your next chapter, together.",
    heroAlt:
      "Travel Agent Desktop with a conversation beside Ctrip flight search results from Beijing to Shanghai",
    heroAction: "See a travel task in action",
    heroCaption: "One request. A conversation and a browser working together.",
    demoEyebrow: "SEE IT IN ACTION",
    demoLabels: ["ROUTE PLANNING", "HOTEL BOOKING"],
    demoWalkthrough: "View the walkthrough",
    demoTitle: "From switching tabs to taking the next step.",
    demoIntro:
      "From finding inspiration to checking the details. Watch two travel tasks in action.",
    routeTitle: "From travel guides to a two-day route",
    routeDescription:
      "Read Xiaohongshu guides, organize two days in Beijing, and open an Amap route.",
    hotelTitle: "From hotel search to your next booking",
    hotelDescription:
      "Compare budget, ratings and cancellation policies, choose a room, and reach the payment page.",
    historical:
      "The hotel demo includes historical task footage with updated branding; it is not a full acceptance test of the current release.",
    routeTranscript:
      "Demo walkthrough: request a two-day Beijing trip → read Xiaohongshu guides → arrange sights and visiting order → open an Amap route.",
    hotelTranscript:
      "Demo walkthrough: specify hotel requirements → compare hotels and rooms → review the booking form → reach the payment page. The user completes payment.",
    videoUnavailable: "The video could not load. You can open the original video to try again.",
    videoOriginal: "Open original video",
    videoNote: "Footage is edited and accelerated. Sensitive information is masked.",
    tripEyebrow: "ONE JOURNEY, ALL THE CONTEXT",
    tripTitle: ["All those plans.", "One place to return to."],
    tripDescription:
      "Keep transport, hotels and daily plans in separate conversations. Your destination, dates and budget stay with the same trip.",
    tripPoints: [
      "Shared requirements, without repeating yourself",
      "Plans and conversations, together in one trip",
      "Trip files stay on your own computer",
    ],
    tripLink: "Explore trip organization",
    tripAlt: "My trips reference screen with sample journeys to Shanghai, Kyoto and Lisbon",
    tripCaption: "My trips · Example interface",
    browserEyebrow: "A BROWSER THAT FEELS FAMILIAR",
    browserTitle: ["Built in to the app.", "Or connected to your Chrome."],
    browserDescription:
      "Keep the task in one window, or use the website accounts you already know. Choose the browser for each conversation before the task starts.",
    browserTabs: ["In-app browser", "Travel Browser"],
    browserDetails: [
      "The default experience. Websites appear beside your conversation, with no Chrome extension to install.",
      "Connect your own Chrome and keep your website sessions. Leave Travel Agent Desktop open while using the extension.",
    ],
    browserAlt: [
      "The in-app browser beside a conversation",
      "Travel Browser welcome page and setup guide",
    ],
    browserGuide: "Read the Chrome extension guide",
    controls: ["Visible browser actions", "Choose before continuing", "Payment stays with you"],
    startEyebrow: "READY WHEN YOU ARE",
    startTitle: "Three steps to your first travel conversation.",
    steps: [
      {
        title: "Get the desktop app",
        text: "Choose the installer for your computer, install it, and open Travel Agent.",
      },
      {
        title: "Connect your model",
        text: "Open Models, add your own API key, and select the model you want to use.",
      },
      {
        title: "Start with a travel question",
        text: "Talk through an idea, or ask the assistant to open a travel website and help with a task.",
      },
    ],
    example: "“A weekend in Shanghai. Help me find hotels near the metro for under ¥500 a night.”",
    exampleLabel: "Start with something specific",
    faqTitle: "A few things before you go",
    faqs: [
      {
        q: "Does Travel Agent cost money?",
        a: "Travel Agent is open source under Apache 2.0. You bring your own model API key; your model provider charges for the requests you make.",
      },
      {
        q: "Do I need the Chrome extension?",
        a: "No. The desktop app uses its built-in browser by default. Install Travel Browser if you want to use your own Chrome and existing website sessions. The extension needs the desktop app to stay open.",
      },
      {
        q: "Will it pay for a booking automatically?",
        a: "No. The booking flow stops at payment, where you complete the final step on the website. Payment controls have an engineering guardrail; this is not a claim of complete runtime isolation.",
      },
      {
        q: "Where does my trip data live?",
        a: "Trip files and conversation data stay on your computer. Model requests go to the provider you configure, and browser tasks visit the relevant websites. Local storage does not mean offline processing.",
      },
      {
        q: "Why does my computer show an installation warning?",
        a: "Installers are not code-signed yet. macOS may ask you to confirm opening the app in System Settings → Privacy & Security; Windows may show SmartScreen. Verify the download source and read the release instructions and SHA256SUMS.",
      },
    ],
    downloadEyebrow: "MAKE ROOM FOR YOUR NEXT ADVENTURE",
    downloadTitle: "Your next chapter, together.",
    downloadDescription: "Get the app. Connect your model. Tell us where you want to go.",
    allReleases: "All releases & installation guide",
    checksum: "Verify your download",
    unsigned: "Installers are currently unsigned. Your system may show a first-launch warning.",
    footerEngine: "Built on PenguinHarness",
    footerTagline: "A little help along the way.",
    guide: "Get started",
  },
} as const;
