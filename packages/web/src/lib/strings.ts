/**
 * UI copy (bilingual): this file holds the Chinese dictionary `zh` and the runtime
 * active dictionary `S`; the English dictionary lives in strings-en.ts (constrained
 * to the same shape by the `Strings` type). Locale preference is resolved by
 * state/locale.tsx, which calls `setActiveStrings` to switch and remounts the whole
 * tree keyed by locale, so `S.x` reads in components always reflect the current
 * language (module-level constants do not update on switch — keep reads inside components).
 * Keep domain terms capitalized in English — Workspace, Token, Task, Session, Project, Trace.
 * "agent" is a common noun: lowercase mid-sentence, capitalized only at the start of a
 * label/sentence or in a proper name (Agent State, AgentHub). zh keeps "Agent" as-is.
 */
export const zh = {
  appName: "Travel Agent",

  nav: {
    chat: "对话",
    newChat: "新对话",
    models: "模型配置",
    // Collapsed-rail tooltip (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "最近一次对话",
    collapseSidebar: "收起侧栏",
    expandSidebar: "展开侧栏",
    collapseGroup: "折叠",
    expandGroup: "展开",
    pinGroup: "置顶分组",
    unpinGroup: "取消置顶",
    settings: "设置",
  },

  /** 行程：产品的第一对象。侧边栏、行程卡片与归属菜单共用这组文案。 */
  trip: {
    trips: "行程",
    newTrip: "新行程",
    noTrips: "还没有行程。说一句话就能开始。",
    untitled: "未命名行程",
    /** 不属于任何行程的对话分组：它是正常状态，不是待办。 */
    scratch: "随手问",
    newChatInTrip: "在此行程中新建对话",
    openTrip: "打开行程",
    notFound: "找不到这个行程。它可能已在别处被删除。",
    backToChat: "返回对话",
    rename: "重命名",
    deleteTrip: "删除行程",
    deleteTripConfirm: (name: string) =>
      `删除行程「${name}」？它的对话会保留（变成「随手问」）。磁盘上的文件夹只要装过东西就留着——那些文件是你的；从未写入过任何内容的空文件夹会一并清掉。`,
    conversations: "对话",
    noConversations: "这个行程还没有对话。",
    itinerary: "行程单",
    noItinerary: "还没有行程单。agent 在工作产生值得留存的内容时会写入它。",
    itineraryUpdated: (when: string) => `更新于 ${when}`,
    moveToTrip: "移入行程",
    removeFromTrip: "移出行程",
    folderMissing: (dir: string) => `找不到行程文件夹：${dir}`,
    folderMissingShort: "文件夹已移动或删除",
    meta: {
      dateRange: (start: string, end: string) => `${start} 至 ${end}`,
      dateFrom: (start: string) => `${start} 出发`,
      dateUntil: (end: string) => `${end} 前返回`,
      flexible: (days: number, month: string) => `${month} 内 ${days} 天`,
      flexibleAnyMonth: (days: number) => `${days} 天，时间灵活`,
      flexibleMonthOnly: (month: string) => `${month} 内`,
      travellers: (n: number) => `${n} 人`,
      /** ¥ is unambiguous here: the product's market prices trips in RMB. */
      budgetAmount: (yuan: number) => `¥${yuan.toLocaleString("en-US")}`,
      budgetTiers: {
        any: "预算不限",
        low: "经济",
        mid: "舒适",
        high: "高档",
        luxury: "奢华",
      },
      separator: " · ",
    },
  },

  settings: {
    language: "语言",
    /** Admin-only user-menu row opening the proxy options dialog. */
    proxyMenu: "代理选项",
    proxyDialogTitle: "代理选项",
    /** The dialog's two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "应用程序使用代理",
    proxyForAgent: "Agent 环境使用代理",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "代理地址",
    proxyAddressPlaceholder: "留空 = 跟随系统代理",
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    followSystem: "跟随系统",
    langZh: "中文",
    langEn: "English",
    fontSize: "字号",
    fontSmall: "小",
    fontMedium: "中",
    fontLarge: "大",
    accent: "主题色",
    accentNames: {
      neutral: "灰白",
      blue: "蓝",
      green: "绿",
      violet: "紫",
      rose: "红",
      amber: "橙",
    } as Record<string, string>,
  },

  /** Version footer, update reminder, and admin self-update in the sidebar user menu. */
  update: {
    /** Version-line date label (owner-specified wording); `date` is formatMonthDay output. */
    lastUpdated: (date: string) => `最近更新日期 ${date}`,
    /** Superscript badge on the version lines when the update check found a newer release (owner-specified wording). */
    newVersionBadge: "有新版本可用",
    newVersion: (v: string) => `新版本 v${v} 可用`,
    /**
     * The sidebar user menu's SINGLE update row: it reads checkNow until a newer release
     * is known and runs the manual check; once one is known it reads newVersion() and
     * opens the update dialog instead (which carries the release-notes link and, for
     * admins, the self-update action).
     */
    checkNow: "检查更新",
    checking: "检查中…",
    /** Success toast when the manual check finds a newer release; the row below turns into the update entry. */
    foundNew: (v: string) => `发现新版本 v${v}，点击下方更新入口即可安装`,
    upToDate: "已是最新版本",
    checkFailed: "检查更新失败，请稍后重试",
    checkDisabled: "更新检查已关闭（PENGUIN_UPDATE_CHECK=off）",
    releaseNotes: "更新说明",
    updateNow: "立即更新",
    updating: "更新中…",
    updated: "更新完成，重启服务后生效",
    restartHint: "在终端重新运行 penguin web（或 penguin server）即可完成重启",
    failed: "更新失败",
    unsupported: "当前安装方式不支持在线更新",
    confirmBody:
      "将下载最新版本并安装到服务器上的安装目录（数据目录不受影响）。安装完成后需要重启服务才会生效。",
    /** Copy shown to non-admins in place of confirmBody (they can read the release notes but cannot run the update here). */
    adminOnly: "只有管理员可以在这里执行更新。",
  },

  /** Desktop task-completion notifications (window unfocused; desktop-shell sessions only). */
  notify: {
    taskCompleteTitle: "任务完成",
    /** `session` is the Session title (defaultSessionTitle when unnamed). */
    taskCompleteBody: (session: string): string => `「${session}」已完成，点击查看`,
  },

  common: {
    save: "保存",
    cancel: "取消",
    create: "创建",
    delete: "删除",
    edit: "编辑",
    settings: "设置",
    confirm: "确认",
    close: "关闭",
    loading: "加载中…",
    saved: "已保存",
    saving: "保存中…",
    /** Clicking save with nothing changed: an info toast instead of a silent no-op. */
    noChangesToSave: "当前没有需要保存的修改",
    /** Confirm-before-save dialog shared by the settings forms (writes go to server-side config files). */
    confirmSaveTitle: "保存修改",
    confirmSaveBody: "确定保存这些修改吗？修改将写入服务器上的配置文件。",
    none: "（无）",
    retry: "重试",
    unknownError: "请求失败，请稍后重试",
    requiredField: "此项必填",
    copied: "已复制",
    name: "名称",
    username: "用户名",
    role: "角色",
    actions: "操作",
    created: "创建时间",
    cost: "成本",
    time: "时间",
  },

  auth: {
    usernameHint: "2~32 位：小写字母开头，仅小写字母、数字与下划线",
    password: "密码",
    passwordHint: "至少 8 个字符",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    login: "登录",
    logout: "登出",
    admin: "管理员",
    defaultAdminNote:
      "首次使用请以内置管理员 admin 登录，初始密码在服务端首次启动时打印（形如 penguin-1234），登录后请尽快修改密码",
  },

  account: {
    changePassword: "修改密码",
    oldPassword: "当前密码",
    oldPasswordHint: "内置管理员的初始密码在服务端首次启动时打印（形如 penguin-1234）",
    newPassword: "新密码",
    confirmPassword: "确认新密码",
    passwordMismatch: "两次输入的新密码不一致",
    initialPasswordBanner: "当前账号正在使用初始密码，建议尽快修改",
    changeNow: "去修改",
  },

  privateProfile: {
    menu: "私密资料",
    title: "私密资料",
    subtitle: "集中管理旅行时会用到的个人资料与偏好；每次使用前都会单独征求你的同意。",
    backToChat: "返回对话",
    tabOverview: "概览",
    tabPersonal: "个人资料",
    tabPreferences: "偏好",
    tabPrivacy: "隐私与活动",
    addDetails: "添加资料",
    add: "添加",
    notSaved: "未保存",
    editingUnavailable: "当前版本尚未接通私密资料的读写接口，因此不会保存任何输入。",
    why: "为什么？",
    personalTitle: "个人资料",
    personalDescription: "姓名与联系信息。只会在你批准的任务和站点中使用。",
    preferencesTitle: "旅行偏好",
    preferencesDescription: "帮助 Agent 缩小选择范围的普通偏好。",
    identityTitle: "证件与电话",
    identityDescription: "这些字段需要更强的运行时隔离，Agent 只能通过不透明引用请求代填。",
    fieldFullName: "姓名",
    fieldEmail: "联系邮箱",
    fieldBirthDate: "出生日期",
    fieldHomeCity: "常住城市",
    fieldSeat: "座位",
    fieldRoom: "房型",
    fieldBreakfast: "早餐",
    fieldPassport: "护照号码",
    fieldPhone: "手机号码",
    fieldAddress: "详细地址",
    storageCheckingTitle: "正在检查私密存储",
    storageCheckingDescription: "正在读取当前运行形态的真实能力状态。",
    storageLoadFailedTitle: "无法读取私密存储状态",
    storageLoadFailedDescription: "能力接口暂时不可用；在状态确认前不会开放资料编辑。",
    storageAvailableTitle: "已在本机加密",
    storageAvailableDescription: "普通资料可由桌面应用使用操作系统密钥保护并保存在本机。",
    storageDesktopTitle: "请在桌面应用中使用",
    storageDesktopDescription: "当前是独立 Web 服务，没有桌面外壳，也没有可替代的私密存储后端。",
    storageDeniedTitle: "本机无法启用私密存储",
    storageDeniedDescription: "所需的加密存储条件未通过检查，保管库已按失败关闭处理。",
    storageOffTitle: "私密存储尚未启用",
    storageOffDescription: "当前构建没有请求启用私密资料保管库。",
    approvalTitle: "每次使用都要询问",
    approvalDescription:
      "授权只覆盖一次任务、一个站点、一个用途和你批准的精确字段；任一项改变都会再次询问。",
    localOnlyTitle: "资料不经过服务器",
    localOnlyDescription: "保管库位于桌面主进程；需要代填的敏感字段不会进入模型上下文。",
    l2AvailableTitle: "证件与联系方式可安全代填",
    l2UnavailableTitle: "证件与联系方式暂不可用",
    l2UnavailableDescription: "在 Agent 运行时隔离得到证明前，证件号码、电话和详细地址保持关闭。",
    neverStoredTitle: "这些内容永不保存",
    neverStoredDescription:
      "银行卡安全码、一次性验证码、账户密码、支付密码和 passkey 必须由你每次亲自输入。",
    privacyTitle: "隐私边界",
    privacyDescription: "这里显示产品当前真正能保证的边界，不用模糊的“安全”开关代替。",
    activityTitle: "使用活动",
    activityUnavailable: "审计记录尚未接入这个界面；这里不会用空白列表冒充“从未使用”。",
    deleteAll: "删除全部私密资料",
    available: "可用",
    unavailable: "不可用",
    always: "始终",
  },

  admin: {
    users: "用户管理",
    roleAdmin: "管理员",
    roleUser: "用户",
    initialPassword: "初始密码",
    initialPasswordFlag: "初始密码",
    resetPassword: "重置密码",
    resetPasswordTitle: (u: string): string => `重置 ${u} 的密码`,
    resetPasswordNote: "重置后该用户的登录会话全部失效，需用新密码重新登录",
    deleteUserTitle: (u: string): string => `删除用户 ${u}`,
    deleteUserConfirm: (u: string): string =>
      `将删除用户 ${u} 及其名下全部 Project（含数据目录），不可恢复。`,
  },

  project: {
    switcher: "Project",
    create: "新建 Project",
    createTitle: "新建 Project",
    id: "Project id",
    idHint: "2~64 位：小写字母开头，仅小写字母、数字与下划线；创建后不可修改",
    idPrefixHint: "id 固定以「用户名-」为前缀，后接小写字母、数字或下划线；创建后不可修改",
    name: "显示名（可选，缺省为 Project id）",
    /** Display-name field in Project settings (required here, unlike the create dialog's "optional" wording). */
    displayName: "显示名",
    settings: "Project 设置",
    settingsTitle: "Project 设置",
    members: "成员",
    addMember: "添加成员",
    removeMember: "移除",
    /** New-conversation defaults section (Project settings): prefills each new conversation's agent / working directory / approval mode / thinking level / default model. */
    chatDefaultsTitle: "新对话默认值",
    chatDefaultsHint: "新建对话时预填的默认值：Agent、工作目录、审批模式、思考等级与默认模型。",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "未设置",
    chatDefaultsApprovalNotSet: "未设置（默认全部放行）",
    chatDefaultsThinkingNotSet: "未设置（跟随智能体配置）",
    chatDefaultsWorkspaceHint: "留空表示使用临时工作区",
    /** The model default shares its source with the Models page (the same default_model); this is just another entry point. */
    chatDefaultsModelHint: "与模型页的默认模型同步",
    deleteProject: "删除 Project",
    deleteConfirm: "确认删除该 Project？项目目录将被递归删除，不可恢复。",
    deleteDefaultForbidden: "default_project 与 CLI 共用，不允许在 Web 端删除",
    deleteLastForbidden:
      "这是当前账号最后一个 Project，删除后将无 Project 可用；请先创建新的 Project",
    noCredentialTitle: "尚未配置模型 credential",
    noCredentialBody: "当前 Project 的默认模型尚未配置 API key，发起对话前请先前往模型页配置。",
    goToModels: "前往模型页",
    later: "稍后再说",
  },

  agent: {
    listTitle: "Agents",
    create: "创建 Agent",
    createTitle: "创建 Agent",
    id: "Agent id",
    idHint: "2~64 位：小写字母开头，仅小写字母、数字与下划线；创建后不可修改",
    nameHint: "留空则使用 Agent id 作为名称",
    description: "描述",
    sessionCount: (n: number): string => `${n} 个 Session`,
    toolCount: (n: number): string => `${n} 个工具`,
    vaultKeyCount: (n: number): string => `${n} 个密钥`,
    scheduleCount: (n: number): string => `${n} 个定时任务`,
    memoryCount: (n: number): string => `${n} 条记忆`,
    updatedAt: "最后修改",
    activity: (days: number): string => `近 ${days} 天 Session 活跃度`,
    settings: "Agent 设置",
    backToList: "返回 Agents",
    tabOverview: "概览",
    tabPrompt: "系统提示词",
    tabMemory: "记忆",
    tabRuntime: "运行参数",
    tabTools: "工具",
    tabSkills: "技能",
    tabVault: "密钥保险柜",
    tabSchedules: "定时任务",
    stateDir: "State 路径",
    copyStateDir: "复制 State 路径",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt 模板",
    placeholdersTitle: "可用占位符（点击插入）",
    insertPlaceholder: "插入到 system_prompt 光标处",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). Inner tokens ({{VAULT_KEYS}} 等) live in each feature tab's promptPlaceholders instead. */
    placeholders: [
      ["{{AGENTS_MD}}", "注入 AGENTS.md 内容"],
      ["{{VAULT}}", "注入保险柜区块（vault.prompt，含键名清单）；开关关闭时为空"],
      ["{{SKILLS}}", "注入技能区块（skills.prompt，含已安装技能元数据）；开关关闭时为空"],
      [
        "{{MEMORY}}",
        "注入记忆区块：memory.prompt 加 memory.workspace_prompt（仅持久工作区）；关闭记忆时为空",
      ],
      ["{{SCHEDULES}}", "注入定时任务区块（schedules.prompt，含任务名清单）；开关关闭时为空"],
      ["{{PLATFORM}}", "运行平台"],
      ["{{OS_VERSION}}", "操作系统版本"],
      ["{{SHELL}}", "命令执行使用的 Shell"],
      ["{{DATE}}", "当前日期"],
      [
        "{{PROJECT_DIR}}",
        "PenguinHarness 应用数据根目录（存放全部 Agent 数据与 Project 级数据；不是本次任务的工作目录）",
      ],
      ["{{AGENT_ID}}", "当前 Agent id"],
      ["{{CWD}}", "Workspace 绝对路径"],
      ["{{PROVIDER}}", "模型 provider 分组"],
      ["{{MODEL_ID}}", "上游模型 id"],
      ["{{SESSION_ID}}", "当前 Session id"],
    ] as ReadonlyArray<readonly [string, string]>,
    maxTurns: "max_turns（单 Task 最大轮次，-1 不限制）",
    maxTokens: "model.max_tokens",
    thinkingLevel: "model.thinking_level",
    /** Selectable tiers exclude `none` (many models cannot disable thinking); a stored `none` still displays — see `thinkingLevelNoneKept`. */
    thinkingLevelOptions: [
      ["", "不提交覆盖值，沿用当前生效的配置。"],
      ["low", "开启较低强度的扩展推理。"],
      ["medium", "开启中等强度的扩展推理（新建 Agent 的缺省档位）。"],
      ["high", "开启较高强度的扩展推理，响应更慢。"],
      ["xhigh", "开启最高强度的扩展推理，部分模型上效果与 high 相同。"],
    ] as ReadonlyArray<readonly [string, string]>,
    /** Row description shown only while the stored config is `none`: displayed as-is, never rewritten, and no longer offered as a choice. */
    thinkingLevelNoneKept: "已存的历史档位：新选择不再提供关闭档（多数模型不支持关闭思考）。",
    timeoutMs: "model.timeoutMs",
    timeoutMsHint: "单次 Request 超时，毫秒",
    compaction: "上下文压缩（compaction）",
    maxContextLength: "max_context_length",
    maxContextLengthHint: "触发压缩的上下文阈值",
    maxSessionTurns: "max_session_turns",
    maxSessionTurnsHint: "触发压缩的轮数阈值",
    compactionMode: "mode（压缩方式）",
    compactionModeOptions: [
      ["", "不提交覆盖值，沿用当前生效的配置。"],
      ["summarize", "先让模型为旧上下文生成摘要，再从摘要续接新的上下文窗口（缺省）。"],
      ["discard", "不生成摘要，直接丢弃旧上下文，下一轮从新窗口重新开始。"],
    ] as ReadonlyArray<readonly [string, string]>,
    compactionPrompt: "prompt（摘要提示词）",
    maxTurnsInvalid: "max_turns 必须 > 0 或为 -1",
    timeoutInvalid: "timeoutMs 必须 > 0 或为 -1",
    toolFieldInvalid: (name: string, field: string) => `${name}: ${field} 必须是 > 0 的整数或 -1`,
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "仅读取。审批模式为 read-only 时自动放行，无需确认。",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription: "可修改。审批模式为 read-only 时需人工确认。",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    toolCallDescription: "call_description",
    callDescriptionHint:
      "call_description：开启（缺省）时该工具的 schema 保留可选的 description 参数——模型为每次调用写一句说明，运行期间展示给用户；关闭则装配时从 schema 滤除该参数。仅参数中定义了 description 属性的工具可切换。",
    mcpServers: "MCP Server",
    mcpDesc:
      "连接外部 MCP Server：其工具以 mcp__<name>__<tool> 并入本 Agent 的工具列表。此区块的改动即时保存。",
    mcpEmpty: "尚未配置 MCP Server",
    mcpAdd: "添加 MCP Server",
    mcpEditTitle: "编辑 MCP Server",
    mcpRemove: "删除",
    mcpName: "name",
    mcpNameHint: "工具名前缀：mcp__<name>__<tool>；限字母、数字、_ 和 -",
    mcpTransport: "transport",
    mcpTransportStdio: "本地进程：启动 command 后经 stdin/stdout 通信",
    mcpTransportHttp: "Streamable HTTP：当前规范的远程 transport",
    mcpTransportSse: "旧版 HTTP+SSE：仅为未迁移的服务保留",
    mcpTarget: "command / url",
    mcpCommand: "command",
    mcpArgs: "args",
    mcpArgsHint: "每行一个参数",
    mcpEnv: "env",
    mcpEnvHint: "每行一条 KEY=value；Agent vault 不注入 MCP Server 进程",
    mcpCwd: "cwd",
    mcpCwdHint: "留空则使用本次 Session 的 Workspace",
    mcpUrl: "url",
    mcpHeaders: "headers",
    mcpHeadersHint: "每行一条 Header-Name: value（如 Authorization 等认证头）",
    mcpConnectTimeout: "connectTimeoutMs",
    mcpBudgetsHint:
      "留空使用默认值：connectTimeoutMs 是连接与工具发现预算（默认 10000）；timeoutMs / maxOutputLength 作用于该 Server 的全部工具。",
    mcpNameInvalid: "限字母、数字、_ 和 -，且以字母或数字开头",
    mcpUrlInvalid: "必须是合法的 http(s) URL",
    mcpLineInvalid: (line: number): string => `第 ${line} 行格式无效`,
    mcpNumberInvalid: "必须是 > 0 的整数",
    mcpDuplicateName: "同名 Server 已存在",
    mcpTest: "测试连接",
    mcpTesting: "测试中…",
    mcpTestOk: (toolCount: number, latencyMs?: number): string => {
      const timing = latencyMs !== undefined ? `（${(latencyMs / 1000).toFixed(1)}s）` : "";
      return toolCount === 0
        ? `连接成功，但该 Server 未暴露任何工具${timing}`
        : `连接成功，发现 ${toolCount} 个工具${timing}`;
    },
    mcpTestFail: (detail: string): string => `连接失败：${detail}`,
    mcpTestAllConfirm: (n: number): string =>
      `将逐一连接已配置的 ${n} 个 MCP Server 并做工具发现（真实连接，不保存任何改动），结果显示在各行上。`,
    mcpTestAllStart: "开始测试",
    mcpTestPending: "测试中…",
    mcpTestBadge: (toolCount: number, latencyMs?: number): string =>
      `${toolCount} 个工具${latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}`,
    mcpTestBadgeFail: "连接失败",
    mcpDeleteTitle: "删除 MCP Server",
    mcpDeleteConfirm: (name: string): string =>
      `确认删除 MCP Server「${name}」？其工具自下次 Session 起不再可用。`,
    defaultValue: "（缺省）",
    /** Reset link next to the runtime dropdowns: rewinds the local pick back to "not overridden" (the menus offer no inherit row). */
    deleteAgent: "删除 Agent",
    builtinUndeletable: "内置 Agent 不可被删除",
    deleteConfirm: (name: string): string =>
      `确认删除 Agent「${name}」？其目录（含全部 Trace）将被递归删除，不可恢复。`,
    /** Agent State section: the State version with the snapshot transfer actions, plus the copyable State path. */
    stateTitle: "Agent State",
    stateVersion: "Agent State 版本",
    transferDesc: "导出当前 Agent State 快照包（tar.gz）；导入整目录覆盖，并以包内版本为准。",
    exportSnapshot: "导出快照",
    importSnapshot: "导入快照",
    importing: "导入中…",
    importDone: (v: number): string => `导入完成，Agent State 版本 v${v}`,
    importConflictTitle: "版本冲突",
    importConflictBody: "快照包版本不高于当前版本，导入将覆盖现有 Agent State。确认继续？",
    resetConfigTitle: "还原为默认配置",
    resetConfigAction: "还原为默认配置",
    resetConfigConfirmBody:
      "此操作会用当前默认值覆盖该 Agent 的现有配置：自定义系统提示词、工具列表、模型/压缩参数与 MCP Server 全部被替换，仅保留名称与描述。与 Skill 更新一样不可撤销，确认继续？",
    resetConfigDone: "配置已还原为当前默认值",
    /** Kernel section: which defaults generation the config is based on (dates; unrelated to the optimization counter shown as stateVersion), with the update / restore actions. */
    kernelTitle: "内核",
    kernelLegacy: "早于内核版本机制",
    kernelOutdatedHint: "内核有更新",
    kernelUpToDate: "已是最新",
    kernelUpdateTitle: "更新内核",
    /** Inline labels around the outdated line's two generation values (the values themselves render dark and semibold). */
    kernelCurrent: "当前",
    kernelLatest: "最新",
    kernelUpdateAction: "更新内核",
    kernelUpdateConfirmBody:
      "将把未自定义的字段更新为当前内置默认值；自定义过的字段保持不变并在结果中列出。名称、描述、版本号与 MCP Server 不受影响。确认继续？",
    kernelUpdateDone: (version: string, advanced: number): string =>
      advanced > 0
        ? `内核已更新至 ${version}，${advanced} 个字段跟进新默认`
        : `内核已更新至 ${version}，字段均已是当前默认或保持自定义`,
    kernelUpdateKeptIntro: "以下字段因自定义被保留：",
    kernelListSeparator: "、",
    /** Display name of a per-tool merge leaf (`tools.builtin.<name>`) in the kept/advanced lists. */
    kernelFieldTool: (name: string): string => `工具 ${name}`,
    /** Display names of the fixed kernel merge leaves (dotted config paths); unknown paths fall back to the raw path. */
    kernelFields: {
      system_prompt: "系统提示词模板",
      max_turns: "单任务最大轮数",
      "model.max_tokens": "模型最大输出 Token",
      "model.thinking_level": "思考力度",
      "model.timeoutMs": "请求超时",
      "compaction.max_context_length": "压缩上下文阈值",
      "compaction.max_session_turns": "压缩会话轮数阈值",
      "compaction.mode": "压缩模式",
      "compaction.prompt": "压缩提示词",
      "memory.enabled": "记忆开关",
      "memory.prompt": "记忆提示词",
      "memory.workspace_prompt": "工作区记忆提示词",
      "vault.enabled": "Vault 小节开关",
      "vault.prompt": "Vault 提示词",
      "skills.enabled": "技能小节开关",
      "skills.prompt": "技能提示词",
      "schedules.enabled": "定时任务小节开关",
      "schedules.prompt": "定时任务提示词",
    } as Record<string, string>,
  },

  models: {
    keyConfigured: "已配置",
    testConnection: "测试连接",
    testing: "测试中…",

    title: "模型配置",
    addCustom: "添加自定义模型",
    addToGroup: "新增模型",
    editTitle: "模型配置",
    addTitle: "新增模型（OpenAI 协议）",
    addTitleVendor: "新增模型",
    addProtocolHint: "新增模型走 OpenAI Chat Completions 兼容协议，base URL 填其兼容端点",
    /** Add-dialog note for preset direct-vendor groups (fed the provider label): states whose protocol the group speaks — the in-field suffix on the base URL shows which path. */
    vendorProtocolHint: (vendor: string): string =>
      `仅支持 ${vendor} 官方接口协议，OpenAI 兼容接口请使用自定义模型分组`,
    /** Non-blocking warning under the model id (preset direct-vendor groups, adding): the typed id is not a recognized official model id. */
    autoRouteNone:
      "该 id 不是可识别的官方模型 id：请核对，或改在 Custom / 自建分组以 OpenAI 兼容接口接入",
    addGroup: "新增分组",
    addGroupTitle: "新增分组",
    addGroupDesc:
      "自建分组与 Custom 同语义：组内模型走 OpenAI Chat Completions 兼容协议（base URL 必填，API key 留空读取 OPENAI_API_KEY）。分组由模型条目承载，保存首个模型后即出现。",
    groupNameLabel: "分组名",
    groupNameHint: "小写字母 / 数字开头，可含 - 与 _",
    groupNameInvalid: "分组名只能用小写字母、数字、- 与 _（首字符为字母或数字），长度不超过 32",
    groupNameExists: "该分组名已被内置分组或既有条目占用",
    groupEmptyHint: "该分组暂无模型，点「新增模型」添加",
    searchPlaceholder: "搜索模型：id / 名称 / 厂商",
    noSearchResults: "没有匹配的模型",
    syncCatalog: "同步预置",
    syncCatalogHint:
      "用内置目录更新预置模型：新增缺失条目、以目录字段为准刷新差异；本地新增模型与 API key 保持不变",
    syncDone: (added: number, updated: number) => `预置模型已同步：新增 ${added}、更新 ${updated}`,
    syncUpToDate: "预置模型已是最新",
    homepage: "模型主页",
    speedTest: "测速",
    speedTestTitle: "分组测速",
    speedTestConfirm: (n: number): string =>
      `将对该分组的 ${n} 个模型逐个发起一次真实请求,测量首 token 延迟(TTFT)与输出速率(TPS),会消耗少量 API 额度。是否继续?`,
    speedTestStart: "开始测速",
    speedPending: "测速中…",
    speedFailed: "测速失败",
    ttftTitle: "首 token 延迟(TTFT)",
    tpsTitle: "输出速率(TPS)",
    modelCount: (n: number): string => `${n} 个模型`,
    modelId: "模型 ID",
    modelIdHint: "上游 API 使用的模型 id，如 gpt-5.5",
    displayName: "模型名称",
    displayNameHint: "留空则展示模型 ID",
    providerGroup: "分组",
    contextWindow: "上下文窗口",
    /** Unit suffix shown inside the right edge of the context-window / max-output-length inputs. */
    tokenUnit: "Token",
    contextWindowHint: "留空表示未知",
    maxTokens: "最大输出长度",
    /** Placeholders cannot scroll, so this must fit the half-width box; the full guidance is the input's title tooltip (the owner prefers no visible hint line — saves vertical space). */
    maxTokensHint: "留空沿用 Agent 设置",
    maxTokensTitle:
      "按模型限制单次请求的最大输出 Token 数；留空沿用 Agent 设置，小上下文模型建议调低",
    maxTokensInvalid: "必须为正整数",
    clientTypeLocked: (t: string): string => `协议：${t}（沿用原配置，不可修改）`,
    /** Switch label only — the dialog carries no explanation text for it (per owner). */
    vision: "支持视觉",
    /** Shown only while the vision switch is OFF: images are then read via the configured vision proxy model (describe_image). */
    visionOffProxyHint: "使用视觉代理模型读图",
    visionBadge: "视觉",
    /** Light-yellow badge on zero-cost models (all three price buckets 0, e.g. the :free variants and openrouter/free). */
    freeBadge: "免费",
    visionModelBadge: "视觉代理",
    setVisionModel: "设为视觉代理模型",
    visionModelHint: "供不支持图片的模型经 describe_image 代读图片",
    priceUnitShort: "/M tok",
    testOk: (ms: number): string => `连通正常（${ms} ms）`,
    testFailed: (msg: string): string => `连通失败：${msg}`,
    priceCacheRead: "缓存读取价格",
    priceCacheWrite: "缓存写入价格",
    priceOutput: "输出价格",
    currency: "币种",
    currencyUsd: "美元 $",
    currencyCny: "人民币 ¥",
    apiKey: "API key",
    apiKeyKeepHint: "留空保留现有 key",
    apiKeyEnvHint: (envKey: string): string => `留空则使用环境变量 ${envKey}`,
    clearApiKey: "清除已存 API key",
    baseUrl: "自定义 base URL",
    baseUrlHint: "留空使用厂商默认地址",
    /** Hover title for the base URL field: explains the grey in-field suffix (the protocol path the client appends to the base URL). */
    baseUrlSuffixTitle: "客户端会在 base URL 后追加右侧灰色协议路径",
    baseUrlRequired: "必须填写 base URL",
    contextWindowDefaultHint: (n: number): string => `留空按 ${n} 计`,
    confirmDeleteTitle: "删除模型",
    confirmDelete: (name: string): string =>
      `确定删除「${name}」？该模型的配置与 API key 将一并移除。`,
    groupApiKey: "统一配置 API key",
    groupApiKeyTitle: (label: string): string => `为「${label}」统一配置 API key`,
    groupApiKeyHint: (n: number): string => `将写入该分组下全部 ${n} 个模型；留空不改动。`,
    getApiKey: "获取 API key",
    getModelIds: "获取模型 id",
    groupKeyApplied: (n: number): string => `已为 ${n} 个模型配置 API key`,
    // Providers with separate domestic / international endpoints: note on the default
    // endpoint used when left blank via env var (the other side's key needs an explicit
    // base URL). Written to match AgentHub's actual behavior; rendered wherever the env fallback hint appears.
    providerEnvNotes: {
      zhipu:
        "缺省端点为 Z.AI 国际版（api.z.ai）；智谱开放平台（bigmodel.cn）的 key 需填 base URL https://open.bigmodel.cn/api/paas/v4",
      moonshot:
        "缺省端点为国内版（api.moonshot.cn）；platform.kimi.com（国际）的 key 需填 base URL https://api.moonshot.ai/v1",
    } as Record<string, string | undefined>,
    confirmVisionModelTitle: "设为视觉代理模型",
    confirmVisionModel: (name: string): string =>
      `确定把「${name}」设为视觉代理模型？不支持图片的模型将由它经 describe_image 代读图片。`,
    confirmSaveTitle: "保存模型配置",
    confirmSave: (name: string): string => `确定保存对「${name}」的配置修改？`,
    confirmDefaultTitle: "设为默认模型",
    confirmDefault: (name: string): string =>
      `确定把「${name}」设为默认模型？新建的 Session 将默认使用它。`,
    default: "默认",
    setDefault: "设为默认模型",
    remove: "删除模型",
    readOnlyHint: "member 只读；模型与 credential 修改仅 owner 可执行",
    empty: "尚未配置任何模型",
    noKey: "未配置 key",
    /** Chat model dropdown's bottom expander row: reveals the models hidden by the configured-key filter. */
    showModelsWithoutKey: (n: number): string => `显示未配置 key 的模型（${n} 个）`,
    modelIdExists: "该模型 id 已存在",
    pricingAllOrNone: "三项价格需一并填写",
    pricingInvalid: "必须为数字",
    contextWindowInvalid: "必须为数字",
  },

  memory: {
    desc: "跨 Session 的长期记忆（存于 agent_state/memory/）：agent 会在对话中自行记下值得保留的信息，你也可以直接让它记住某件事。用户记忆对本 Agent 的所有会话生效，工作区记忆按工作区隔离；记忆修改在对话中由 agent 完成。关闭开关只停止使用记忆，不删除任何文件。",
    enable: "启用记忆",
    userScope: "用户记忆",
    templateMissing: "提示词模板中没有 {{MEMORY}} 占位符，记忆不会进入上下文。",
    insertPlaceholder: "插入 {{MEMORY}} 占位符",
    insertPlaceholderDone: "已插入",
    promptSection: "记忆提示词",
    promptSectionHint:
      "注入模板 {{MEMORY}} 占位符的内容。主提示词每个会话都注入；工作区附加段仅在持久工作区的会话中追加。",
    promptLabel: "主提示词",
    workspacePromptLabel: "工作区附加段",
    /**
     * Memory-prompt placeholder reference; a chip inserts into whichever field was focused
     * last. The two indexes plus the workspace directory — the user directory stays a literal
     * pattern in the prompt, resolvable from the Environment section.
     */
    promptPlaceholders: [
      [
        "{{USER_MEMORY_INDEX}}",
        "用户记忆索引 MEMORY.md 的内容（最多注入 200 行、总计 25000 字符）",
      ],
      [
        "{{WORKSPACE_MEMORY_INDEX}}",
        "当前工作区记忆索引的内容（最多注入 200 行、总计 25000 字符）；仅在工作区附加段生效",
      ],
      ["{{WORKSPACE_MEMORY_DIR}}", "当前工作区记忆目录的绝对路径；仅在工作区附加段生效"],
    ],
    insertToken: "插入到光标处",
    itemCount: (n: number): string => `${n} 条`,
    emptyScope: "这个工作区还没有记忆——agent 会在会话中自行记下值得保留的信息",
    emptyUserScope: "还没有用户记忆——在对话里说「记住……」即可让 agent 保存",
    add: "添加",
    addTitle: "添加记忆",
    addWhy: "记忆整理由 agent 在对话中完成：填写内容后打开新对话，由 agent 整理保存。",
    addContentLabel: "要记住的内容或来源",
    addContentPlaceholder: "粘贴要记住的内容，或文件路径 / 链接",
    /** Prefilled draft for the add-via-chat flow, per scope kind; the required content follows on the next line. */
    addPromptLead: {
      user: "请把下面的内容整理成记忆，存入用户记忆：",
      workspace: "请把下面的内容整理成记忆，存入这个工作区的记忆：",
    },
    view: "查看",
    edit: "编辑",
    editTitle: "编辑记忆",
    editWhy:
      "内容修改由 agent 在对话中完成：确认引导语后打开新对话，agent 会同步更新记忆文件与 MEMORY.md 索引。",
    editRequirementLabel: "修改要求",
    editRequirementPlaceholder: "描述要怎么改（可留空，跳转后在对话中补充）",
    editPromptLabel: "引导语预览",
    editCopyPrompt: "复制 Prompt",
    editCopied: "已复制",
    editOpenChat: "打开新对话",
    delete: "删除",
    deleteTitle: "删除这条记忆？",
    deleteConfirm: (name: string): string =>
      `将删除「${name}」并移除 MEMORY.md 中对应的索引行。此操作不可恢复。`,
    deleteDone: "已删除",
    /** Prefilled draft for the edit-via-chat flow; the user completes the trailing requirement line before sending. */
    editPromptLead: (title: string): string => `请帮我更新一条记忆：${title}`,
    editPromptTail: "修改要求：",
  },

  vault: {
    desc: "本 Agent 专属的环境变量（存于 agent_state/.vault.toml）：键值对注入其 shell 命令（exec_command）的子进程环境；键名会告知模型，值不进入模型上下文。子 Agent 使用各自的保险柜，不继承。保存后自下一个任务起生效（进行中的任务不受影响）。",
    key: "键名",
    value: "值",
    valueMasked: "值（掩码）",
    add: "添加",
    addTitle: "添加环境变量",
    remove: "删除",
    deleteTitle: "删除环境变量",
    deleteConfirm: (key: string): string => `确认删除环境变量「${key}」？值不可恢复。`,
    overwriteTitle: "覆盖已有环境变量",
    overwriteConfirm: (key: string): string => `「${key}」已存在，保存将覆盖原值且不可恢复。`,
    empty: "尚未配置任何环境变量",
    readOnlyHint: "member 只读；Vault 修改仅 owner 可执行",
    keyHint: "字母、数字与下划线，不能以数字开头",
    keyInvalid: "键名不合法：仅字母、数字与下划线，且不能以数字开头",
    valueRequired: "值不能为空",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用密钥保险柜",
      templateMissing: "提示词模板中没有 {{VAULT}} 占位符，保险柜小节不会进入上下文。",
      legacyTemplate:
        "模板仍是旧版硬编码的 # Vault 段落：一键迁移会将该段落原位替换为 {{VAULT}} 占位符，措辞不变，此后可在下方编辑。",
      insertPlaceholder: "插入 {{VAULT}} 占位符",
      migrate: "迁移为 {{VAULT}} 占位符",
      promptSection: "保险柜提示词",
      promptSectionHint: "注入模板 {{VAULT}} 占位符的内容；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{VAULT_KEYS}}", "保险柜键名列表（每键一行「- KEY」，仅键名，值永不注入；无键时为空）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  schedule: {
    desc: "定时任务（agent_state/schedule/*.toml）：到点自动向目标 Session 发送 prompt；文件亦可手工编辑，Web 端修改后即时生效。",
    readOnlyHint: "member 只读；定时任务修改仅 owner 可执行",
    colStatus: "状态",
    colPeriod: "周期",
    colTarget: "目标",
    colFireTimes: "下次 / 最近触发",
    colQueued: "排队",
    statusNames: {
      active: "生效",
      disabled: "停用",
      expired: "已过期",
      done: "已完成",
      missed: "已错过",
      invalid: "无效",
    } as Record<string, string>,
    queued: "排队中",
    once: "一次性",
    newSession: "新建会话",
    invalidFiles: "解析失败的文件（已跳过调度）",
    empty: "尚未配置定时任务",
    enable: "启用",
    disable: "停用",
    addTitle: "新建定时任务",
    editTitle: (name: string): string => `编辑定时任务「${name}」`,
    nameHint: "即文件名（不含 .toml），创建后不可改",
    prompt: "Prompt",
    enabled: "启用",
    startAt: "开始时间",
    endAt: "结束时间（可选）",
    period: "周期",
    periodPlaceholder: "30m / 12h / 7d，留空为一次性",
    target: "目标",
    targetNew: "每次新建会话",
    targetSession: "绑定 Session",
    sessionId: "Session",
    /** Bind-Session picker (searchable dropdown): trigger placeholder, search box, and empty states. */
    chooseSession: "选择要绑定的 Session",
    sessionSearch: "搜索标题或 Session id…",
    sessionNoMatch: "无匹配的 Session",
    sessionEmpty: "该 Agent 暂无 Session",
    workspace: "Workspace（可选，留空自动创建临时工作区）",
    model: "Model",
    modelDefault: "Project 默认",
    deleteTitle: "删除定时任务",
    deleteConfirm: (name: string): string => `确认删除定时任务「${name}」？`,
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用定时任务",
      templateMissing: "提示词模板中没有 {{SCHEDULES}} 占位符，定时任务小节不会进入上下文。",
      insertPlaceholder: "插入 {{SCHEDULES}} 占位符",
      promptSection: "定时任务提示词",
      promptSectionHint:
        "注入模板 {{SCHEDULES}} 占位符的内容，教模型用文件工具管理定时任务；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{SCHEDULE_LIST}}", "现有任务名列表（每任务一行「- 名称」；无任务时注入空清单说明）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  // Skills are built-in (installed for every agent automatically); the block below covers the
  // Agent settings Skills tab (installed list + zip import/export) and the agents-page count —
  // the former library page's browse/install/quick-invoke strings were removed with the page.
  skills: {
    uninstall: "卸载",
    /** Skill count on the agents-page card metadata. */
    skillCount: (n: number): string => `${n} 个技能`,
    uninstalledToast: (skill: string, agent: string): string => `已从 ${agent} 卸载 ${skill}`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `卸载 ${name}`,
    uninstallConfirmBody: (skill: string, agent: string): string =>
      `确定从 ${agent} 卸载 ${skill} 吗？已安装的技能文件（含本地改动）将被删除。`,
    /** Agent settings "Skills" tab (installed list + import modal). */
    agentTabDesc:
      "该 Agent 已安装的技能（agent_state/skills/，文件即事实来源）：元数据注入系统提示词，正文由模型按需读取；卸载会删除整个技能目录。",
    agentTabEmpty: "尚未安装任何技能",
    exportSkill: "打包导出",
    importSkill: "导入技能",
    importChatTitle: "推荐：让 Agent 在对话中安装",
    importChatWhy: "Agent 能完整阅读、审查并按需调整技能内容，比直接上传更可靠。",
    importSourceLabel: "技能来源",
    importSourceHint: "支持网页 / GitHub 仓库或目录 / 本地路径 / 其他生态的安装命令",
    importSourcePlaceholder: "https://…、git 仓库、/path/to/skill 或 npx skills add <name>",
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<来源>",
    importPromptLabel: "发送给 Agent 的 Prompt（预览）",
    /** Per-source lead sentence of the generated install prompt; composed with importPromptTail by buildImportPrompt (features/agents/skill-import-source.ts). */
    importPromptLead: {
      webUrl: (s: string): string => `请阅读这个网页，并把其中的 Skill 安装到你的技能目录：${s}。`,
      repoUrl: (s: string): string =>
        `请获取这个仓库或目录（git clone 或直接抓取），定位其中含 SKILL.md 的技能目录，并安装到你的技能目录：${s}。`,
      localPath: (s: string): string =>
        `请直接读取这个本地路径下的技能文件，并安装到你的技能目录：${s}。`,
      command: (s: string): string =>
        `这是一条其他生态的技能/插件安装命令，请不要直接执行：先解读它会安装什么，从对应的仓库或注册表获取相同内容，再安装到你的技能目录：${s}。`,
      reference: (s: string): string =>
        `请根据这个技能/插件引用找到其来源（仓库、插件市场或文档页），并把对应的 Skill 安装到你的技能目录：${s}。`,
    },
    /** Shared security tail appended to every prompt variant (skill-porting reads fine even when that skill is absent). */
    importPromptTail:
      "安装前请完整阅读全部内容，确认安全、无恶意指令后再写入，并向我说明它的用途。如果你安装了 skill-porting 技能，请先阅读并按其流程处理。",
    importCopyPrompt: "复制 Prompt",
    importCopied: "已复制到剪贴板",
    importOpenChat: "打开新对话",
    importUploadTitle: "上传技能 zip 包",
    importUploadDesc: "zip 根目录为 SKILL.md，或仅含一个内含 SKILL.md 的顶层目录。",
    importUploadAction: "选择 zip 文件",
    importUploading: "上传中…",
    importDoneToast: "技能已安装",
    importOverwriteTitle: "覆盖已安装技能",
    importOverwriteBody: (name: string): string =>
      `技能「${name}」已存在，覆盖安装将替换其全部文件（含本地改动），不可恢复。确认继续？`,
    importOverwriteAction: "覆盖安装",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "启用技能",
      templateMissing: "提示词模板中没有 {{SKILLS}} 占位符，技能小节不会进入上下文。",
      legacyTemplate:
        "模板仍是旧版硬编码的 # Skills 段落：一键迁移会将该段落原位替换为 {{SKILLS}} 占位符，措辞不变，此后可在下方编辑。",
      insertPlaceholder: "插入 {{SKILLS}} 占位符",
      migrate: "迁移为 {{SKILLS}} 占位符",
      promptSection: "技能提示词",
      promptSectionHint: "注入模板 {{SKILLS}} 占位符的内容；开关关闭或模板无占位符时不注入。",
      promptLabel: "提示词",
      promptPlaceholders: [
        ["{{SKILL_METADATA}}", "已安装技能的元数据行（每技能一行「- 名称 — 描述」；无技能时为空）"],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  /** The capability panel on the Vault tab: what is on, and why the rest is off. */
  capabilities: {
    title: "本机能力",
    on: "已启用",
    denied: "条件未满足",
    off: "未启用",
  },

  chat: {
    /** In-app browser pane (desktop only): the right-hand column that hosts the real WebContentsView. */
    /** Cards the agent raises when it needs the person. */
    interaction: {
      answerPlaceholder: "回答一句就行",
      failed: "没能把你的回答发出去，请再试一次",
    },
    browserPane: {
      title: "浏览器",
      show: "显示浏览器",
      hide: "隐藏浏览器",
      starting: "正在启动浏览器",
      loading: "加载中",
      ready: "就绪",
      resize: "调整浏览器面板宽度",
      tabs: "浏览器标签页",
      newTab: "新建标签页",
      closeTab: "关闭标签页",
      keep: "保留此页",
      keepHint: "任务结束后仍保留这个页面",
      address: "地址栏",
      addressPlaceholder: "输入网址",
      badUrl: "只能打开 http 或 https 网址",
      back: "后退",
      forward: "前进",
      reload: "刷新",
      stop: "停止",
      loadFailed: "页面加载失败",
      retry: "重试",
      profile: "浏览器数据",
      clearProfile: "清除浏览器数据并退出登录",
      clearProfileConfirm:
        "将清除本应用内置浏览器的全部 Cookie 与存储，并关闭所有标签页。你在这些网站的登录状态会丢失。",
      backend: "浏览器后端",
      backendIab: "应用内浏览器",
      backendExtension: "我自己的 Chrome（扩展）",
      backendExtensionHint: "使用 Chrome 中已有的登录状态；若扩展尚未连接，将打开安装引导",
      backendExtensionSelected:
        "下一项任务将使用 Chrome。若要使用已有标签页，请在该页点击扩展图标。",
      backendExtensionUnavailableSelected:
        "已选择 Chrome，但当前无法连接。请改选应用内浏览器，或解决连接问题后重启。",
      chromePanelTitle: "此对话将使用你的 Chrome",
      chromePanelBody:
        "下一项 Agent 任务会在 Chrome 中创建并控制自己的标签页。这里不会镜像 Chrome，也不会自动转移应用内浏览器的当前页面。",
      chromePanelUnavailable:
        "Chrome 目前不可连接。请从右上角菜单改选应用内浏览器，或解决中继端口冲突后重启应用。",
      chromePanelIabSafe: "应用内浏览器的页面仍会保留；改选回来即可继续查看。",
      chromePanelCheck: "检查或设置 Chrome 扩展",
      inAppBrowserData: "应用内浏览器数据",
      /** Deliberately says "default browser": this opens the OS handler, which may not be the
          browser the extension is connected to. The real backend handoff is the extension. */
      openInDefaultBrowser: "在系统默认浏览器中打开当前应用内页面",
      openInDefaultBrowserHint:
        "只会在系统默认浏览器中另开一份，不会切换 Agent 的浏览器后端，也不会带入当前登录状态",
      backendLocked: "任务进行中，不能切换浏览器",
      backendUnavailable: "本次运行连不到扩展所在的中继端口，无法使用你自己的 Chrome",
      profileResetLocked: "有任务正在使用浏览器，暂时不能清除数据",
      clearProfileDone: "已清除浏览器数据",
      clearProfileFailed: "清除浏览器数据失败",
      backendFailed: "切换浏览器失败",
      zoom: "缩放",
      zoomOut: "缩小",
      zoomIn: "放大",
      zoomReset: "恢复 100%",
      zoomFailed: "调整页面缩放失败",
      openInDefaultBrowserFailed: "无法在系统默认浏览器中打开此页",
      suggestions: "网址建议",
      /** The "sign in as youhai@example.com" bar. User-pressed only; the agent cannot use these. */
      logins: {
        prompt: "已保存的登录信息",
        fillAs: (username: string) => `填入 ${username}`,
        fillNoUsername: "填入已保存的密码",
        filled: (username: string) => `已填入 ${username}，请自行点击登录`,
        noSubmit: "只填写表单，不会替你点击登录",
        dismiss: "关闭",
      },
      /** Bringing cookies, saved logins and history over from the user's own Chrome. */
      import: {
        open: "导入到应用内浏览器",
        title: "从你的浏览器导入到应用内浏览器",
        subtitle: "选择要带到内置浏览器的数据",
        from: "来源",
        /** The "Close Google Chrome completely before importing" line, per browser. */
        closeFirst: (browsers: string) => `导入前请完全退出 ${browsers}`,
        closeFirstWhy: "浏览器运行时会锁住这些文件，最近的登录状态可能读不到",
        passwords: "已保存的密码",
        cookies: "Cookie",
        history: "浏览历史",
        /** Shown when this machine has no encrypted storage, so passwords cannot be stored. */
        passwordsUnavailable: "本机没有可用的加密存储，无法保存密码",
        /** A data type the selected profile simply does not have. */
        kindMissing: "该配置文件没有这项数据",
        noSources: "没有找到可导入的浏览器",
        noSourcesHint: "支持 Chrome、Edge、Brave、Chromium 和 Vivaldi",
        importing: "正在导入…",
        submit: "导入",
        /** macOS shows a keychain prompt; say so before it appears rather than after. */
        keychainNotice: "系统可能会弹出钥匙串授权，需要允许才能读取加密数据",
        done: (count: number) => `已导入 ${count} 项`,
        doneNothing: "没有导入任何内容",
        partial: (imported: number, skipped: number) =>
          `已导入 ${imported} 项，${skipped} 项无法读取`,
        failed: "导入失败",
        cookiesLandIn: "Cookie 会进入内置浏览器的独立配置，不会影响你自己的 Chrome",
      },
    },
    newSessionMenu: "新建对话",
    chooseAgent: "选择 Agent",
    chooseModel: "选择模型",
    thinkingLevel: "思考等级",
    /** Short tier names for the pre-conversation picker (per review: short names only, no descriptions, no "default" row). `none` exists purely to display a stored legacy value — it is never offered as a choice (many models cannot disable thinking). */
    thinkingLevelNames: {
      none: "无",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
    } as Readonly<Record<string, string>>,
    workspaceUseThis: "使用此目录",
    workspaceUp: "上级目录",
    workspaceNoSubdirs: "无子目录",
    workspaceAuto: "临时工作区",
    workspaceClear: "改用临时工作区",
    workspaceDirInvalid: "目录不存在或无法访问，已回退",
    /** Grouping toggle of the sidebar conversation list (workspace grouping is the default) and the workspace groups. */
    groupByWorkspace: "按工作区分组",
    groupByAgent: "按 Agent 分组",
    tempWorkspaces: "临时工作区",
    newSessionInWorkspace: "在此工作区新建对话",
    draftGreeting: (name: string) => `今天想去哪里${name ? `，${name}` : ""}？`,
    draftSubtitle: "告诉我想去哪里，我会替你搜索、比较，并把关键取舍讲清楚。",
    draftPrompt: "从一个想法开始",
    // Draft-screen "Jump back in" rail heading (recent resumable conversations).
    // The returning-state rail leads with the person's own next trip, rendered purely from
    // trip.json fields and the session index -- never a model call (the root spec declines a
    // proactive AI opener; a countdown is arithmetic, not judgement).
    upNext: {
      title: "下一程",
      departsToday: "今天出发",
      departsTomorrow: "明天出发",
      departsInDays: (n: number) => `距出发 ${n} 天`,
      waitingOnYou: (n: number) => `${n} 件等你拍板`,
      chats: (n: number) => `${n} 个对话`,
      updated: (date: string) => `更新于 ${date}`,
    },
    jumpBackIn: "接着上次继续",
    // First-run-only editorial prompts (the rail shows them until the first real trip or
    // conversation exists). A click fills the composer with the prompt and sends nothing.
    getInspired: {
      title: "寻找旅行灵感",
      previous: "向左浏览旅行灵感",
      next: "向右浏览旅行灵感",
      cards: {
        kyotoAutumn: {
          title: "追一场京都红叶",
          tag: "季节灵感",
          prompt:
            "帮我设计一趟以京都红叶为主题的五日旅行。先比较 11 月中下旬不同时间段的景色、拥挤程度和价格取舍，再给出寺院、庭园、夜间点灯与安静街区相结合的每日路线；住宿和交通只筛选少数代表选项，说明为什么入选，任何预订都等我确认。",
        },
        bangkokFood: {
          title: "用味蕾逛遍曼谷",
          tag: "美食灵感",
          prompt:
            "帮我设计一趟四天的曼谷美食旅行，兼顾街头小吃、传统市场、社区餐馆和一顿值得预约的晚餐。按街区组织路线，避免为了打卡来回奔波，并说明卫生、排队、营业时间与交通取舍；先给规划和少数代表餐厅，未经我确认不要预订。",
        },
        northernLights: {
          title: "睡在极光之下",
          tag: "自然灵感",
          prompt:
            "帮我规划一趟以观赏极光为核心的六日旅行。先比较冰岛北部、挪威北部和芬兰拉普兰在天气稳定性、交通、预算与活动丰富度上的差异，再推荐一个目的地并给出保留天气缓冲的行程；住宿和活动只列少数代表选项，任何预订都等我确认。",
        },
      },
    },
    // Trip-constraint chips: compose copy (TripChipsCopy contract in
    // trip-constraints.ts) + chip/popover UI copy. "预算" here is the trip's price TIER —
    tripChips: {
      lineFolder: "行程文件夹：",
      lineWhere: "目的地：",
      lineWhen: "日期：",
      lineWho: "人数：",
      lineBudget: "预算：",
      budgetAmount: (yuan: number) => `总预算 ¥${yuan.toLocaleString("en-US")}`,
      dateRange: (start: string, end: string) => `${start} 至 ${end}`,
      dateFrom: (start: string) => `${start} 出发`,
      dateUntil: (end: string) => `${end} 前返回`,
      flexible: (days: number, month: string) => `${month} 内任意 ${days} 天`,
      flexibleAnyMonth: (days: number) => `时间灵活，共 ${days} 天`,
      flexibleMonthOnly: (month: string) => `${month} 内，天数待定`,
      adults: (n: number) => `${n} 成人`,
      children: (n: number) => `${n} 儿童`,
      infants: (n: number) => `${n} 婴儿`,
      whoJoin: "、",
      tiers: {
        any: "不限",
        low: "经济（¥）",
        mid: "舒适（¥¥）",
        high: "高档（¥¥¥）",
        luxury: "奢华（¥¥¥¥）",
      },
      // Chip labels (unfilled) and short summaries (filled).
      where: "目的地",
      when: "日期",
      who: "人数",
      budget: "预算",
      tierShort: { any: "不限", low: "¥", mid: "¥¥", high: "¥¥¥", luxury: "¥¥¥¥" },
      /** Chip summary when an exact total is stated ("¥20,000"). */
      amountShort: (yuan: number) => `¥${yuan.toLocaleString("en-US")}`,
      travellers: (n: number) => `${n} 人`,
      /** Chip summary: people, plus pets when there are any ("2 人 · 1 只宠物"). */
      whoSummary: (people: number, pets: number): string =>
        pets > 0
          ? people > 0
            ? `${people} 人 · ${pets} 只宠物`
            : `${pets} 只宠物`
          : `${people} 人`,
      daysCount: (n: number) => `${n} 天`,
      flexibleTag: "灵活",
      monthCount: (n: number) => `${n} 个月份`,
      monthsLabel: "月份",
      monthsHint: "可多选；不选表示任意月份",
      /** Intl locale for month names inside the When dialog. */
      intlLocale: "zh-CN",
      // Popover copy.
      wherePlaceholder: "城市或地区，可写多个",
      whereHint: "例如：东京、大阪",
      whereListLabel: "地点建议",
      whereSearching: "正在搜索地点…",
      whereNoResults: "没有匹配地点，可以保留当前输入。",
      whereUnavailable: "地点建议暂不可用，仍可直接输入任意目的地。",
      datesMode: "具体日期",
      flexibleMode: "灵活",
      startDate: "出发",
      endDate: "返回",
      daysLabel: "天数",
      monthLabel: "月份（可选）",
      adultsLabel: "成人",
      adultsHint: "13 岁及以上",
      childrenLabel: "儿童",
      childrenHint: "2–12 岁",
      infantsLabel: "婴儿",
      infantsHint: "2 岁以下",
      petsLabel: "宠物",
      pets: (n: number) => `宠物 ${n} 只`,
      petsHint: "同行的动物",
      budgetTitle: "选个档位，或直接写数",
      budgetAmountLabel: "总预算",
      budgetAmountHint: "可选 · 整趟旅程 · 人民币",
      budgetAmountPlaceholder: "如 20000",
      clear: "清除",
      /** Dialog footer: closes it. Not "Update" — nothing runs until the message is sent. */
      dialogDone: "完成",
    },
    jumpBackInPrevious: "向左浏览最近对话",
    jumpBackInNext: "向右浏览最近对话",
    /**
     * Example task cards on the draft screen: one click auto-submits the canned prompt. These
     * are the FULL working prompts — descriptions stay short, but the submitted instructions
     * remain detailed because execution quality depends on them.
     */
    exampleTasks: {
      ctripFlight: {
        label: "在携程订明天的机票",
        desc: "出差去上海，北京飞上海选最便宜的，不要多余服务包",
        prompt:
          "我准备明天去上海出差，帮我打开携程预订明天从北京去上海的机票，帮我选择最便宜的机票预订，不要多余的服务包。",
      },
      otaCompare: {
        label: "携程飞猪多标签比价",
        desc: "南京飞北京，对比最低票价，不要附加服务",
        prompt:
          "下周六我准备去北京旅游，帮我打开携程、飞猪，搜索南京去北京的机票，不需要附加服务，需要最便宜的一项；先不要进入订票流程，等我选择后再继续预定",
      },
      xhsTrip: {
        label: "把小红书攻略变成一趟旅行",
        desc: "规划成都三日行程，再找每晚400元内的酒店",
        prompt:
          "搜索上海出发、两人、成都三日美食及游玩攻略，综合多篇小红书笔记形成游玩逐日行程，结合旅游行程规划再打开携程搜索行程中相关的酒店住宿，预算400以内一晚。",
      },
    },
    sessionList: "Session",
    defaultSessionTitle: "新对话",
    /** Session header navigation back to the New task welcome screen. */
    backHome: "返回主页",
    model: "Model",
    workspace: "Workspace",
    workspaceHint: "留空自动创建临时工作区；指定时必须是服务器上已存在的目录",
    approvalMode: "审批模式",
    /** Short description (the trigger button shows only the description, not the mode id). */
    approvalModeNames: {
      "allow-all": "全部放行",
      "deny-all": "全部拒绝",
      "read-only": "放行只读",
      "always-ask": "总是询问",
    } as Record<string, string>,
    approvalModes: {
      "allow-all": "全部放行（allow-all）",
      "deny-all": "全部拒绝（deny-all）",
      "read-only": "放行只读（read-only）",
      "always-ask": "总是询问（always-ask）",
    } as Record<string, string>,
    statusRunning: "运行中",
    statusCompacting: "压缩中",
    pendingApprovals: (n: number) => `${n} 个待审批`,
    jumpToLatest: "回到最新消息",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "正在加载更早的对话…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "更早的对话加载失败，点击重试",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "已是对话开头",
    /** Conversation minimap (tick rail over the stream's left gutter): rail aria-label. */
    outlineTitle: "对话索引",
    /** Tick accessible name: turn number + the question (or the no-text placeholder). */
    outlineTickLabel: (n: number, question: string) => `第 ${n} 轮：${question}`,
    /** Entry label when the prompt had no text body (image / attachment-only message). */
    outlineNoText: "（图片或附件）",
    /** Answer-preview placeholder while the latest turn is still running with no reply text yet. */
    outlineAnswering: "回答生成中…",
    inputPlaceholder: "输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片",
    inputPlaceholderShort: "输入消息…",
    draftInputPlaceholder: "告诉我想去哪里、什么时候出发，以及你最在意什么…",
    /** Placeholder while a Task is running (mid-run steering): the message is delivered between turns with the next request. */
    steerPlaceholder: "给运行中的 Agent 留言，随下一轮对话送达",
    steerPlaceholderShort: "给运行中的 Agent 留言…",
    steerSend: "发送给运行中的 Agent",
    /** Queued hint shown after a successful steer, until the steering message appears in the stream. */
    steerQueuedIndicator: "插话已排队，将随下一轮送达",
    /** Same hint, with the queued message's content (from the server's undelivered-steering mirror; survives reloads). */
    steerQueuedItem: (content: string) => `插话已排队，将随下一轮送达：${content}`,
    /** Label of the [user_steering] chip (a mid-run user message delivered between turns). */
    userSteering: "用户插话",
    /** Mid-run send-mode setting: steer (delivered mid-run) vs follow-up (queued until the run ends). */
    steerModeLabel: "运行中发送方式",
    steerModeSteer: "插话",
    steerModeSteerHint: "立即插话：随下一轮对话送达运行中的 Agent",
    steerModeFollowUp: "排队",
    steerModeFollowUpHint: "排队跟进：本轮结束后自动作为新消息发送",
    followUpPlaceholder: "排队为下一条消息，本轮结束后自动发送",
    followUpPlaceholderShort: "排队为下一条消息…",
    followUpSend: "排队为下一条消息",
    /** Server-side queued follow-up count (auto-sent once the current run finishes). */
    followUpQueuedChip: (n: number) => `${n} 条跟进消息已排队，本轮结束后自动发送`,
    send: "发送",
    stop: "停止",
    compact: "压缩上下文",
    approve: "允许",
    deny: "拒绝",
    decisionAllow: "已批准",
    decisionDeny: "已拒绝",
    decisionManual: "手动",
    decisionAuto: "自动",
    thinking: "思考",
    subagent: "子会话",
    subagentRunning: "运行中",
    aborted: (reason?: string) => `[已中断]${reason ? `：${reason}` : ""}`,
    /** Auth-dead notice (request_end status "auth"): action-only copy — updating the key on the Models page auto-unlocks this Session. */
    modelAuthDead: "模型 API 认证失败：请在模型配置页更新该模型的 API key，或新建会话。",
    modelAuthDeadOpenModels: "打开模型配置",
    modelAuthDeadRetry: "重试",
    modelAuthDeadCta: "新建会话",
    modelAuthDeadPlaceholder: "模型认证失败，请先更新 API key",
    /**
     * Reconnect hint line; `secondsLeft` (waiting state only) switches to the live-countdown
     * wording. `failed` is in the union because the engine retries it like the other two —
     * its cause names the provider rather than the transport, since that is where it came from.
     */
    reconnect: (
      status: "failed" | "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
      secondsLeft?: number,
    ) => {
      const cause =
        status === "timeout"
          ? "连接超时或网络中断"
          : status === "malformed"
            ? "响应不完整或无法解析"
            : "模型服务返回错误";
      const action =
        state === "gaveUp"
          ? "已停止重试"
          : state === "retried"
            ? `已发起第 ${attempt} 次重试`
            : secondsLeft !== undefined
              ? `第 ${attempt} 次重试，${secondsLeft} 秒后发起…`
              : `正在发起第 ${attempt} 次重试…`;
      return `[重试] ${cause}，${action}`;
    },
    /** "Retry now" on the reconnect countdown (skips the remaining backoff wait). */
    reconnectRetryNow: "立即重试",
    /** "Give up" on the reconnect countdown (the ordinary session abort). */
    reconnectGiveUp: "放弃",
    imageAlt: "用户上传的图片",
    toolImageAlt: "工具输出的图片",
    imagesAsPathHint:
      "当前模型不支持直接查看图片：发送时图片将保存到会话临时目录，以文件路径转交（模型经 describe_image 查看）",
    infoPanel: "Session 信息",
    sessionStats: "统计",
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "复制 Session id",
    /** Info-dropdown trace row: labels the Session's trace file path (clicking deep-links to the Trace page). */
    traceFile: "轨迹文件",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions. */
    processList: "会话进程",
    processStop: "停止",
    processExited: "已退出",
    /** Header chip title: count of the conversation's still-running background processes. */
    runningServices: (n: number) => `${n} 个运行中的服务`,
    statTokens: "Token 累计",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "总 Token",
    statCacheHit: (pct: string) => `缓存命中率 ${pct}`,
    statElapsed: "用时",
    statInput: "输入 tokens",
    statCached: "已缓存",
    statOutput: "输出 tokens",
    statTps: "输出 TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (fullwidth for zh typography). */
    statParenOpen: "（",
    statParenClose: "）",
    noSessions: "还没有 Session",
    emptyStream: "发送一条消息开始对话",
    historyLoadFailed: "历史消息加载失败",
    statsLabel: "统计信息",
    removeImage: "移除图片",
    openWorkspace: "打开工作区",
    /** File summary card at the end of a message (Codex-style): title, inline preview action, and collapsed row. */
    filesInMessage: (n: number) => `${n} 个文件`,
    imagesInMessage: (n: number) => `${n} 张图片`,
    openPreview: "点击预览",
    showMoreFiles: (n: number) => `显示其余 ${n} 个文件`,
    showLess: "收起",
    /** Reveal the next page of sidebar groups (#139); n = groups still hidden. */
    moreGroups: (n: number) => `更多分组（${n}）`,
    contextUsage: "上下文占用",
    contextUnknown: "上下文占用：压缩后待下次请求回报",
    slashHint: "输入 / 使用命令",
    /** `/agent` handoff: command description, picker title, search box, no-match hint, and the staged target's description and remove button. */
    switchAgent: "交给其他 Agent，发送时开启新会话",
    switchAgentTitle: "选择 Agent",
    agentSearchPlaceholder: "搜索 Agent：id / 名称",
    agentsNoMatch: "没有匹配的 Agent",
    handoffTargetTitle: (agent: string) => `发送后交接给 ${agent}`,
    handoffRemove: "移除交接目标",
    /** Skill multi-select dropdown (input toolbar): button text, search box, empty state, and no-match hint. */
    skillsSelect: "技能",
    skillRemove: "移除技能",
    skillsSearchPlaceholder: "搜索技能",
    skillsNoMatch: "没有匹配的技能",
    skillsEmptyHint: "暂无已装技能，可在 Agent 设置的技能页导入",
    /** Auto-generated invocation text when skills are selected and the body is empty (wrapped in [use_skills] before sending). */
    skillsAutoMessage: (names: string[]): string => `使用 ${names.join("、")} 技能`,
    handoffFrom: (agent: string) => `由 ${agent} 的对话交接而来`,
    handoffBack: (title?: string) => (title ? `回到原对话：${title}` : "回到原对话"),
    /** `/model` switch: command description, picker title, the staged target's description and remove button, the switch-origin banner, and the empty-body auto message. */
    switchModel: "切换模型，发送时开启新会话延续本对话",
    switchModelTitle: "切换模型",
    modelSwitchTargetTitle: (model: string) => `发送后换用 ${model} 延续本对话`,
    modelSwitchRemove: "移除切换模型",
    /** Why Send is disabled with a model switch staged: the fork branches off a Trace this Session is still writing. */
    modelSwitchBusyHint: "本轮结束后才能切换模型：新会话要从当前会话的记录接续",
    modelSwitchFrom: (prevModel?: string) =>
      prevModel ? `已切换模型（原为 ${prevModel}），延续原会话` : "已切换模型，延续原会话",
    /** First message body auto-sent when `/model` is staged and the composer is empty (same convention as skillsAutoMessage). */
    modelSwitchAutoMessage: "换用新模型继续这段对话",
    /** Toast when the session-state (locked) model display is clicked: points at the `/model` command. */
    modelLockedHint: "输入 /model 切换模型",
    scheduledFrom: (name: string) => `由定时任务「${name}」触发`,
    emptyGreeting: "开始一段新对话",
    /** Unified step-row titles (same header idiom as workRunning/workDone). */
    mcpConnectTitle: "MCP 连接",
    mcpServerList: (servers: string[]): string => servers.join("、"),
    /** One-line result detail: tool count, plus the NAMES of failed servers (reasons live in the expanded server groups). */
    mcpConnectResult: (toolCount: number, failed: string[]): string => {
      const parts: string[] = [];
      if (toolCount > 0 || failed.length === 0) parts.push(`发现 ${toolCount} 个工具`);
      if (failed.length > 0) parts.push(`不可用：${failed.join("、")}`);
      return parts.join("；");
    },
    /** Per-server group row meta inside the expanded connect row. */
    mcpToolsCount: (n: number): string => `${n} 个工具`,
    mcpServerFailed: "连接失败",
    mcpConnectAborted: "已中断，下次发送时重新连接",
    compactionTitle: "压缩",
    compactionDone: (mode: string): string =>
      mode === "discard" ? "已丢弃旧上下文" : "已切换到摘要后的新上下文",
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "已中断，保留当前上下文";
      return errorMessage !== undefined
        ? `失败（${errorMessage}），保留当前上下文`
        : "失败，保留当前上下文";
    },
    unknownTool: "（未知工具）",
    workRunning: "运行中",
    workDone: "运行完毕",
    workGroupSteps: (n: number) => `${n} 步`,
    approvalWaiting: "待审批",
    copyCode: "复制代码",
    copyReply: "复制回复",
    copyMessage: "复制消息",
    deleteSession: "删除对话",
    renameSession: "重命名对话",
    renameSessionLabel: "标题",
    deleteSessionConfirm: (title: string) =>
      `确定删除「${title}」？该对话的消息与 Trace 将被移除，且不可恢复。`,
    /** Parked draft conversations (unsent new chats living in the sidebar list — see draft-sessions.ts). */
    draftGroup: "草稿",
    draftUntitled: "（无标题草稿）",
    deleteDraft: "删除草稿",
    deleteDraftConfirm: (title: string) => `确定删除草稿「${title}」？未发送的内容将被丢弃。`,
    archiveSession: "归档",
    unarchiveSession: "取消归档",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "更多",
    /** Collapsed sidebar folders inside a group (lazy-loaded); the count is the group's exact server share. */
    folderGroups: {
      subagent: (n: number) => `子智能体（${n}）`,
      schedule: (n: number) => `定时任务（${n}）`,
      archived: (n: number) => `已归档（${n}）`,
    },
    skillsBanner: (names: string[]): string => `使用技能：${names.join("、")}`,
    /** Attached-file notice above a user message (file names only; the paths stay in the Trace). */
    attachedFilesBanner: (names: string[]): string => `附加文件：${names.join("、")}`,
    /** Composer "+" extension menu: image upload and file attachment. */
    plusMenu: "更多输入方式",
    uploadImage: "上传图片",
    uploadImageDesc: "为本条消息附加图片",
    uploadFile: "上传文件",
    uploadFileDesc: "文件存入会话临时目录，模型按路径读取",
    removeFile: "移除文件",
    /** Toast for a picked file rejected before reading (the server's per-file cap is 10MB). */
    attachmentTooLarge: (name: string): string => `${name} 超过 10MB 上限，未添加。`,
  },

  files: {
    title: "文件",
    upload: "上传",
    download: "下载",
    openInNewTab: "新页面打开",
    previewNotIsolatedHint:
      "当前访问地址无法提供独立预览源，页面将以沙箱模式打开：localStorage、Cookie 与第三方 embed 不可用。经 127.0.0.1 或 localhost 访问，或配置 PENGUIN_PREVIEW_ORIGIN 即可解除。",
    refresh: "刷新",
    root: "根目录",
    empty: "空目录",
    previewUnsupported: "该类型不支持预览，请下载查看",
    uploaded: "已上传",
    /** Upload-overwrite confirmation: same-name files in the current directory will be replaced. */
    overwriteTitle: "覆盖同名文件",
    overwriteConfirm: (n: number): string => `当前目录已存在以下 ${n} 个同名文件，上传将覆盖：`,
    loadFailed: "加载失败",
    previewTruncated: "内容过大，预览已截断，请下载查看完整文件",
    details: "详情",
    workspacePath: "Workspace 路径",
    htmlRendered: "渲染视图",
    htmlSource: "源码",
    backToList: "返回列表",
    resizeHandle: "拖拽调整宽度，双击恢复默认",
  },

  // Server error code → localized copy (the server's message is hardcoded Chinese; this is only a fallback for unknown codes).
  errors: {
    networkError: "网络错误，请检查连接",
    modelCredentialMissing: (modelId: string) =>
      `模型 ${modelId} 还没有可用的 API key，请先在「模型」页为它配置`,
    noDefaultModel: "该 Project 还没有默认模型，请先在「模型」页添加模型并设为默认",
    /** Localized text for the common server error codes (server error messages are English-only); looked up by ApiError.code in apiErrorText, falling back to the raw message for unmapped codes. */
    byCode: {
      invalid_credentials: "用户名或密码错误。",
      too_many_attempts: "登录失败次数过多，请稍后重试。",
      password_mismatch: "当前密码不正确。",
      invalid_password: "密码至少 8 位。",
      admin_required: "仅管理员可执行此操作。",
      desktop_single_user: "桌面应用为单用户模式，用户管理不可用。",
      not_found: "资源不存在，或你没有访问权限。",
      agent_not_found: "该 Agent 已不存在。",
      unknown_agent: "该 Agent 不存在于本 Project。",
      agent_exists: "该 Agent id 已被占用。",
      project_exists: "该 Project id 已被占用。",
      user_exists: "该用户名已被占用。",
      user_not_found: "该用户已不存在。",
      cannot_delete_admin: "内置 admin 不可删除。",
      member_not_found: "该用户不是本 Project 的成员。",
      schedule_exists: "已存在同名定时任务。",
      schedule_not_found: "该定时任务已不存在。",
      unknown_skill: "该技能不在技能库中。",
      file_not_found: "该文件已不存在。",
      file_too_large: "文件过大。",
      too_many_files: "一条消息附加的文件过多。",
      payload_too_large: "请求体过大。",
      dir_not_absolute: "目录必须是绝对路径。",
      dir_not_found: "该目录不存在或不可访问。",
      not_a_dir: "该路径不是目录。",
      path_not_found: "该路径不存在。",
      workspace_missing: "该 Session 的 Workspace 已不存在。",
      task_in_progress: "该 Session 已有任务在运行。",
      version_conflict: "快照版本不高于当前版本。",
      invalid_title: "标题无效。",
      invalid_proxy_url:
        "代理地址无效：应为 http://主机[:端口]、https://主机[:端口] 或 主机[:端口]。",
      invalid_trace: "该文件不是有效的 Trace 文件。",
      trace_session_exists: "该 Agent 已存在同名 Session，无法导入重复的 Trace。",
    },
  },
};

/** Dictionary shape (constrains the English dictionary so keys and function signatures line up). */
export type Strings = typeof zh;

/**
 * Runtime active dictionary (live binding): the locale Provider calls setActiveStrings
 * to switch before render, and remounts the whole tree keyed by locale so every `S.x`
 * read reflects the current language.
 */
export let S: Strings = zh;

export function setActiveStrings(next: Strings): void {
  S = next;
}
