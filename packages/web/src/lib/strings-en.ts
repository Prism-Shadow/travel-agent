/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx.
 * Keep domain terms capitalized — Workspace, Token, Task, Session, Project, Trace.
 * "agent" is a common noun: lowercase mid-sentence, capitalized only at the start
 * of a label/sentence or in a proper name (Agent State, AgentHub).
 */
import type { Strings } from "./strings";

export const en: Strings = {
  appName: "Travel Agent",

  nav: {
    chat: "Chat",
    newChat: "New chat",
    models: "Models",
    // Collapsed-rail tooltip (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "Last conversation",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
    pinGroup: "Pin group",
    unpinGroup: "Unpin group",
    settings: "Settings",
  },

  /** Trips: the product's first-class object. Shared by the sidebar, trip cards and the move menu. */
  trip: {
    trips: "Trips",
    newTrip: "New trip",
    noTrips: "No trips yet. One sentence is enough to start.",
    untitled: "Untitled trip",
    /** Conversations belonging to no trip — an ordinary state, not a backlog. */
    scratch: "Loose questions",
    newChatInTrip: "New conversation in this trip",
    openTrip: "Open trip",
    notFound: "This trip no longer exists. It may have been deleted elsewhere.",
    backToChat: "Back to chat",
    rename: "Rename",
    deleteTrip: "Delete trip",
    deleteTripConfirm: (name: string) =>
      `Delete the trip "${name}"? Its conversations stay (they become loose questions). The folder on disk is kept if the journey put anything in it — those files are yours; one that was never written to is removed with the trip.`,
    conversations: "Conversations",
    noConversations: "No conversations in this trip yet.",
    itinerary: "Itinerary",
    noItinerary:
      "No itinerary yet. The agent writes it as the work produces something worth keeping.",
    itineraryUpdated: (when: string) => `updated ${when}`,
    moveToTrip: "Move to trip",
    removeFromTrip: "Remove from trip",
    folderMissing: (dir: string) => `Trip folder not found: ${dir}`,
    folderMissingShort: "Folder moved or deleted",
    meta: {
      dateRange: (start: string, end: string) => `${start} – ${end}`,
      dateFrom: (start: string) => `from ${start}`,
      dateUntil: (end: string) => `until ${end}`,
      flexible: (days: number, month: string) => `${days} days in ${month}`,
      flexibleAnyMonth: (days: number) => `${days} days, dates flexible`,
      flexibleMonthOnly: (month: string) => `in ${month}`,
      travellers: (n: number) => (n === 1 ? "1 traveller" : `${n} travellers`),
      /** ¥ is unambiguous here: the product's market prices trips in RMB. */
      budgetAmount: (yuan: number) => `¥${yuan.toLocaleString("en-US")}`,
      budgetTiers: {
        any: "Any budget",
        low: "On a budget",
        mid: "Sensibly priced",
        high: "Upscale",
        luxury: "Luxury",
      },
      separator: " · ",
    },
  },

  settings: {
    language: "Language",
    /** Admin-only user-menu row opening the proxy options dialog. */
    proxyMenu: "Proxy options…",
    proxyDialogTitle: "Proxy options",
    /** The dialog's two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "Application uses the proxy",
    proxyForAgent: "Agent environment uses the proxy",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "Proxy address",
    proxyAddressPlaceholder: "Empty = follow system proxy",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    followSystem: "System",
    langZh: "中文",
    langEn: "English",
    fontSize: "Font size",
    fontSmall: "S",
    fontMedium: "M",
    fontLarge: "L",
    accent: "Accent",
    accentNames: {
      neutral: "Neutral",
      blue: "Blue",
      green: "Green",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
    } as Record<string, string>,
  },

  /** Version footer, update reminder, and admin self-update in the sidebar user menu. */
  update: {
    /** Version-line date label; `date` is formatMonthDay output, e.g. "Last updated Jul 26". */
    lastUpdated: (date: string) => `Last updated ${date}`,
    /** Superscript badge on the version lines when the update check found a newer release. */
    newVersionBadge: "New version available",
    newVersion: (v: string) => `New version v${v} available`,
    /**
     * The sidebar user menu's SINGLE update row: it reads "Check for updates" until a newer
     * release is known and runs the manual check; once one is known it reads newVersion() and
     * opens the update dialog instead (which carries the release-notes link and, for admins,
     * the self-update action).
     */
    checkNow: "Check for updates",
    checking: "Checking…",
    /** Success toast when the manual check finds a newer release; the row below turns into the update entry. */
    foundNew: (v: string) => `New version v${v} found — use the update entry below to install`,
    upToDate: "You're on the latest version",
    checkFailed: "Update check failed — try again later",
    checkDisabled: "Update checks are disabled (PENGUIN_UPDATE_CHECK=off)",
    releaseNotes: "Release notes",
    updateNow: "Update now",
    updating: "Updating…",
    updated: "Update complete — restart the service to apply",
    restartHint: "Restart by re-running penguin web (or penguin server) in a terminal",
    failed: "Update failed",
    unsupported: "This install cannot be updated from the web UI",
    confirmBody:
      "Downloads the latest release and installs it into the install directory on the server (the data directory is not touched). Restart the service afterwards for the update to take effect.",
    /** Shown in place of confirmBody to non-admins, who can read the release notes but cannot run the update. */
    adminOnly: "Only an administrator can run the update from here.",
  },

  /** Desktop task-completion notifications (window unfocused; desktop-shell sessions only). */
  notify: {
    taskCompleteTitle: "Task completed",
    /** `session` is the Session title (defaultSessionTitle when unnamed). */
    taskCompleteBody: (session: string): string => `"${session}" has finished — click to view`,
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    settings: "Settings",
    confirm: "Confirm",
    close: "Close",
    loading: "Loading…",
    saved: "Saved",
    saving: "Saving…",
    /** Clicking save with nothing changed: an info toast instead of a silent no-op. */
    noChangesToSave: "No changes to save",
    /** Confirm-before-save dialog shared by the settings forms (writes go to server-side config files). */
    confirmSaveTitle: "Save changes",
    confirmSaveBody:
      "Save these changes? They will be written to the configuration files on the server.",
    none: "(none)",
    retry: "Retry",
    unknownError: "Request failed, please try again later",
    requiredField: "This field is required",
    copied: "Copied",
    name: "Name",
    username: "Username",
    role: "Role",
    actions: "Actions",
    created: "Created",
    cost: "Cost",
    time: "Time",
  },

  auth: {
    usernameHint:
      "2–32 chars: starts with a lowercase letter; lowercase letters, digits and underscores only",
    password: "Password",
    passwordHint: "At least 8 characters",
    showPassword: "Show password",
    hidePassword: "Hide password",
    login: "Sign in",
    logout: "Sign out",
    admin: "Admin",
    defaultAdminNote:
      "First run: sign in as the built-in admin “admin” with the initial password printed in the server startup output (looks like penguin-1234), then change it soon",
  },

  account: {
    changePassword: "Change password",
    oldPassword: "Current password",
    oldPasswordHint:
      "The built-in admin's initial password is printed in the server startup output (looks like penguin-1234)",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordMismatch: "New passwords do not match",
    initialPasswordBanner: "This account is using its initial password. Please change it soon.",
    changeNow: "Change now",
  },

  privateProfile: {
    menu: "Private Profile",
    title: "Private Profile",
    subtitle:
      "Manage the personal details and preferences used for travel. You will be asked before every use.",
    backToChat: "Back to chat",
    tabOverview: "Overview",
    tabPersonal: "Personal details",
    tabPreferences: "Preferences",
    tabPrivacy: "Privacy & activity",
    addDetails: "Add details",
    add: "Add",
    notSaved: "Not saved",
    editingUnavailable:
      "This build does not yet connect the Private Profile read/write interface, so no input can be saved.",
    why: "Why?",
    personalTitle: "Personal details",
    personalDescription: "Names and contact details, used only for a task and site you approve.",
    preferencesTitle: "Travel preferences",
    preferencesDescription: "Ordinary preferences that help the agent narrow the option space.",
    identityTitle: "Identity documents and phone",
    identityDescription:
      "These fields require stronger runtime isolation; the agent may only request an opaque fill handle.",
    fieldFullName: "Full name",
    fieldEmail: "Contact email",
    fieldBirthDate: "Date of birth",
    fieldHomeCity: "Home city",
    fieldSeat: "Seat",
    fieldRoom: "Room",
    fieldBreakfast: "Breakfast",
    fieldPassport: "Passport number",
    fieldPhone: "Phone number",
    fieldAddress: "Street address",
    storageCheckingTitle: "Checking private storage",
    storageCheckingDescription: "Reading the real capability state of this runtime.",
    storageLoadFailedTitle: "Private storage status could not be loaded",
    storageLoadFailedDescription:
      "The capability endpoint is unavailable. Profile editing stays closed until the state is known.",
    storageAvailableTitle: "Encrypted on this device",
    storageAvailableDescription:
      "The desktop app can protect ordinary profile details with the operating-system key store and keep them locally.",
    storageDesktopTitle: "Open the desktop app to use Private Profile",
    storageDesktopDescription:
      "This is the standalone web service. It has no desktop shell and no substitute private-storage backend.",
    storageDeniedTitle: "Private storage is unavailable on this device",
    storageDeniedDescription:
      "The encrypted-storage requirement did not pass its probe, so the vault failed closed.",
    storageOffTitle: "Private storage is not enabled",
    storageOffDescription: "This build did not request the Private Profile vault capability.",
    approvalTitle: "Ask before every use",
    approvalDescription:
      "A grant covers one task, one site, one purpose, and the exact fields you approve. Change any of them and the app asks again.",
    localOnlyTitle: "Profile data bypasses the server",
    localOnlyDescription:
      "The vault lives in the desktop main process. Sensitive fill-only fields do not enter the model context.",
    l2AvailableTitle: "Identity and contact fields can use secure fill",
    l2UnavailableTitle: "Identity and contact fields are unavailable",
    l2UnavailableDescription:
      "Document numbers, phone, and street address stay off until agent-runtime isolation is proven.",
    neverStoredTitle: "These values are never stored",
    neverStoredDescription:
      "Card security codes, one-time codes, account passwords, payment passwords, and passkeys must be entered by you each time.",
    privacyTitle: "Privacy boundaries",
    privacyDescription:
      "This page names what the product can actually guarantee instead of hiding it behind a vague security switch.",
    activityTitle: "Use activity",
    activityUnavailable:
      "Audit records are not exposed to this interface yet; an empty list would not be presented as “never used.”",
    deleteAll: "Delete all profile data",
    available: "Available",
    unavailable: "Unavailable",
    always: "Always",
  },

  admin: {
    users: "Users",
    roleAdmin: "Admin",
    roleUser: "User",
    initialPassword: "Initial password",
    initialPasswordFlag: "initial password",
    resetPassword: "Reset password",
    resetPasswordTitle: (u: string): string => `Reset password for ${u}`,
    resetPasswordNote:
      "All sign-in sessions of this user will be revoked; they must sign in with the new password",
    deleteUserTitle: (u: string): string => `Delete user ${u}`,
    deleteUserConfirm: (u: string): string =>
      `This deletes user ${u} and every Project they own (including data directories). This cannot be undone.`,
  },

  project: {
    switcher: "Project",
    create: "New Project",
    createTitle: "New Project",
    id: "Project id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    idPrefixHint:
      "The id is prefixed with your username and a hyphen; append lowercase letters, digits or underscores. Cannot be changed later.",
    name: "Display name (optional, defaults to the Project id)",
    /** The display-name field in Project settings (required there, unlike the create dialog's optional one). */
    displayName: "Display name",
    settings: "Project settings",
    settingsTitle: "Project settings",
    members: "Members",
    addMember: "Add member",
    removeMember: "Remove",
    /** New-chat defaults section (Project settings): prefill for every new chat. */
    chatDefaultsTitle: "New chat defaults",
    chatDefaultsHint:
      "Prefilled defaults for every new chat: agent, working directory, approval mode, thinking level and default model.",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "Not set",
    chatDefaultsApprovalNotSet: "Not set (defaults to allow all)",
    chatDefaultsThinkingNotSet: "Not set (follow the agent's config)",
    chatDefaultsWorkspaceHint: "Empty = temporary workspace",
    /** The model default is single-sourced with the Models page (the same default_model); this is just another entry point. */
    chatDefaultsModelHint: "Same default model as the Models page",
    deleteProject: "Delete Project",
    deleteConfirm:
      "Delete this Project? Its directory will be removed recursively and cannot be recovered.",
    deleteLastForbidden:
      "This is the last Project on this account; create another Project before deleting it",
    deleteDefaultForbidden:
      "default_project is shared with the CLI and cannot be deleted from the web",
    noCredentialTitle: "No model credential configured",
    noCredentialBody:
      "The default model of this Project has no API key yet. Configure it on the Models page before chatting.",
    goToModels: "Go to Models",
    later: "Later",
  },

  agent: {
    listTitle: "Agents",
    create: "Create agent",
    createTitle: "Create agent",
    id: "Agent id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    nameHint: "Leave empty to use the agent id as the name",
    description: "Description",
    sessionCount: (n: number): string => `${n} session${n === 1 ? "" : "s"}`,
    toolCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    vaultKeyCount: (n: number): string => `${n} vault key${n === 1 ? "" : "s"}`,
    scheduleCount: (n: number): string => `${n} scheduled task${n === 1 ? "" : "s"}`,
    memoryCount: (n: number): string => (n === 1 ? "1 memory" : `${n} memories`),
    updatedAt: "Last modified",
    activity: (days: number): string => `${days}-day session activity`,
    settings: "Agent settings",
    backToList: "Back to Agents",
    tabOverview: "Overview",
    tabPrompt: "System Prompt",
    tabMemory: "Memory",
    tabRuntime: "Runtime",
    tabTools: "Tools",
    tabSkills: "Skills",
    tabVault: "Vault",
    tabSchedules: "Schedules",
    stateDir: "State path",
    copyStateDir: "Copy State path",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt template",
    placeholdersTitle: "Available placeholders (click to insert)",
    insertPlaceholder: "Insert at the system_prompt cursor",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). Inner tokens ({{VAULT_KEYS}} etc.) live in each feature tab's promptPlaceholders instead. */
    placeholders: [
      ["{{AGENTS_MD}}", "Injects the AGENTS.md content"],
      [
        "{{VAULT}}",
        "Injects the vault block (vault.prompt with the key-name list); empty when its toggle is off",
      ],
      [
        "{{SKILLS}}",
        "Injects the skills block (skills.prompt with installed-skill metadata); empty when its toggle is off",
      ],
      [
        "{{MEMORY}}",
        "Injects the memory block: memory.prompt plus memory.workspace_prompt (persistent workspaces only); empty when memory is off",
      ],
      [
        "{{SCHEDULES}}",
        "Injects the scheduled-tasks block (schedules.prompt with the task-name roster); empty when its toggle is off",
      ],
      ["{{PLATFORM}}", "Runtime platform"],
      ["{{OS_VERSION}}", "Operating system version"],
      ["{{SHELL}}", "Shell used to run commands"],
      ["{{DATE}}", "Current date"],
      [
        "{{PROJECT_DIR}}",
        "PenguinHarness app data root — all agents' data and project-level data; not the task working directory",
      ],
      ["{{AGENT_ID}}", "Current agent id"],
      ["{{CWD}}", "Absolute Workspace path"],
      ["{{PROVIDER}}", "Model provider group"],
      ["{{MODEL_ID}}", "Upstream model id"],
      ["{{SESSION_ID}}", "Current Session id"],
    ] as ReadonlyArray<readonly [string, string]>,
    maxTurns: "max_turns (max turns per Task, -1 = unlimited)",
    maxTokens: "model.max_tokens",
    thinkingLevel: "model.thinking_level",
    thinkingLevelOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      ["low", "Enables a lower tier of extended reasoning."],
      [
        "medium",
        "Enables a medium tier of extended reasoning (the default tier for a newly created agent).",
      ],
      ["high", "Enables a higher tier of extended reasoning; slower responses."],
      [
        "xhigh",
        "Enables the highest tier of extended reasoning; identical to high on some models.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    thinkingLevelNoneKept:
      "Stored legacy tier: new selections no longer offer the off tier (many models cannot disable thinking).",
    timeoutMs: "model.timeoutMs",
    timeoutMsHint: "Per-request timeout, ms",
    compaction: "Context compaction",
    maxContextLength: "max_context_length",
    maxContextLengthHint: "Context threshold that triggers compaction",
    maxSessionTurns: "max_session_turns",
    maxSessionTurnsHint: "Turn threshold that triggers compaction",
    compactionMode: "mode (compaction strategy)",
    compactionModeOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      [
        "summarize",
        "Summarizes the old context with the model, then continues from that summary in a fresh window (default).",
      ],
      [
        "discard",
        "Drops the old context without summarizing; the next turn starts fresh in a new window.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    compactionPrompt: "prompt (summarization prompt)",
    maxTurnsInvalid: "max_turns must be > 0 or -1",
    timeoutInvalid: "timeoutMs must be > 0 or -1",
    toolFieldInvalid: (name: string, field: string) =>
      `${name}: ${field} must be a positive integer or -1`,
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "Only reads. Auto-approved when the approval mode is read-only.",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription:
      "Can modify things. Needs manual confirmation when the approval mode is read-only.",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    toolCallDescription: "call_description",
    callDescriptionHint:
      "call_description: when on (the default), the tool's schema keeps the optional description argument — a model-written sentence about each call, shown to the user while it runs; when off, the argument is filtered out of the schema at assembly. Only tools whose parameters declare a description property can be toggled.",
    mcpServers: "MCP Servers",
    mcpDesc:
      "Connect external MCP Servers: their tools join this agent's toolset as mcp__<name>__<tool>. Changes in this block save immediately.",
    mcpEmpty: "No MCP Servers configured yet",
    mcpAdd: "Add MCP Server",
    mcpEditTitle: "Edit MCP Server",
    mcpRemove: "Remove",
    mcpName: "name",
    mcpNameHint: "Tool-name prefix: mcp__<name>__<tool>; letters, digits, _ and - only",
    mcpTransport: "transport",
    mcpTransportStdio: "Local process: spawns command and talks over stdin/stdout",
    mcpTransportHttp: "Streamable HTTP: the current spec's remote transport",
    mcpTransportSse: "Legacy HTTP+SSE: kept for servers that have not migrated",
    mcpTarget: "command / url",
    mcpCommand: "command",
    mcpArgs: "args",
    mcpArgsHint: "One argument per line",
    mcpEnv: "env",
    mcpEnvHint: "One KEY=value per line; the Agent vault is not injected into MCP Server processes",
    mcpCwd: "cwd",
    mcpCwdHint: "Leave empty to use the Session's Workspace",
    mcpUrl: "url",
    mcpHeaders: "headers",
    mcpHeadersHint: "One Header-Name: value per line (auth headers such as Authorization)",
    mcpConnectTimeout: "connectTimeoutMs",
    mcpBudgetsHint:
      "Leave empty for defaults: connectTimeoutMs is the connect + tool-discovery budget (default 10000); timeoutMs / maxOutputLength bound every tool of this Server.",
    mcpNameInvalid: "Letters, digits, _ and - only, starting with a letter or digit",
    mcpUrlInvalid: "Must be a valid http(s) URL",
    mcpLineInvalid: (line: number): string => `Line ${line} is not valid`,
    mcpNumberInvalid: "Must be an integer > 0",
    mcpDuplicateName: "A server with this name already exists",
    mcpTest: "Test connection",
    mcpTesting: "Testing…",
    mcpTestOk: (toolCount: number, latencyMs?: number): string => {
      const timing = latencyMs !== undefined ? ` (${(latencyMs / 1000).toFixed(1)}s)` : "";
      return toolCount === 0
        ? `Connected, but the server exposes no tools${timing}`
        : `Connected — ${toolCount} tool${toolCount === 1 ? "" : "s"}${timing}`;
    },
    mcpTestFail: (detail: string): string => `Connection failed: ${detail}`,
    mcpTestAllConfirm: (n: number): string =>
      `Connects to ${n === 1 ? "the configured MCP server" : `each of the ${n} configured MCP servers`} in turn and runs tool discovery (real connections, nothing is saved); results land on each row.`,
    mcpTestAllStart: "Start test",
    mcpTestPending: "Testing…",
    mcpTestBadge: (toolCount: number, latencyMs?: number): string =>
      `${toolCount} tool${toolCount === 1 ? "" : "s"}${latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}`,
    mcpTestBadgeFail: "Connection failed",
    mcpDeleteTitle: "Delete MCP Server",
    mcpDeleteConfirm: (name: string): string =>
      `Delete MCP Server "${name}"? Its tools stop being available from the next Session on.`,
    defaultValue: "(default)",
    deleteAgent: "Delete agent",
    builtinUndeletable: "Built-in agents cannot be deleted",
    deleteConfirm: (name: string): string =>
      `Delete agent "${name}"? Its directory (including all Traces) will be removed recursively and cannot be recovered.`,
    stateTitle: "Agent State",
    stateVersion: "Agent State version",
    transferDesc:
      "Export the current Agent State snapshot (tar.gz); importing overwrites the whole directory and adopts the version inside the package.",
    exportSnapshot: "Export snapshot",
    importSnapshot: "Import snapshot",
    importing: "Importing…",
    importDone: (v: number): string => `Import finished, Agent State version v${v}`,
    importConflictTitle: "Version conflict",
    importConflictBody:
      "The snapshot's version is not newer than the current one; importing will overwrite the existing Agent State. Continue?",
    resetConfigTitle: "Restore default configuration",
    resetConfigAction: "Restore default configuration",
    resetConfigConfirmBody:
      "This overwrites the agent's existing configuration with the current defaults: the custom system prompt, tool list, model/compaction settings and MCP servers are all replaced, keeping only name and description. Like a skill update this cannot be undone. Continue?",
    resetConfigDone: "Configuration restored to the current defaults",
    kernelTitle: "Kernel",
    kernelLegacy: "predates kernel versioning",
    kernelOutdatedHint: "Kernel update available",
    kernelUpToDate: "Up to date",
    kernelUpdateTitle: "Update kernel",
    kernelCurrent: "current",
    kernelLatest: "latest",
    kernelUpdateAction: "Update kernel",
    kernelUpdateConfirmBody:
      "Fields you have not customized will be updated to the current built-in defaults; customized fields stay unchanged and are listed in the result. Name, description, the State version and MCP servers are unaffected. Continue?",
    kernelUpdateDone: (version: string, advanced: number): string =>
      advanced > 0
        ? `Kernel updated to ${version}; ${advanced} field(s) now follow the new defaults`
        : `Kernel updated to ${version}; every field was already current or kept as customized`,
    kernelUpdateKeptIntro: "Kept because customized:",
    kernelListSeparator: ", ",
    kernelFieldTool: (name: string): string => `tool ${name}`,
    kernelFields: {
      system_prompt: "system prompt template",
      max_turns: "max turns per task",
      "model.max_tokens": "model max output tokens",
      "model.thinking_level": "thinking level",
      "model.timeoutMs": "request timeout",
      "compaction.max_context_length": "compaction context threshold",
      "compaction.max_session_turns": "compaction session-turn threshold",
      "compaction.mode": "compaction mode",
      "compaction.prompt": "compaction prompt",
      "memory.enabled": "memory switch",
      "memory.prompt": "memory prompt",
      "memory.workspace_prompt": "workspace memory prompt",
      "vault.enabled": "Vault section switch",
      "vault.prompt": "Vault prompt",
      "skills.enabled": "Skills section switch",
      "skills.prompt": "Skills prompt",
      "schedules.enabled": "Schedules section switch",
      "schedules.prompt": "Schedules prompt",
    } as Record<string, string>,
  },

  models: {
    keyConfigured: "Configured",
    testConnection: "Test connection",
    testing: "Testing\u2026",

    title: "Models",
    addCustom: "Add custom model",
    addToGroup: "Add model",
    editTitle: "Model settings",
    addTitle: "Add model (OpenAI protocol)",
    addTitleVendor: "Add model",
    addProtocolHint:
      "New models use the OpenAI Chat Completions protocol; set the base URL to a compatible endpoint",
    vendorProtocolHint: (vendor: string): string =>
      `Only ${vendor}'s official API protocol is supported; use a custom model group for OpenAI-compatible endpoints.`,
    autoRouteNone:
      "This id is not a recognized official model id: double-check it, or add the model under Custom / a user-defined group with an OpenAI-compatible endpoint",
    addGroup: "Add group",
    addGroupTitle: "Add group",
    addGroupDesc:
      "User-defined groups share Custom semantics: models use the OpenAI Chat Completions protocol (base URL required; an empty API key reads OPENAI_API_KEY). Groups live on model entries — the group appears once its first model is saved.",
    groupNameLabel: "Group name",
    groupNameHint: "Starts with a lowercase letter / digit; may contain - and _",
    groupNameInvalid:
      "Group names may only use lowercase letters, digits, - and _ (starting with a letter or digit), up to 32 characters",
    groupNameExists: "This name is taken by a built-in group or an existing entry",
    groupEmptyHint: "No models in this group yet; use “Add model” to create one",
    searchPlaceholder: "Search models: id / name / provider",
    noSearchResults: "No matching models",
    syncCatalog: "Sync presets",
    syncCatalogHint:
      "Update preset models from the built-in catalog: add missing entries and reset differing ones to the catalog's fields; locally added models and API keys are left untouched",
    syncDone: (added: number, updated: number) =>
      `Presets synced: ${added} added, ${updated} updated`,
    syncUpToDate: "Presets are already up to date",
    homepage: "Model page",
    speedTest: "Speed test",
    speedTestTitle: "Speed test",
    speedTestConfirm: (n: number): string =>
      `This sends one real request to each of the ${n} models in this group, one at a time, to measure time-to-first-token (TTFT) and output rate (TPS). It consumes a small amount of API quota. Continue?`,
    speedTestStart: "Start",
    speedPending: "Testing…",
    speedFailed: "Test failed",
    ttftTitle: "Time to first token (TTFT)",
    tpsTitle: "Output rate (TPS)",
    modelCount: (n: number): string => `${n} model${n === 1 ? "" : "s"}`,
    modelId: "Model ID",
    modelIdHint: "The upstream API model id, e.g. gpt-5.5",
    displayName: "Display name",
    displayNameHint: "Defaults to the model ID",
    providerGroup: "Group",
    contextWindow: "Context window",
    tokenUnit: "Token",
    contextWindowHint: "Leave empty if unknown",
    maxTokens: "Max output tokens",
    maxTokensHint: "Empty = inherit agent setting",
    maxTokensTitle:
      "Caps output tokens per request; leave empty to inherit the agent setting — lower it for small-context models",
    maxTokensInvalid: "Must be a positive integer",
    clientTypeLocked: (t: string): string => `Protocol: ${t} (kept as configured; not editable)`,
    vision: "Vision support",
    visionOffProxyHint: "Images are read via the vision proxy model",
    visionBadge: "Vision",
    freeBadge: "Free",
    visionModelBadge: "Proxy vision",
    setVisionModel: "Set as proxy vision model",
    visionModelHint: "Describes images via describe_image for models without vision",
    priceUnitShort: "/M tok",
    testOk: (ms: number): string => `Connected (${ms} ms)`,
    testFailed: (msg: string): string => `Failed: ${msg}`,
    priceCacheRead: "Cache read price",
    priceCacheWrite: "Cache write price",
    priceOutput: "Output price",
    currency: "Currency",
    currencyUsd: "USD $",
    currencyCny: "CNY ¥",
    apiKey: "API key",
    apiKeyKeepHint: "Leave empty to keep the current key",
    apiKeyEnvHint: (envKey: string): string => `Leave empty to use the ${envKey} env var`,
    clearApiKey: "Clear stored API key",
    baseUrl: "Custom base URL",
    baseUrlHint: "Leave empty to use the provider default",
    baseUrlSuffixTitle: "The client appends the grey protocol path to the base URL",
    baseUrlRequired: "A base URL is required",
    contextWindowDefaultHint: (n: number): string => `Defaults to ${n} if empty`,
    confirmDeleteTitle: "Delete model",
    confirmDelete: (name: string): string =>
      `Delete "${name}"? Its configuration and API key will be removed.`,
    groupApiKey: "Set API key for group",
    groupApiKeyTitle: (label: string): string => `Set the API key for ${label}`,
    groupApiKeyHint: (n: number): string =>
      `Applies to all ${n} models in this group; leave empty to keep them unchanged.`,
    getApiKey: "Get API key",
    getModelIds: "Get model IDs",
    groupKeyApplied: (n: number): string => `API key set for ${n} models`,
    providerEnvNotes: {
      zhipu:
        "Defaults to the Z.AI global endpoint (api.z.ai); keys from bigmodel.cn need base URL https://open.bigmodel.cn/api/paas/v4",
      moonshot:
        "Defaults to the China endpoint (api.moonshot.cn); keys from platform.kimi.com need base URL https://api.moonshot.ai/v1",
    },
    confirmVisionModelTitle: "Set as proxy vision model",
    confirmVisionModel: (name: string): string =>
      `Make "${name}" the proxy vision model? Models without vision will read images through it via describe_image.`,
    confirmSaveTitle: "Save model settings",
    confirmSave: (name: string): string => `Save the changes to "${name}"?`,
    confirmDefaultTitle: "Set as default model",
    confirmDefault: (name: string): string =>
      `Make "${name}" the default model? New sessions will use it by default.`,
    default: "Default",
    setDefault: "Set as default model",
    remove: "Delete model",
    readOnlyHint: "Members have read-only access; only owners can change models and credentials",
    empty: "No models configured yet",
    noKey: "No key",
    showModelsWithoutKey: (n: number): string =>
      `Show model${n === 1 ? "" : "s"} without a key (${n})`,
    modelIdExists: "This model id already exists",
    pricingAllOrNone: "Fill all three prices",
    pricingInvalid: "Must be a number",
    contextWindowInvalid: "Must be a number",
  },

  memory: {
    desc: "Long-term memory across Sessions (stored in agent_state/memory/): the agent saves what is worth keeping as it works, and you can also just ask it to remember something. User memory applies to all of this agent's sessions; workspace memory is kept per workspace. Memory edits are made by the agent in chat. Turning the switch off only stops memory from being used and deletes nothing.",
    enable: "Enable memory",
    userScope: "User memory",
    templateMissing:
      "The prompt template has no {{MEMORY}} placeholder, so memory never enters the context.",
    insertPlaceholder: "Insert the {{MEMORY}} placeholder",
    insertPlaceholderDone: "Inserted",
    promptSection: "Memory prompt",
    promptSectionHint:
      "What the template's {{MEMORY}} placeholder expands to. The main prompt is injected into every session; the workspace addendum only in sessions with a persistent workspace.",
    promptLabel: "Main prompt",
    workspacePromptLabel: "Workspace addendum",
    /**
     * Memory-prompt placeholder reference; a chip inserts into whichever field was focused
     * last. The two indexes plus the workspace directory — the user directory stays a literal
     * pattern in the prompt, resolvable from the Environment section.
     */
    promptPlaceholders: [
      [
        "{{USER_MEMORY_INDEX}}",
        "Content of the user MEMORY.md index (at most 200 lines and 25,000 characters total)",
      ],
      [
        "{{WORKSPACE_MEMORY_INDEX}}",
        "Content of the workspace MEMORY.md index (at most 200 lines and 25,000 characters total); effective only in the workspace addendum",
      ],
      [
        "{{WORKSPACE_MEMORY_DIR}}",
        "Absolute path of the current workspace's memory directory; effective only in the workspace addendum",
      ],
    ],
    insertToken: "Insert at the cursor",
    itemCount: (n: number): string => (n === 1 ? "1 item" : `${n} items`),
    emptyScope:
      "No memories for this Workspace yet — the agent saves what is worth keeping as it works",
    emptyUserScope: 'No user memories yet — say "remember …" in a chat and the agent will save it',
    add: "Add",
    addTitle: "Add memory",
    addWhy:
      "The agent organizes and saves memories in a chat: fill in the content, open a new conversation, and the agent does the rest.",
    addContentLabel: "Content or source to remember",
    addContentPlaceholder: "Paste the content to remember, or a file path / URL",
    /** Prefilled draft for the add-via-chat flow, per scope kind; the required content follows on the next line. */
    addPromptLead: {
      user: "Please turn the following into memories in user memory:",
      workspace: "Please turn the following into memories in this workspace's memory:",
    },
    view: "View",
    edit: "Edit",
    editTitle: "Edit memory",
    editWhy:
      "Content edits are made by the agent in a chat: confirm the prompt to open a new conversation, and the agent updates the memory file and its MEMORY.md index together.",
    editRequirementLabel: "What to change",
    editRequirementPlaceholder: "Describe the change (optional — you can finish it in the chat)",
    editPromptLabel: "Prompt preview",
    editCopyPrompt: "Copy prompt",
    editCopied: "Copied",
    editOpenChat: "Open a new chat",
    delete: "Delete",
    deleteTitle: "Delete this memory?",
    deleteConfirm: (name: string): string =>
      `This deletes "${name}" and removes its index line from MEMORY.md. This cannot be undone.`,
    deleteDone: "Deleted",
    /** Prefilled draft for the edit-via-chat flow; the user completes the trailing requirement line before sending. */
    editPromptLead: (title: string): string => `Please update a memory: ${title}`,
    editPromptTail: "What to change: ",
  },

  vault: {
    desc: "Environment variables owned by this agent (stored in agent_state/.vault.toml), injected into the environment of its shell commands (exec_command); key names are shared with the model, values never enter the model context. Subagents use their own vaults and do not inherit this one. Saved changes take effect from the next task (a task already running is unaffected).",
    key: "Name",
    value: "Value",
    valueMasked: "Value (masked)",
    add: "Add",
    addTitle: "Add variable",
    remove: "Remove",
    deleteTitle: "Delete variable",
    deleteConfirm: (key: string): string =>
      `Delete variable "${key}"? Its value cannot be recovered.`,
    overwriteTitle: "Overwrite existing variable",
    overwriteConfirm: (key: string): string =>
      `"${key}" already exists — saving will overwrite its value, which cannot be recovered.`,
    empty: "No variables configured yet",
    readOnlyHint: "Members are read-only; only the owner can edit the vault",
    keyHint: "Letters, digits and underscores; must not start with a digit",
    keyInvalid: "Invalid name: only letters, digits and underscores, not starting with a digit",
    valueRequired: "Value must not be empty",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable vault",
      templateMissing:
        "The prompt template has no {{VAULT}} placeholder, so the vault section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Vault section: one-click migration replaces it in place with the {{VAULT}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{VAULT}} placeholder",
      migrate: "Migrate to the {{VAULT}} placeholder",
      promptSection: "Vault prompt",
      promptSectionHint:
        "What the template's {{VAULT}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{VAULT_KEYS}}",
          'Vault key-name list (one "- KEY" line per key, names only — values are never injected; empty when no keys)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  schedule: {
    desc: "Scheduled tasks (agent_state/schedule/*.toml): the prompt is sent to the target Session on schedule; files can also be edited by hand, and changes made here take effect immediately.",
    readOnlyHint: "Members are read-only; only the owner can modify schedules",
    colStatus: "Status",
    colPeriod: "Period",
    colTarget: "Target",
    colFireTimes: "Next / last fired",
    colQueued: "Queue",
    statusNames: {
      active: "Active",
      disabled: "Disabled",
      expired: "Expired",
      done: "Done",
      missed: "Missed",
      invalid: "Invalid",
    } as Record<string, string>,
    queued: "Queued",
    once: "One-off",
    newSession: "New session",
    invalidFiles: "Files that failed to parse (skipped by the scheduler)",
    empty: "No scheduled tasks yet",
    enable: "Enable",
    disable: "Disable",
    addTitle: "New scheduled task",
    editTitle: (name: string): string => `Edit scheduled task "${name}"`,
    nameHint: "The file name (without .toml); cannot be changed later",
    prompt: "Prompt",
    enabled: "Enabled",
    startAt: "Start at",
    endAt: "End at (optional)",
    period: "Period",
    periodPlaceholder: "30m / 12h / 7d; leave empty for a one-off task",
    target: "Target",
    targetNew: "New session each time",
    targetSession: "Bound Session",
    sessionId: "Session",
    /** Bind-Session picker (searchable dropdown): trigger placeholder, search box, and empty states. */
    chooseSession: "Choose a Session to bind",
    sessionSearch: "Search title or Session id…",
    sessionNoMatch: "No matching Session",
    sessionEmpty: "This agent has no Sessions yet",
    workspace: "Workspace (optional; a temporary workspace is created when empty)",
    model: "Model",
    modelDefault: "Project default",
    deleteTitle: "Delete scheduled task",
    deleteConfirm: (name: string): string => `Delete scheduled task "${name}"?`,
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable schedules",
      templateMissing:
        "The prompt template has no {{SCHEDULES}} placeholder, so the scheduled-tasks section never enters the context.",
      insertPlaceholder: "Insert the {{SCHEDULES}} placeholder",
      promptSection: "Schedules prompt",
      promptSectionHint:
        "What the template's {{SCHEDULES}} placeholder expands to — teaches the model to manage scheduled tasks with its file tools; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SCHEDULE_LIST}}",
          'Current task-name list (one "- name" line per task; an empty-roster note when none exist)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  // Skills are built-in (installed for every agent automatically); the block below covers the
  // Agent settings Skills tab (installed list + zip import/export) and the agents-page count —
  // the former library page's browse/install/quick-invoke strings were removed with the page.
  skills: {
    uninstall: "Uninstall",
    /** Skill count on the agents-page card metadata. */
    skillCount: (n: number): string => (n === 1 ? "1 skill" : `${n} skills`),
    uninstalledToast: (skill: string, agent: string): string =>
      `Uninstalled ${skill} from ${agent}`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (skill: string, agent: string): string =>
      `Uninstall ${skill} from ${agent}? Its installed files (local edits included) will be deleted.`,
    /** Agent settings "Skills" tab (installed list + import modal). */
    agentTabDesc:
      "Skills installed on this agent (agent_state/skills/ — the files are the source of truth): metadata is injected into the system prompt and the body is read by the model on demand; uninstalling deletes the whole skill directory.",
    agentTabEmpty: "No skills installed yet",
    exportSkill: "Export",
    importSkill: "Import skill",
    importChatTitle: "Recommended: install by chatting with the agent",
    importChatWhy:
      "The agent can read, review and adapt the skill content in full — more reliable than a raw upload.",
    importSourceLabel: "Skill source",
    importSourceHint:
      "A web page / GitHub repo or directory / local path / an install command from another ecosystem",
    importSourcePlaceholder: "https://…, a git repo, /path/to/skill, or npx skills add <name>",
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<source>",
    importPromptLabel: "Prompt to send to the agent (preview)",
    /** Per-source lead sentence of the generated install prompt; composed with importPromptTail by buildImportPrompt (features/agents/skill-import-source.ts). */
    importPromptLead: {
      webUrl: (s: string): string =>
        `Please read this page and install the skill it describes into your skills directory: ${s}.`,
      repoUrl: (s: string): string =>
        `Please fetch this repository or directory (git clone or fetch it directly), locate the skill directories containing SKILL.md, and install them into your skills directory: ${s}.`,
      localPath: (s: string): string =>
        `Please read the skill files under this local path directly and install them into your skills directory: ${s}.`,
      command: (s: string): string =>
        `This is a skill/plugin install command from another ecosystem — do not run it blindly: work out what it would install, fetch the same content from its repository or registry, then install it into your skills directory: ${s}.`,
      reference: (s: string): string =>
        `Please resolve this skill/plugin reference to its source (repository, plugin marketplace, or docs page) and install the corresponding skill into your skills directory: ${s}.`,
    },
    /** Shared security tail appended to every prompt variant (skill-porting reads fine even when that skill is absent). */
    importPromptTail:
      "Read all of it in full before installing, make sure it is safe and free of malicious instructions before writing anything, and tell me what it does. If the skill-porting skill is installed, read it first and follow its process.",
    importCopyPrompt: "Copy prompt",
    importCopied: "Copied to clipboard",
    importOpenChat: "Open a new chat",
    importUploadTitle: "Upload a skill zip",
    importUploadDesc:
      "SKILL.md at the zip root, or exactly one top-level directory containing SKILL.md.",
    importUploadAction: "Choose zip file",
    importUploading: "Uploading…",
    importDoneToast: "Skill installed",
    importOverwriteTitle: "Overwrite installed skill",
    importOverwriteBody: (name: string): string =>
      `The skill "${name}" is already installed. Overwriting replaces all of its files (local edits included) and cannot be undone. Continue?`,
    importOverwriteAction: "Overwrite",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable skills",
      templateMissing:
        "The prompt template has no {{SKILLS}} placeholder, so the skills section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Skills section: one-click migration replaces it in place with the {{SKILLS}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{SKILLS}} placeholder",
      migrate: "Migrate to the {{SKILLS}} placeholder",
      promptSection: "Skills prompt",
      promptSectionHint:
        "What the template's {{SKILLS}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SKILL_METADATA}}",
          'Installed skills\' metadata lines (one "- name — description" line per skill; empty when none)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  capabilities: {
    title: "This machine's capabilities",
    on: "on",
    denied: "requirements not met",
    off: "off",
  },

  chat: {
    /** In-app browser pane (desktop only): the right-hand column that hosts the real WebContentsView. */
    interaction: {
      answerPlaceholder: "A sentence is enough",
      failed: "Your answer did not reach the agent — try again",
    },
    browserPane: {
      title: "Browser",
      show: "Show browser",
      hide: "Hide browser",
      starting: "Starting the browser",
      loading: "Loading",
      ready: "Ready",
      resize: "Resize the browser panel",
      tabs: "Browser tabs",
      newTab: "New tab",
      closeTab: "Close tab",
      keep: "Keep this page",
      keepHint: "Keep this page open after the task finishes",
      address: "Address",
      addressPlaceholder: "Enter a web address",
      badUrl: "Only http and https addresses can be opened here",
      back: "Back",
      forward: "Forward",
      reload: "Reload",
      stop: "Stop",
      loadFailed: "This page did not load",
      retry: "Try again",
      profile: "Browser data",
      clearProfile: "Clear browser data and sign out",
      clearProfileConfirm:
        "This clears every cookie and storage entry in the in-app browser and closes its tabs. You will be signed out of the sites you were using.",
      backend: "Browser backend",
      backendIab: "In-app browser",
      backendExtension: "My own Chrome (extension)",
      backendExtensionHint:
        "Uses your existing signed-in Chrome profile; setup opens if the extension is not connected",
      backendExtensionSelected:
        "The next task will use Chrome. To use an existing tab, click the extension icon in that tab.",
      backendExtensionUnavailableSelected:
        "Chrome is selected but unavailable. Choose the in-app browser, or resolve the connection and restart.",
      chromePanelTitle: "This conversation will use your Chrome",
      chromePanelBody:
        "The next agent task creates and controls its own tabs in Chrome. This pane does not mirror Chrome or transfer the current in-app page.",
      chromePanelUnavailable:
        "Chrome cannot connect right now. Choose the in-app browser from the top-right menu, or resolve the relay-port conflict and restart the app.",
      chromePanelIabSafe:
        "Your in-app browser pages are still saved; choose it again to keep viewing them.",
      chromePanelCheck: "Check or set up the Chrome extension",
      inAppBrowserData: "In-app browser data",
      openInDefaultBrowser: "Open the current in-app page in my default browser",
      openInDefaultBrowserHint:
        "Only opens a separate copy in your system browser. It does not switch the agent backend or carry your in-app sign-in across.",
      backendLocked: "A task is running; the browser cannot be switched now",
      backendUnavailable:
        "This run cannot reach the relay port the extension connects to, so your own Chrome is unavailable",
      profileResetLocked: "A task is using the browser; its data cannot be cleared right now",
      clearProfileDone: "Browser data cleared",
      clearProfileFailed: "Could not clear the browser data",
      backendFailed: "Could not switch the browser",
      zoom: "Zoom",
      zoomOut: "Zoom out",
      zoomIn: "Zoom in",
      zoomReset: "Reset zoom",
      zoomFailed: "Could not change page zoom",
      openInDefaultBrowserFailed: "Could not open this page in your default browser",
      suggestions: "Address suggestions",
      /** The "sign in as youhai@example.com" bar. User-pressed only; the agent cannot use these. */
      logins: {
        prompt: "Saved login",
        fillAs: (username: string) => `Fill ${username}`,
        fillNoUsername: "Fill saved password",
        filled: (username: string) => `Filled ${username}; press sign in yourself`,
        noSubmit: "Fills the form only; it does not press sign in for you",
        dismiss: "Dismiss",
      },
      /** Bringing cookies, saved logins and history over from the user's own Chrome. */
      import: {
        open: "Import into in-app browser",
        title: "Import from your browser into the in-app browser",
        subtitle: "Choose data to bring over to the built-in browser",
        from: "From",
        /** The "Close Google Chrome completely before importing" line, per browser. */
        closeFirst: (browsers: string) => `Close ${browsers} completely before importing`,
        closeFirstWhy:
          "A running browser locks these files, and the most recent sign-ins may not be read",
        passwords: "Saved passwords",
        cookies: "Cookies",
        history: "Browsing history",
        /** Shown when this machine has no encrypted storage, so passwords cannot be stored. */
        passwordsUnavailable: "This machine has no encrypted storage, so passwords cannot be saved",
        /** A data type the selected profile simply does not have. */
        kindMissing: "This profile has none of this",
        noSources: "No browser found to import from",
        noSourcesHint: "Chrome, Edge, Brave, Chromium and Vivaldi are supported",
        importing: "Importing…",
        submit: "Import",
        /** macOS shows a keychain prompt; say so before it appears rather than after. */
        keychainNotice:
          "Your system may ask for keychain access; it has to be allowed to read encrypted data",
        done: (count: number) => `Imported ${count} items`,
        doneNothing: "Nothing was imported",
        partial: (imported: number, skipped: number) =>
          `Imported ${imported}; ${skipped} could not be read`,
        failed: "Import failed",
        cookiesLandIn:
          "Cookies go into the built-in browser's own profile and do not affect your Chrome",
      },
    },
    newSessionMenu: "New chat",
    chooseAgent: "Choose agent",
    chooseModel: "Choose model",
    thinkingLevel: "Thinking level",
    thinkingLevelNames: {
      none: "None",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extreme High",
    },
    workspaceUseThis: "Use this dir",
    workspaceUp: "Parent dir",
    workspaceNoSubdirs: "No subdirectories",
    workspaceAuto: "Temporary workspace",
    workspaceClear: "Use a temporary workspace instead",
    workspaceDirInvalid: "Directory does not exist or is inaccessible; reverted",
    /** Sidebar conversation-list grouping toggle (workspace is the default) + workspace groups. */
    groupByWorkspace: "Group by workspace",
    groupByAgent: "Group by agent",
    tempWorkspaces: "Temporary workspaces",
    newSessionInWorkspace: "New chat in this workspace",
    draftGreeting: (name: string) => `Where to today${name ? `, ${name}` : ""}?`,
    draftSubtitle:
      "Tell me where you want to go. I’ll search, compare, and make the trade-offs clear.",
    draftPrompt: "Start with an idea",
    // Draft-screen "Jump back in" rail heading (recent resumable conversations).
    // The returning-state rail leads with the person's own next trip, rendered purely from
    // trip.json fields and the session index -- never a model call (the root spec declines a
    // proactive AI opener; a countdown is arithmetic, not judgement).
    upNext: {
      title: "Up next",
      departsToday: "Departs today",
      departsTomorrow: "Departs tomorrow",
      departsInDays: (n: number) => `Departs in ${n} days`,
      waitingOnYou: (n: number) => (n === 1 ? "1 waiting on you" : `${n} waiting on you`),
      chats: (n: number) => (n === 1 ? "1 chat" : `${n} chats`),
      updated: (date: string) => `updated ${date}`,
    },
    jumpBackIn: "Jump back in",
    // First-run-only editorial prompts (the rail shows them until the first real trip or
    // conversation exists). A click starts a real draft task with the current settings.
    getInspired: {
      title: "Get inspired",
      previous: "Scroll travel inspiration left",
      next: "Scroll travel inspiration right",
      cards: {
        kyotoAutumn: {
          title: "Chase autumn in Kyoto",
          tag: "Seasonal escape",
          prompt:
            "Design a five-day Kyoto trip centered on autumn foliage. First compare the scenery, crowd levels, and price trade-offs across the middle and end of November, then build a daily route combining temples, gardens, evening illuminations, and quieter neighborhoods. Keep stays and transport to a few representative options, explain why each made the cut, and wait for my confirmation before any booking.",
        },
        bangkokFood: {
          title: "Taste your way through Bangkok",
          tag: "Food journey",
          prompt:
            "Design a four-day Bangkok food trip balancing street food, traditional markets, neighborhood restaurants, and one dinner worth reserving. Organize each day by area so we do not cross the city just to collect stops, and explain hygiene, queues, opening hours, and transport trade-offs. Start with the plan and a few representative restaurants, and do not book anything until I confirm.",
        },
        northernLights: {
          title: "Sleep beneath the northern lights",
          tag: "Nature escape",
          prompt:
            "Plan a six-day trip centered on seeing the northern lights. First compare northern Iceland, northern Norway, and Finnish Lapland for weather reliability, transport, budget, and variety of activities. Recommend one destination and build an itinerary with weather buffer nights. Keep stays and activities to a few representative options, and wait for my confirmation before any booking.",
        },
      },
    },
    // Trip-constraint chips: compose copy (TripChipsCopy contract in
    // trip-constraints.ts) + chip/popover UI copy. "Budget" is the trip's price TIER —
    tripChips: {
      lineFolder: "Trip folder: ",
      lineWhere: "Where: ",
      lineWhen: "When: ",
      lineWho: "Who: ",
      lineBudget: "Budget: ",
      budgetAmount: (yuan: number) => `¥${yuan.toLocaleString("en-US")} total`,
      dateRange: (start: string, end: string) => `${start} to ${end}`,
      dateFrom: (start: string) => `departing ${start}`,
      dateUntil: (end: string) => `returning by ${end}`,
      flexible: (days: number, month: string) => `any ${days} days in ${month}`,
      flexibleAnyMonth: (days: number) => `${days} days, dates flexible`,
      flexibleMonthOnly: (month: string) => `sometime in ${month}`,
      adults: (n: number) => `${n} adult${n > 1 ? "s" : ""}`,
      children: (n: number) => `${n} child${n > 1 ? "ren" : ""}`,
      infants: (n: number) => `${n} infant${n > 1 ? "s" : ""}`,
      whoJoin: ", ",
      tiers: {
        any: "any budget",
        low: "on a budget (¥)",
        mid: "sensibly priced (¥¥)",
        high: "upscale (¥¥¥)",
        luxury: "luxury (¥¥¥¥)",
      },
      // Chip labels (unfilled) and short summaries (filled).
      where: "Where",
      when: "When",
      who: "Who",
      budget: "Budget",
      tierShort: { any: "Any", low: "¥", mid: "¥¥", high: "¥¥¥", luxury: "¥¥¥¥" },
      /** Chip summary when an exact total is stated ("¥20,000"). */
      amountShort: (yuan: number) => `¥${yuan.toLocaleString("en-US")}`,
      travellers: (n: number) => `${n} traveler${n > 1 ? "s" : ""}`,
      /** Chip summary: people, plus pets when there are any ("2 travelers · 1 pet"). */
      whoSummary: (people: number, pets: number): string => {
        const petPart = pets === 1 ? "1 pet" : `${pets} pets`;
        if (pets === 0) return `${people} traveler${people > 1 ? "s" : ""}`;
        return people > 0 ? `${people} traveler${people > 1 ? "s" : ""} · ${petPart}` : petPart;
      },
      daysCount: (n: number) => `${n} day${n > 1 ? "s" : ""}`,
      flexibleTag: "flexible",
      monthCount: (n: number) => `${n} months`,
      monthsLabel: "Months",
      monthsHint: "Pick any number; none means any month",
      /** Intl locale for month names inside the When dialog. */
      intlLocale: "en-US",
      // Popover copy.
      wherePlaceholder: "City or region — several is fine",
      whereHint: "e.g. Tokyo, Osaka",
      whereListLabel: "Location suggestions",
      whereSearching: "Searching places…",
      whereNoResults: "No matching places. You can keep this text.",
      whereUnavailable: "Suggestions are unavailable. You can still enter any destination.",
      datesMode: "Dates",
      flexibleMode: "Flexible",
      startDate: "Start",
      endDate: "End",
      daysLabel: "How many days",
      monthLabel: "Month (optional)",
      adultsLabel: "Adults",
      adultsHint: "Ages 13 or above",
      childrenLabel: "Children",
      childrenHint: "Ages 2–12",
      infantsLabel: "Infants",
      infantsHint: "Under 2",
      petsLabel: "Pets",
      pets: (n: number) => `${n} pet${n > 1 ? "s" : ""}`,
      petsHint: "Animals travelling with you",
      budgetTitle: "Pick a range, or state a number",
      budgetAmountLabel: "Total budget",
      budgetAmountHint: "Optional · whole trip · CNY",
      budgetAmountPlaceholder: "e.g. 20000",
      clear: "Clear",
      /** Dialog footer: closes it. Not "Update" — nothing runs until the message is sent. */
      dialogDone: "Done",
    },
    jumpBackInPrevious: "Scroll recent chats left",
    jumpBackInNext: "Scroll recent chats right",
    exampleTasks: {
      ctripFlight: {
        label: "Book tomorrow's flight on Ctrip",
        desc: "Beijing to Shanghai for a business trip — cheapest fare, no add-on bundles",
        prompt:
          "I'm going to Shanghai on a business trip tomorrow. Open Ctrip and book tomorrow's flight from Beijing to Shanghai for me — pick the cheapest one and book it, and don't add any extra service bundles.",
      },
      otaCompare: {
        label: "Compare Ctrip and Fliggy prices",
        desc: "Nanjing to Beijing flights — find the cheapest fare without add-ons",
        prompt:
          "下周六我准备去北京旅游，帮我打开携程、飞猪，搜索南京去北京的机票，不需要附加服务，需要最便宜的一项；先不要进入订票流程，等我选择后再继续预定",
      },
      xhsTrip: {
        label: "Turn Xiaohongshu guides into a trip",
        desc: "Build a three-day Chengdu itinerary, then find stays under ¥400 per night",
        prompt:
          "搜索上海出发、两人、成都三日美食及游玩攻略，综合多篇小红书笔记形成游玩逐日行程，结合旅游行程规划再打开携程搜索行程中相关的酒店住宿，预算400以内一晚。",
      },
    },
    sessionList: "Sessions",
    defaultSessionTitle: "New chat",
    /** Session header navigation back to the New task welcome screen. */
    backHome: "Back home",
    model: "Model",
    workspace: "Workspace",
    workspaceHint:
      "Leave empty for an auto-created temporary workspace; if set, it must be an existing directory on the server",
    approvalMode: "Approval mode",
    approvalModeNames: {
      "allow-all": "Approve everything",
      "deny-all": "Deny everything",
      "read-only": "Approve read-only",
      "always-ask": "Ask every time",
    } as Record<string, string>,
    approvalModes: {
      "allow-all": "Approve everything (allow-all)",
      "deny-all": "Deny everything (deny-all)",
      "read-only": "Approve read-only (read-only)",
      "always-ask": "Ask every time (always-ask)",
    } as Record<string, string>,
    statusRunning: "Running",
    statusCompacting: "Compacting",
    pendingApprovals: (n: number) => `${n} pending approval${n > 1 ? "s" : ""}`,
    jumpToLatest: "Jump to latest",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "Loading earlier messages…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "Failed to load earlier messages — click to retry",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "Beginning of conversation",
    /** Conversation minimap (tick rail over the stream's left gutter): rail aria-label. */
    outlineTitle: "Outline",
    /** Tick accessible name: turn number + the question (or the no-text placeholder). */
    outlineTickLabel: (n: number, question: string) => `Turn ${n}: ${question}`,
    /** Entry label when the prompt had no text body (image / attachment-only message). */
    outlineNoText: "(image or attachment)",
    /** Answer-preview placeholder while the latest turn is still running with no reply text yet. */
    outlineAnswering: "Answering…",
    inputPlaceholder: "Type a message. Enter to send, Shift+Enter for newline, paste images",
    inputPlaceholderShort: "Type a message…",
    draftInputPlaceholder: "Tell me where, when, and what matters most…",
    /** Placeholder while a Task is running (mid-run steering): the message is delivered between turns with the next request. */
    steerPlaceholder: "Message the running agent — delivered with the next turn",
    steerPlaceholderShort: "Message the running agent…",
    steerSend: "Send to the running agent",
    /** Queued hint shown after a successful steer, until the steering message appears in the stream. */
    steerQueuedIndicator: "Steering queued — delivered with the next turn",
    /** Same hint, with the queued message's content (from the server's undelivered-steering mirror; survives reloads). */
    steerQueuedItem: (content: string) =>
      `Steering queued — delivered with the next turn: ${content}`,
    /** Label of the [user_steering] chip (a mid-run user message delivered between turns). */
    userSteering: "User steering",
    /** Mid-run send-mode setting: steer (delivered mid-run) vs follow-up (queued until the run ends). */
    steerModeLabel: "Mid-run send mode",
    steerModeSteer: "Steer",
    steerModeSteerHint: "Steer now: delivered to the running agent with the next turn",
    steerModeFollowUp: "Queue",
    steerModeFollowUpHint:
      "Queue a follow-up: sent automatically as a new message when this run finishes",
    followUpPlaceholder: "Queue as the next message — sent automatically when this run finishes",
    followUpPlaceholderShort: "Queue as the next message…",
    followUpSend: "Queue as the next message",
    /** Server-side queued follow-up count (auto-sent once the current run finishes). */
    followUpQueuedChip: (n: number) =>
      `${n} follow-up ${n === 1 ? "message" : "messages"} queued — sent when this run finishes`,
    send: "Send",
    stop: "Stop",
    compact: "Compact context",
    approve: "Allow",
    deny: "Deny",
    decisionAllow: "Approved",
    decisionDeny: "Denied",
    decisionManual: "manual",
    decisionAuto: "auto",
    thinking: "Thinking",
    subagent: "Subagent",
    subagentRunning: "Running",
    aborted: (reason?: string) => `[Aborted]${reason ? `: ${reason}` : ""}`,
    /** Auth-dead notice (request_end status "auth"): action-only copy — updating the key on the Models page auto-unlocks this Session. */
    modelAuthDead:
      "Model API authentication failed: update this model's API key on the Models page, or start a new Session.",
    modelAuthDeadOpenModels: "Open Models page",
    modelAuthDeadRetry: "Retry",
    modelAuthDeadCta: "New Session",
    modelAuthDeadPlaceholder: "Model authentication failed — update the API key first",
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
          ? "Connection timed out"
          : status === "malformed"
            ? "Response incomplete or unparseable"
            : "The model provider returned an error";
      const action =
        state === "gaveUp"
          ? "no further retries"
          : state === "retried"
            ? `retry #${attempt} sent`
            : secondsLeft !== undefined
              ? `retry #${attempt} in ${secondsLeft}s…`
              : `starting retry #${attempt}…`;
      return `[Retry] ${cause}; ${action}`;
    },
    /** "Retry now" on the reconnect countdown (skips the remaining backoff wait). */
    reconnectRetryNow: "Retry now",
    /** "Give up" on the reconnect countdown (the ordinary session abort). */
    reconnectGiveUp: "Give up",
    imageAlt: "Image uploaded by user",
    toolImageAlt: "Image from tool output",
    imagesAsPathHint:
      "This model cannot view images directly: on send, images are saved to the session scratchpad and passed as file paths (viewed via describe_image)",
    infoPanel: "Session info",
    sessionStats: "Stats",
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "Copy Session id",
    /** Info-dropdown trace row: labels the Session's trace file path (clicking deep-links to the Trace page). */
    traceFile: "Trace file",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions. */
    processList: "Processes",
    processStop: "Stop",
    processExited: "exited",
    /** Header chip title: count of the conversation's still-running background processes. */
    runningServices: (n: number) => (n === 1 ? "1 running service" : `${n} running services`),
    statTokens: "Total Tokens",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "Total Tokens",
    statCacheHit: (pct: string) => `cache hit rate ${pct}`,
    statElapsed: "Elapsed",
    statInput: "Input tokens",
    statCached: "cached",
    statOutput: "Output tokens",
    statTps: "Output TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (ASCII with a leading space for en). */
    statParenOpen: " (",
    statParenClose: ")",
    noSessions: "No Sessions yet",
    emptyStream: "Send a message to start the conversation",
    historyLoadFailed: "Failed to load history",
    statsLabel: "Stats",
    removeImage: "Remove image",
    openWorkspace: "Open workspace",
    openAgents: "Agents panel",
    filesInMessage: (n: number) => `${n} ${n === 1 ? "file" : "files"}`,
    imagesInMessage: (n: number) => `${n} ${n === 1 ? "image" : "images"}`,
    openPreview: "Click to preview",
    showMoreFiles: (n: number) => `Show ${n} more ${n === 1 ? "file" : "files"}`,
    showLess: "Show less",
    /** Reveal the next page of sidebar groups (#139); n = groups still hidden. */
    moreGroups: (n: number) => `More groups (${n})`,
    contextUsage: "Context usage",
    contextUnknown: "Context usage: unknown until the next request reports it",
    slashHint: "Type / for commands",
    switchAgent: "Hand off to another agent — opens a new session on send",
    switchAgentTitle: "Choose agent",
    agentSearchPlaceholder: "Search agents: id / name",
    agentsNoMatch: "No matching agents",
    handoffTargetTitle: (agent: string) => `Sending hands this conversation to ${agent}`,
    handoffRemove: "Remove handoff target",
    skillsSelect: "Skills",
    skillRemove: "Remove skill",
    skillsSearchPlaceholder: "Search skills",
    skillsNoMatch: "No matching skills",
    skillsEmptyHint: "No skills installed yet — import one from the agent settings' Skills tab",
    skillsAutoMessage: (names: string[]): string =>
      names.length === 1 ? `use the ${names[0]} skill` : `use the ${names.join(", ")} skills`,
    handoffFrom: (agent: string) => `Handed off from ${agent}'s conversation`,
    handoffBack: (title?: string) =>
      title ? `Back to the original conversation: ${title}` : "Back to the original conversation",
    switchModel: "Switch model — on send, continues this conversation in a new session",
    switchModelTitle: "Switch model",
    modelSwitchTargetTitle: (model: string) => `Sending continues this conversation on ${model}`,
    modelSwitchRemove: "Remove model switch",
    modelSwitchBusyHint:
      "The model switch waits for this turn to finish: the new session continues from this session's record",
    modelSwitchFrom: (prevModel?: string) =>
      prevModel
        ? `Switched model (was ${prevModel}) — continued from the earlier conversation`
        : "Switched model — continued from the earlier conversation",
    modelSwitchAutoMessage: "Continue this conversation on the new model",
    /** Toast when the session-state (locked) model display is clicked: points at the `/model` command. */
    modelLockedHint: "Type /model to switch models",
    scheduledFrom: (name: string) => `Triggered by scheduled task "${name}"`,
    emptyGreeting: "Start a new conversation",
    /** Unified step-row titles (same header idiom as workRunning/workDone). */
    mcpConnectTitle: "MCP connect",
    mcpServerList: (servers: string[]): string => servers.join(", "),
    /** One-line result detail: tool count, plus the NAMES of failed servers (reasons live in the expanded server groups). */
    mcpConnectResult: (toolCount: number, failed: string[]): string => {
      const parts: string[] = [];
      if (toolCount > 0 || failed.length === 0) {
        parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"} discovered`);
      }
      if (failed.length > 0) parts.push(`unavailable: ${failed.join(", ")}`);
      return parts.join("; ");
    },
    /** Per-server group row meta inside the expanded connect row. */
    mcpToolsCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    mcpServerFailed: "connection failed",
    mcpConnectAborted: "interrupted — reconnects on the next send",
    compactionTitle: "Compaction",
    compactionDone: (mode: string) =>
      mode === "discard" ? "old context discarded" : "switched to the summarized context",
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "aborted, keeping current context";
      return errorMessage !== undefined
        ? `failed (${errorMessage}), keeping current context`
        : "failed, keeping current context";
    },
    unknownTool: "(unknown tool)",
    workRunning: "Running",
    workDone: "Done",
    workGroupSteps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    approvalWaiting: "awaiting approval",
    copyCode: "Copy code",
    copyReply: "Copy reply",
    copyMessage: "Copy message",
    deleteSession: "Delete chat",
    renameSession: "Rename chat",
    renameSessionLabel: "Title",
    deleteSessionConfirm: (title: string) =>
      `Delete "${title}"? Its messages and Trace will be removed permanently.`,
    /** Parked draft conversations (unsent new chats living in the sidebar list — see draft-sessions.ts). */
    draftGroup: "Drafts",
    draftUntitled: "(untitled draft)",
    deleteDraft: "Delete draft",
    deleteDraftConfirm: (title: string) =>
      `Delete draft "${title}"? Unsent content will be discarded.`,
    archiveSession: "Archive",
    unarchiveSession: "Unarchive",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "More",
    /** Collapsed sidebar folders inside a group (lazy-loaded); the count is the group's exact server share. */
    folderGroups: {
      subagent: (n: number) => `Subagents (${n})`,
      schedule: (n: number) => `Scheduled (${n})`,
      archived: (n: number) => `Archived (${n})`,
    },
    skillsBanner: (names: string[]): string =>
      `Using skill${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    attachedFilesBanner: (names: string[]): string =>
      `Attached file${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    /** Composer "+" extension menu: image upload and file attachment. */
    plusMenu: "More input options",
    uploadImage: "Upload image",
    uploadImageDesc: "Attach images to this message",
    uploadFile: "Upload file",
    uploadFileDesc: "Saved to the session scratchpad; the model reads them by path",
    removeFile: "Remove file",
    attachmentTooLarge: (name: string): string =>
      `${name} exceeds the 10MB limit and was not attached.`,
  },

  /** Subagents side panel: call-graph of the latest Task + the selected child conversation. */
  subagentPanel: {
    title: "Agents panel",
    topologyLabel: "Call graph",
    mainSessionNote: "The main conversation stays in the chat area",
    empty: "No subagents in the current task yet",
    nodeRunning: "running",
    nodeDone: "done",
  },

  files: {
    title: "Files",
    upload: "Upload",
    download: "Download",
    openInNewTab: "Open in new tab",
    previewNotIsolatedHint:
      "This address has no separate preview origin, so the page opens sandboxed: localStorage, cookies and third-party embeds will not work. Reach the app over 127.0.0.1 or localhost, or set PENGUIN_PREVIEW_ORIGIN.",
    refresh: "Refresh",
    root: "Workspace root",
    empty: "Empty directory",
    previewUnsupported: "Preview not supported for this type; download instead",
    uploaded: "Uploaded",
    /** Upload-overwrite confirmation: same-name files in the current directory will be replaced. */
    overwriteTitle: "Overwrite existing files",
    overwriteConfirm: (n: number): string =>
      `The current directory already has ${n} file(s) with these names — uploading will overwrite:`,
    loadFailed: "Failed to load",
    previewTruncated: "File too large; preview truncated, download for the full file",
    details: "Details",
    workspacePath: "Workspace path",
    htmlRendered: "Rendered",
    htmlSource: "Source",
    backToList: "Back to list",
    resizeHandle: "Drag to resize, double-click to reset",
  },

  errors: {
    networkError: "Network error, please check your connection",
    modelCredentialMissing: (modelId: string) =>
      `Model ${modelId} has no API key yet — configure it on the Models page first`,
    noDefaultModel: "This project has no default model yet — add one on the Models page first",
    /** Localized text for the common server error codes (server error messages are English-only); looked up by ApiError.code in apiErrorText, falling back to the raw message for unmapped codes. */
    byCode: {
      invalid_credentials: "Incorrect username or password.",
      too_many_attempts: "Too many failed sign-in attempts. Try again shortly.",
      password_mismatch: "The current password is incorrect.",
      invalid_password: "Password must be at least 8 characters.",
      admin_required: "Only an admin can perform this operation.",
      desktop_single_user: "The desktop app is single-user; user management is unavailable.",
      not_found: "This resource does not exist, or you do not have access.",
      agent_not_found: "This agent no longer exists.",
      unknown_agent: "That agent does not exist in this Project.",
      agent_exists: "This agent id is already taken.",
      project_exists: "This Project id is already taken.",
      user_exists: "This username is already taken.",
      user_not_found: "This user no longer exists.",
      cannot_delete_admin: "The built-in admin cannot be deleted.",
      member_not_found: "This user is not a member of the Project.",
      schedule_exists: "A scheduled task with this name already exists.",
      schedule_not_found: "This scheduled task no longer exists.",
      unknown_skill: "This skill is not in the library.",
      file_not_found: "This file no longer exists.",
      file_too_large: "The file is too large.",
      too_many_files: "Too many files attached to one message.",
      payload_too_large: "The request is too large.",
      dir_not_absolute: "The directory must be an absolute path.",
      dir_not_found: "That directory does not exist or is inaccessible.",
      not_a_dir: "That path is not a directory.",
      path_not_found: "That path does not exist.",
      workspace_missing: "This Session's Workspace no longer exists.",
      task_in_progress: "This Session already has a task running.",
      version_conflict: "The snapshot's version is not newer than the current one.",
      invalid_title: "The title is invalid.",
      invalid_proxy_url:
        "Invalid proxy address — use http://host[:port], https://host[:port], or host[:port].",
      invalid_trace: "This file is not a valid Trace file.",
      trace_session_exists:
        "This agent already has a Session with that id; a duplicate Trace cannot be imported.",
    },
  },
};
