# Agent-first：隐私资料 Vault 与付款确认

| | |
| --- | --- |
| 状态 | **架构方向定稿。L2/L3 数据能力被 P0 硬前提阻塞**，见 §0.3 |
| 日期 | 2026-08-15 |
| 基线 | travel-agent `8cead1d` |
| 目标 | Agent 全程执行；用户只在付款/最终下单、方案选择、OTP/3DS/验证码这几个节点通过卡片或对话介入，之后仍由 Agent 继续 |
| 关系 | 被 `002-codex-style-single-window-iab.md` 引用；**supersedes 002 中「默认完整 `user_control`」的部分**，见 §0.2 |

---

## 0. 定位

### 0.1 一句话

**把「让用户接管浏览器」从默认路径降级为最后手段。** 资料由本地可信组件代填，付款由一次性 capability 授权，用户只回答问题、做选择、确认金额、输入一次性密码。

### 0.2 supersedes 002 的哪一部分

002 §6.5 的控制权状态机把 `user_control`（用户完整接管浏览器）当作与 `agent_control` 并列的常规状态，`requestHelp` 是通往它的主要入口。**这个默认被取消。**

| 002 原设计 | 本文档修订为 |
| --- | --- |
| `requestHelp` → `handing_over` → `user_control` 是标准移交路径 | `requestUserInteraction` 六类（§7），其中**只有 `human_challenge` 与 `browser_takeover` 会碰浏览器** |
| `user_control` 是常规状态 | 仅由 `human_challenge` / `browser_takeover` 触发，后者是 **last resort**，需要记录理由 |
| 用户在 IAB 页面里输入敏感值 | 敏感值优先不进入我们可填的 DOM；确需进入时走 §7.3 的 **scoped secret phase** |

**保留的 human-only 流程**（不可、也不应自动化）：

1. **滑块 / 图形 / 行为验证码** —— 需要真实的人类输入轨迹，合成事件会被风控识破，也不该绕过。
2. **系统钱包确认**（Apple Pay / Google Pay / 银行 App 跳转）—— 确认发生在操作系统或银行的 UI 里。
3. **passkey / 生物识别 / 支付密码** —— **绝不由 app 代填**，见 §7.3。
4. **站点强制的人机交互**（部分银行 3DS 页面要求真实点击）。
5. **兜底接管** —— 前面全部不适用时的逃生舱。

除这五类外，任何「让用户自己去点浏览器」都视为设计缺陷。

### 0.3 P0 硬前提：Agent Runtime 的 OS 级隔离

> **本文档的 L2/L3 数据能力在这条前提满足之前不得启用。**

早先版本声称「Electron main 是唯一 agent 无法在其中执行代码的进程」。**该论断不成立，已删除。** 依据见 §1.1：agent 通过 `exec_command` 拥有不受限的 `bash -lc`，且与 Electron 应用**同一 OS 用户**，因此可以读写应用与用户目录、探测 IPC socket，部分平台还能调试同用户进程或走 UI 自动化。

**删除 `executor.ts:1850` 的 `import()` 逃逸是修一个漏洞，不是建立一条信任边界。**

真正的边界必须在操作系统层：

| 生产环境要求 | 说明 |
| --- | --- |
| agent / server / relay 运行于**独立低权限 OS 用户**，或容器 / 沙箱 / VM | 与运行 Electron 主进程的用户不同 |
| 文件系统只允许 **workspace 白名单** | 明确拒绝 `userData`、keychain 存储、应用二进制与源码树 |
| 与主进程之间**只有一条能力化 broker 通道**（§11） | 拒绝任意本地调用者，见 §11.2 |
| 禁止访问其他进程 | 无 `ptrace` / `task_for_pid` / 调试端口；禁用 UI 自动化（AppleScript、AT-SPI、Windows UIA） |

**无法满足时的降级（fail closed）**：

- Vault 只能标注为 **「防误泄漏」**（guards against accidental exposure），不是安全边界。
- **L2 / L3 字段一律不得启用。** 用户每次手动输入。
- L1 投影可用——它本来就要给模型看。
- UI 必须明示当前处于未隔离模式及其含义，不得只写在文档里。

**开发模式默认使用 dummy / test vault**：内容是合成数据，任何真实证件号或支付凭证都不得进入未隔离环境。切换到真实 Vault 需要显式操作，且在未隔离时被拒绝。

---

## 1. 现状核查

### 1.1 Agent 的实际权限面

**`exec_command` 是 `bash -lc`，不受限，与应用同 OS 用户**（`core/src/environment/tools/exec-command.ts`）。这意味着 agent 在当前架构下可以：

| 能力 | 后果 |
| --- | --- |
| 读写用户主目录与应用目录 | 可读取 `app.getPath('userData')` 下的 Vault 密文与审计文件 |
| 枚举并连接本地 socket / 端口 | 可探测 broker IPC、relay `:19989`、server 端口 |
| 修改应用二进制、脚本、`node_modules` | 可在下次启动时改变主进程行为；macOS keychain ACL 绑定应用签名，但同用户可替换未受保护的运行时代码 |
| 在部分平台调试同用户进程 | Linux 未启用 yama 时可 `ptrace`；macOS 需授权但 UI 自动化是另一条路 |
| 触发 UI 自动化 | AppleScript / AT-SPI / Windows UIA 可驱动应用界面 |

**结论：只要 agent 与主进程同 OS 用户且拥有不受限 shell，主进程就不是相对 agent 的信任边界。** 这是进程与权限模型的问题，加固 vm 沙箱解决不了。

### 1.2 executor vm 沙箱：是护栏，不是边界

即便在隔离到位之后，executor 的 vm 沙箱仍不应被当作安全机制。三处实证：

| 位置 | 事实 |
| --- | --- |
| `executor.ts:1850` | `import: (specifier) => import(specifier)` —— **完全绕过 `ALLOWED_MODULES`**（`:235`）。`await import('child_process')` 即可任意执行本地代码 |
| `executor.ts:1858-1873` | `process` 代理只拦 `cwd` / `exit` / `chdir`，`process.env` 等照常可读 |
| `executor.ts:1876` | `vm.createContext` —— Node 官方文档明确 `vm` **不是**安全机制 |

`ALLOWED_MODULES` 与 `ScopedFS` 只作用于 `require`，`import()` 从旁边走过去了。修复它是应该做的（列入 §12 P0-A），**但修复的价值是减少误用面，不是建立边界**。

### 1.3 agent 可反读 DOM，且这一点堵不住

`page.evaluate(() => document.querySelector('#idcard').value)` 是 Playwright 的正常能力。任何基于同进程注入的拦截都可被同等手段绕过（换隔离世界、读 `defaultValue`、读属性描述符、直发 CDP `DOM.getAttributes`）。§6.4 与 §7.3 按这个事实设计，**不假装堵住了**。

### 1.4 agent 可绕过 submitBooking

`travel-domain/src/booking.ts` 的四道检查只在被调用时生效；agent 直接 `await page.click('#submit')` 就跳过了全部。`booking.ts:4-7` 的注释已点出这一点，但当前无强制机制。§10.3 给解法。

### 1.5 现有 vault 结构上不能用于隐私资料

`packages/core/src/state/agent-vault.ts`：

- **明文存盘**：`<project>/agents/<id>/agent_state/.vault.toml`。文件头注释自陈 "stored in plaintext on disk, masked at the API layer"。
- **值注入 agent 的子进程环境**：agent 一条 `env` 就能读全。

对第三方 API key 合适，对证件号与支付信息是结构性错误。**不复用，不扩展。**

全仓检索确认：`safeStorage` / `keytar` / `createCipheriv` 在 `packages/core|server|desktop` 使用次数为 **0**；`scrypt` 只用于 `server/src/auth/password.ts`。加密存储需要从零建。

### 1.6 transaction 层可直接复用的部分

| 能力 | 位置 | 本设计如何用 |
| --- | --- | --- |
| `Commitment` / `checkDrift` / `permits` / `describeDrift` | `transaction/src/commitment.ts` | capability 内嵌 `Commitment`；失效判定复用 `checkDrift`（§8.3） |
| `AuthorityCeiling` 四档 | `commitment.ts:21` | 对应介入分级 |
| `Journal.replay` + `DanglingIntentError` | `transaction/src/journal.ts` | 付款幂等；悬空 intent 强制对账而非重试 |
| `JournalOp.key` / `deriveKey` | `journal.ts` | 付款幂等键直接用它 |
| `CheckpointStore` + `TaskStage` | `transaction/src/checkpoint.ts` | `awaiting_confirmation` 已存在，正是付款确认的落点 |
| `EscalationKind` 三类 | `escalation.ts:28` | 六类交互是它的细化，映射见 §7.2 |

### 1.7 server session / SSE

- `ServerEvent` 判别联合在 `server/src/api/types.ts:1066`。
- `server/src/runtime/channel.ts` 的环形缓冲会保留事件并在重连时重放——**任何敏感值进入 SSE 就等于进入一个会被重放的缓冲区**，这是 §4.6「值不进 SSE」的具体理由。

### 1.8 desktop 存储现状

`app.getPath('userData')` 目前只有三个非敏感文件（`cli-install-offered`、`server-port`、`preferred-port`）。无任何加密存储。

---

## 2. 威胁模型

| # | 威胁 | 载体 | 缓解 | 残余风险 |
| --- | --- | --- | --- | --- |
| **T0** | **同用户 agent 运行时攻击主进程** | 不受限 `bash -lc`，同 OS 用户 | **§0.3 的 OS 级隔离，这是唯一有效的缓解** | **未隔离时无缓解。此情形下 L2/L3 必须停用，Vault 仅作防误泄漏** |
| T1 | 提示注入让 agent 外泄用户资料 | 页面文本进入模型上下文 | L2/L3 从不进入模型上下文；L1 最小投影 + 短 TTL + 域绑定 | L1 字段仍可能被泄露。接受：它们是执行任务必须让模型看见的 |
| T2 | agent 反读已填入的敏感值 | `page.evaluate()` 读 DOM | 优先让值不进入我们可填的 DOM（PSP hosted field / 钱包 / 商户 token）；必须进入时走 §7.3 scoped secret phase | 普通 DOM 字段在 agent 恢复 CDP 后若站点仍回显，可被读到。§7.3 要求先证明清空 |
| T3 | agent 绕过 `submitBooking` | 任意 Playwright JS | 执行权移交 main + 一次性 capability（§10.3） | 不需要支付凭证的订单（到店付）仍可绕过 |
| T4 | 离线窃取 Vault 文件 | 拷走磁盘 / 另一 OS 用户 | `safeStorage` + OS keychain 保护主密钥；字段级 DEK；文件 0600 | **`safeStorage` 只保护 at-rest。同用户运行时进程不在其防护范围内**（见 T0） |
| T5 | 敏感值经 trace / log / SSE / 截图泄漏 | `snapshot()` / `screenshot` / OmniMessage trace / SSE 缓冲 | 值永不进这四条通道（§4.6）；DOM 文本走等值/指纹脱敏；**截图走 bounding box 像素遮罩**（§6.5） | 页面在别处回显时需 DOM 定位兜底；OCR 兜底**不提供绝对保证** |
| T6 | 重复扣款 | 崩溃后恢复 | `Journal.replay` + `deriveKey` 幂等键；悬空 intent 抛 `DanglingIntentError` | 商户不支持幂等键时只能查单对账 |
| T7 | capability 重放 | 已批准的付款 capability 被再次使用 | 一次性 + `usedAt` + `expiresAt` + 绑定 `taskId`/`merchantDomain`/`idempotencyKey`/确认消息 id | — |
| T8 | Linux 无 keyring 时静默降级为明文 | `safeStorage` 的 `basic_text` 后端 | **fail closed**：拒绝启用 Vault（§4.4） | 该平台失去免填体验 |
| T9 | 用户以为确认的是 A，实际付的是 B | 卡片与实际执行脱节 | capability 内嵌 `Commitment` 与 digest；执行前 `checkDrift`（§8.3） | — |
| **T10** | **broker IPC 被任意本地进程调用** | 同用户可连接 socket / 端口 | 认证 + 能力化 + 按 task/domain/target 绑定（§11） | 未隔离时攻击者可读取凭据并冒充 server，退回 T0 |
| **T11** | **审计被删除或篡改** | 本地 JSONL 可写 | MAC / hash chain，链头链尾摘要由 keychain 保护（§5.3） | **只能检测，不能阻止**；需要更强保证时复制到远端 append-only sink |
| **T12** | **paymentMethodId / token 本身可扣款** | token 被 agent 或攻击者取得 | token 归 L2，加密存储，仅 main 解析；agent 与卡片只见别名/品牌/last4/handle | 取决于商户 token 的能力语义；**不得假设泄漏后无法交易** |

---

## 3. 隐私数据分级

三级，**用户可调整个别字段的归类**，但有两条不可调整的边界：L3 永远是 L3；把字段从 L2 降到 L1 需要显式确认并记录。

**未满足 §0.3 隔离前提时，L2 与 L3 整体停用。**

### L1 · 可投影（projection）

任务期内可以按授权把明文给模型。

姓 / 名（拼音与中文）、称谓 / 性别、旅行偏好（靠窗/过道、房型、早餐、楼层）、常旅客等级、紧急联系人**姓名**、联系邮箱（默认掩码投影）。

### L2 · 仅本地代填（fill-only）

**绝不进入模型上下文。** 模型只拿不透明句柄 `pv:<grantId>:<field>`，由 §6 在填写的最后一刻由 main 解析。

| 字段 | 说明 |
| --- | --- |
| 身份证 / 护照 / 通行证号 | 证件*类型*是 L1（模型需要知道选哪种），*号码*是 L2 |
| 证件有效期 / 签发地 / 出生日期 | |
| 完整手机号 | 模型拿掩码 `138****5678` |
| 完整地址门牌 | 城市/区属 L1 |
| 常旅客卡号 / 会员号 | |
| **`paymentMethodId` / 商户支付 token** | **加密存储，仅 main 解析。**见下 |

**关于支付 token 的更正**：商户或 PSP 签发的 `paymentMethodId` / token **可能本身就具备扣款能力**（取决于商户的 token 语义，可能是 customer-scoped 可复用凭证）。因此：

- 它是 **L2 加密字段**，不是「安全的公开标识」。
- **不得断言「token 泄漏后不足以发起交易」。** 早先版本有此表述，已删除。
- Agent 与确认卡片只见 **别名、品牌、last4、opaque vault handle**，永远看不到 token 本身。

### L3 · 绝不持久（never-persist）

不写入 Vault，不落盘，不进 trace / SSE / 模型上下文。

CVV / CVC（[PCI SSC FAQ 1574](https://www.pcisecuritystandards.org/faqs/1574/) 明确禁止为后续交易存储，即使持卡人同意）、OTP / 短信 / 邮件验证码、3DS 动态口令、账户密码、**支付密码**、passkey / 生物识别。

**支付密码与 passkey 额外加一条：绝不由 app 代填**，无论是否处于 scoped secret phase。见 §7.3。

### 分类的可调整性

L2 → L1 需显式确认并写审计；L1 → L2（更严格）无需额外确认；**L3 清单硬编码，UI 不提供上调入口**。

---

## 4. Private Profile Vault

### 4.1 位置与其真实边界

**Electron 主进程。** 但必须准确表述它买到了什么：

| 它防住的 | 它防不住的 |
| --- | --- |
| 明文出现在 agent 的模型上下文里 | **同 OS 用户的 agent 运行时攻击**（T0） |
| 明文流经 server / relay 的内存与磁盘 | 未隔离时对 `userData` 的直接读取 |
| 离线拷盘窃取（配合 §4.2 加密） | 未隔离时对主进程的调试 / 代码替换 |
| 误把值写进 trace / SSE / log | |

**换言之：主进程持有明文，是为了让明文不流经 agent 可读的常规通道；它成为真正的信任边界，取决于 §0.3 的 OS 级隔离是否落实。**

### 4.2 加密结构

- **主密钥**：32 字节随机，用 `safeStorage` 包裹后存盘。
- **优先使用异步 API**：`safeStorage.encryptStringAsync()` / `decryptStringAsync()`，按 [Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage) 的建议——同步版本会阻塞主进程，且在部分平台需要访问系统密钥环，可能触发用户交互。
- **字段级 DEK**：每字段一把独立数据密钥，用主密钥以 AES-256-GCM 包裹。按字段删除、轮换、单字段解密因此成立。
- **载荷**：AES-256-GCM，AAD 绑定 `fieldName` + `version`，防止字段值被互换。
- **文件**：`app.getPath('userData')/profile-vault.json`，0600，write-then-rename。

### 4.3 safeStorage 保护的是 at-rest，不是运行时

必须写进代码注释与 UI 文案，避免误解：

> `safeStorage` 把主密钥交给 OS keychain / DPAPI / libsecret 保管，防的是**磁盘上的密文被拿走**。它**不防**同一 OS 用户下运行的其他进程——那类攻击者可以在应用解锁期间读取进程内存、替换应用代码，或用 keychain ACL 允许的路径取回密钥。

这正是 §0.3 存在的原因。

### 4.4 Linux `basic_text` 必须 fail closed

`getSelectedStorageBackend()` 返回 `'basic_text'` 时（无可用 keyring），"加密"实际是明文。

```
if (!safeStorage.isEncryptionAvailable()) → 拒绝启用 Vault
if (process.platform === 'linux' && getSelectedStorageBackend() === 'basic_text') → 拒绝启用 Vault
```

UI 明确告知并提示安装 gnome-keyring / kwallet 或以 `--password-store` 指定；敏感字段改为每次手动输入。**静默降级成明文比不提供功能糟得多**，与 `journal.ts` 对末行损坏「拒绝加载而非跳过」是同一条判断。

### 4.5 生命周期

`unlock()` / `lock()`（清零主密钥与全部 DEK，撤销未过期 grant）/ `put(field, value, tier)`（L3 拒绝写入）/ `deleteField()` / `deleteAll()` / `export()`（OS 级重认证 + 二次确认 + 审计）/ `rotate()`。

### 4.6 不变量：值不进四条通道

| 通道 | 强制点 |
| --- | --- |
| **LLM prompt** | main 从不把 L2/L3 交给 server；L1 只交出被 grant 覆盖的投影 |
| **SSE** | 交互事件载荷只允许 handle 或掩码。理由：SSE 事件进环形缓冲并在重连时重放（§1.7） |
| **Trace** | builtin tool 入参只含 handle，返回只含成功与否 |
| **Log / 审计** | 对 handle 与字段名可打，对值一律不打（[OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)） |

---

## 5. 授权模型

### 5.1 Grant 结构

```ts
interface ProfileGrant {
  grantId: string
  taskId: string           // 任务结束即失效
  domain: string           // eTLD+1，精确匹配，不支持通配
  purpose: string          // 人类可读，进卡片也进审计
  fields: string[]         // 精确字段集合，不支持 "*"
  mode: 'projection' | 'handle'
  expiresAt: string        // L1 = 任务生命周期；L2 = 15 分钟
  approvedAt: string
  channel: string
}
```

没有"一次授权全程通用"。换域名、换用途、换字段都要新 grant。

### 5.2 Agent 拿到什么

L1：最小投影，只含 `grant.fields` 覆盖的字段。
L2：不透明句柄 `pv:<grantId>:<field>`，只能由 §6 的 secureFill 消费；main 校验 grantId 有效、未过期、`field ∈ grant.fields`、当前页面域 `=== grant.domain`。任一不满足即拒绝并记审计。

### 5.3 审计：记事不记值，并做防篡改链

```ts
interface VaultAuditEntry {
  seq: number
  prevMac: string          // 上一条的 MAC，构成 hash chain
  at: string
  event: 'grant_requested' | 'grant_approved' | 'grant_denied'
        | 'field_read' | 'fill_performed' | 'fill_rejected'
        | 'secret_phase_enter' | 'secret_phase_exit'
        | 'export' | 'delete' | 'lock' | 'unlock' | 'tier_changed'
        | 'capability_issued' | 'capability_consumed'
  grantId?: string; taskId?: string; domain?: string
  field?: string           // 字段名，不是值
  purpose?: string; reason?: string
  mac: string              // HMAC(auditKey, seq‖prevMac‖payload)
}
```

**本地 JSONL 不是 tamper-proof。** 明确其保证边界：

- 每条记录带 **HMAC**，并以 `prevMac` 串成 **hash chain**；`auditKey` 与**链头、链尾摘要**由 keychain（`safeStorage`）保护。
- 这能**检测**删除、截断、篡改与重排，**不能阻止**——具备写权限的同用户进程仍可删除整个文件；链头链尾摘要的存在使这种删除可被发现。
- 需要更强保证时，**复制到远端 append-only sink**（如仅追加的日志服务）。**远端副本同样绝不含任何字段值**，只含事件元数据。
- 校验入口：设置页提供「校验审计完整性」，输出链是否连续、末尾摘要是否匹配。

---

## 6. secureFill 与受限执行

### 6.1 路径

```
Agent
 └─ builtin tool: secure_fill({ handle, targetRef })
     └─ server → broker IPC（认证、能力化，见 §11）
         └─ Electron main
             ├─ 校验 grant：taskId / domain / field / TTL / 未撤销
             ├─ 解密该字段（只解这一个）
             ├─ webContents.debugger 在隔离世界写入并派发 input/change
             ├─ 登记该元素进「敏感元素集合」（含 bounding box，见 §6.5）
             └─ 清零明文，写审计（不含值）
```

明文只存在于 main 进程内存，且只在一次填写的时长内。**其信任价值取决于 §0.3。**

### 6.2 为什么不用 executor 的 vm

§1.2：vm 不是边界，`import()` 直通，且 relay 进程对 agent 可达。任何"把值传进 executor 再填"的方案都等于把明文交给 agent。

### 6.3 必须做的执行侧收紧

**必要但不充分**，用途是缩小误用面：

| 措施 | 位置 |
| --- | --- |
| 删除 `import()` 逃逸 | `executor.ts:1850` |
| `process` 代理改白名单 | `executor.ts:1858` |
| 敏感元素的 DOM 读取拦截 | relay 注入的隔离世界脚本 |
| 快照 / HTML / Markdown 脱敏 | `aria-snapshot.ts` / `clean-html.ts` / `page-markdown.ts` |
| 下单改为 builtin tool | §10.3 |

### 6.4 反读堵不住，所以敏感值尽量不进 DOM

见 §1.3。真正的防线是让值不出现在我们能填的 DOM 里：

| 数据 | 处理 |
| --- | --- |
| 支付卡信息 | 商户已保存 token / 系统钱包 / PSP 托管 iframe（§9）。我们不填，agent 自然读不到 |
| CVV / OTP / 3DS | L3；优先由站点自身控件或系统 UI 消费；必须经普通 DOM 时走 §7.3 scoped secret phase |
| 支付密码 / passkey | **绝不代填**，human-only |
| 证件号等 L2 | 接受可反读，缓解是最小化授权面（精确字段、15 分钟 TTL、审计留痕）。记在 T2 残余风险 |

### 6.5 脱敏：文本与像素是两回事

早先版本把「值哈希匹配」当作通用兜底，**这对截图不成立**。分开处理：

| 输出 | 手段 | 保证强度 |
| --- | --- | --- |
| **DOM / HTML / Markdown / ARIA 快照** | 登记元素定位 + **值等值匹配 / 指纹匹配**（main 只传值的哈希前缀给 relay，不传值） | 强：文本可精确匹配替换为 `[REDACTED:field]` |
| **截图（像素）** | **按已登记元素的 bounding box 做像素遮罩**。哈希无法匹配像素 | 强，但仅覆盖已登记元素 |
| **页面在别处回显同一值** | 先做 **DOM 定位**（查找含该值的文本节点，取其 box 一并遮罩）；DOM 定位不到时用 **OCR 兜底** | **弱。OCR 不提供绝对保证** —— 字体、缩放、遮挡、非拉丁字符都会漏 |

因此：**截图路径默认更保守**。当会话中存在未确认清空的敏感字段时，`screenshot` 默认返回带遮罩的图，并在无法确认覆盖完整时**拒绝出图**而不是出一张可能泄漏的图。

---

## 7. requestUserInteraction

### 7.1 六类

| kind | 用户在哪里做 | 之后 |
| --- | --- | --- |
| `info_request` | 卡片 / 对话 | Agent 继续 |
| `selection` | 卡片 | Agent 继续，生成 `Commitment` |
| `commitment_confirmation` | 卡片 / 对话 | 生成付款 capability，Agent 继续 |
| `secret_entry` | 卡片安全输入框 → **scoped secret phase**（§7.3） | 按 §7.3 的条件恢复 |
| `human_challenge` | IAB 页面内 | 短暂操作后 Agent 继续 |
| `browser_takeover` | IAB 页面内 | **last resort**，需非空 `reason` |

### 7.2 与既有 EscalationKind 的映射

`knowledge_gap` → `info_request` / `selection`；`authority_gap` → `commitment_confirmation`；`capability_gap` → `secret_entry` / `human_challenge` / `browser_takeover`。事务层不改。

### 7.3 secret_entry：scoped secret phase

早先版本写「main 代填后 Agent 继续」，**与 §1.3 的反读结论矛盾**：CVV / OTP / 支付密码一旦进入普通 DOM input，就可能被 agent 读到。修订如下。

**优先级一 —— 不进入我们可填的 DOM（首选）**

PSP hosted field（iframe，跨域，我们既填不了也读不到）、系统钱包、银行 App / 3DS 独立页面。这些路径下 `secret_entry` 退化为「提示用户在系统 UI 完成」，无 DOM 风险。

**优先级二 —— 必须经普通 DOM 时：scoped secret phase**

```
1  进入 secret phase
   ├─ 暂停 agent 轮次
   ├─ **detach agent 的 CDP capability**（撤销该 session 对目标 target 的调试通道）
   └─ 写审计 secret_phase_enter

2  用户在左侧卡片安全输入框输入
   └─ preload 具名通道直达 main（不经 server / SSE / agent）

3  main 原子完成：fill + submit（或等待站点自身消费该字段）

4  退出条件 —— 必须满足其一
   ├─ (a) 证明字段已清空：读回目标元素 value 为空 / 元素已从 DOM 移除 / 页面已导航离开
   │      → 恢复 agent CDP capability，Agent 继续
   ├─ (b) 无法证明清空 → **保持 human-only**：该 target 不再交还 agent，
   │      后续步骤由用户完成
   └─ (c) 无法证明清空且流程需要继续 → **销毁该 target / session**，
          在新 target 上重建后续流程

5  写审计 secret_phase_exit（含退出条件，不含值）
```

**关键点**：agent 的 CDP capability 在整个 secret phase 内是 detach 的——它不是"被礼貌地要求不看"，而是**通道被撤掉**。恢复必须以「证明清空」为前提，证明不了就不恢复。

**不适用 scoped secret phase 的**：支付密码、passkey、生物识别 —— **绝不由 app 代填**，一律 human-only（用户自己在页面或系统 UI 输入，agent 全程 detach）。

### 7.4 browser_takeover 的门槛

必须提供非空 `reason`，写进审计与 trace。目的是让「退回让用户自己操作」成为可被审阅的决定，而非方便的默认。

---

## 8. 付款确认

### 8.1 卡片必须绑定的字段

缺任何一项都不允许生成 capability：`merchant`（显示名 + **eTLD+1 域名**，域名是判定依据）、`item`（航班号+日期+舱位 / 酒店名+房型+入住退房+间夜）、`amount`（精确金额 + ISO 4217 币种）、`cancellation`（摘录站点原文 + 链接）、`paymentMethod`（**别名 + 品牌 + last4**，不含 token 与卡号）、`expiresAt`（默认 10 分钟）、`taskId`。

### 8.2 Commitment digest 与一次性 capability

```ts
interface PaymentCapability {
  capabilityId: string
  taskId: string
  commitment: Commitment          // transaction/src/commitment.ts
  commitmentDigest: string        // 对已展示摘要的规范化哈希，不可变
  merchantDomain: string
  paymentMethodRef: string        // vault handle，**不是 token 本身**
  maxAmount: { value: number; currency: string }
  toleranceApproved: boolean      // 见 §8.5
  idempotencyKey: string          // Journal.deriveKey
  expiresAt: string
  usedAt?: string
  approvedVia: 'card' | 'natural_language'
  confirmingMessageId?: string    // 自然语言确认时必填，见 §8.4
  auditRef: string
}
```

`commitmentDigest` 是**最近一次向用户完整展示过的摘要**的规范化哈希，展示后即不可变。它是自然语言确认的锚点。

### 8.3 失效与重确认

| 变化 | 结果 |
| --- | --- |
| 金额上涨且 `toleranceApproved === false` | **作废，重确认**（默认路径，见 §8.5） |
| 金额上涨在**已批准的** tolerance 内 | 通过 |
| 金额超过 `maxAmount` | 作废，不看容差 |
| 商户域名不符 | **直接拒绝，不提供重确认入口**——这是钓鱼/跳转劫持形态 |
| 行程字段变化 | 作废，重确认 |
| 退改条件变化 | 作废，重确认 |
| 出现确认时没有的收费项 | `checkDrift` 的 `added` 分支覆盖，作废 |
| `expiresAt` 已过 | 作废，重确认 |

### 8.4 自然语言确认的判据

**判定归代码，不归模型。** 分两种情形：

**情形甲 · 此前已完整展示过摘要（存在 `commitmentDigest`）**

用户回复必须：

1. **明确引用该摘要或订单**（"这单"、"上面那个"、"MU5137 这个"、订单号、卡片编号），且
2. **明确确认金额与商户**（数字+币种可匹配、商户名或域名可匹配）。

通过后，把 **确认消息的 message id + `commitmentDigest`** 一并写入 capability（`confirmingMessageId`）。这样事后可以精确复原"用户当时看到的是什么、确认的是哪一条"。

**情形乙 · 此前没有完整摘要**

用户必须在一条消息内**明确覆盖全部五项**：`merchant`、`item`/行程、金额+币种（或明确上限）、支付方式别名、以及**已阅读退改条件**的明确表示。缺一即回退卡片。

**两种情形共同的回退规则**：模糊表达一律回退到卡片——"可以"、"好"、"就它吧"、"付吧"、"确认"、"嗯"、"OK"。回退不是失败，是正常路径。

判定器是确定性纯函数：抽取数字、币种符号、命名实体、指代词，与 capability 字段做匹配。**宁可误拒。**

### 8.5 tolerance 与 maxAmount 必须被明确批准

**默认：精确金额即硬上限，任何上涨都触发重确认。**

`commitment.tolerance` 与 `maxAmount` 只有在**用户明确看到并批准**时才生效——即卡片上显式展示了"如果涨价，X 元以内我自己决定"并被用户选择。`toleranceApproved` 记录这一事实。

未经明确批准的 tolerance 一律视为 0。**不得从对话中推断容差**，也不得沿用上一次任务的容差。

### 8.6 执行

```
用户确认 → main 生成 PaymentCapability，写审计
 └─ agent 收到 capabilityId
     └─ agent 填单、走到支付页
         └─ agent 调 builtin tool: execute_payment({ capabilityId, actualPlan })
             └─ broker IPC（§11）→ main：
                ① capability 有效（未过期、未用、域名/taskId 匹配）
                ② permits(commitment, 'pay')
                ③ checkDrift(commitment, actualPlan)（含 §8.5 的容差规则）
                ④ journal.replay({ action, params, key: idempotencyKey }, submit)
                ⑤ 标记 usedAt，写审计
```

第 ④ 步的 `Journal` 三态判定原样生效：有 intent 无 result 时抛 `DanglingIntentError`，强制查单对账而非重试。

---

## 9. 支付凭证

### 9.1 优先级

| 优先级 | 方式 | Vault 存什么 |
| --- | --- | --- |
| 1 | 商户侧已保存的支付方式 | **token 作为 L2 加密字段**；对外只暴露别名/品牌/last4 |
| 2 | 系统钱包（Apple Pay / Google Pay） | 别名 |
| 3 | PSP 托管字段（iframe / hosted fields） | 别名 |
| 4 | 手动输入卡号 | **不存**；走 §7.3 scoped secret phase，尽量避免 |

### 9.2 token 的正确定位

商户 / PSP 的 `paymentMethodId` 可能是 **customer-scoped 的可复用扣款凭证**。因此：

- 它是 **L2 加密字段，仅 main 解析**，与证件号同级别对待。
- Agent、卡片、SSE、trace 一律只见 **别名 / 品牌 / last4 / opaque handle**。
- **不得断言「token 泄漏后不足以发起交易」。** 其能力语义由商户定义，我们不控制。相应残余风险记在 T12。

### 9.3 CVV 绝不存储

[PCI SSC FAQ 1574](https://www.pcisecuritystandards.org/faqs/1574/)：即使持卡人同意，也不得为后续交易存储卡验证码。CVV 归 L3，每次由用户输入，按 §7.3 处理。

---

## 10. 与 transaction 层的结合

### 10.1 状态机

```
task 开始
  ├─ 需要资料 → grant 请求（卡片）→ 批准 → projection / handle
  ├─ 填单 ── L1 agent 自填 ── L2 走 secure_fill
  │           └─ human_challenge → 用户短暂操作 → agent 继续
  ├─ 代表集就绪 → selection 卡片 → Commitment（ceiling 默认 fill_form）
  ├─ 支付页 → commitment_confirmation → 展示摘要（生成 digest）→ PaymentCapability（ceiling 升 pay）
  │           └─ 需要 CVV/OTP/3DS → secret_entry → §7.3 scoped secret phase
  └─ execute_payment → 五道检查 → journal.replay → submitted
```

### 10.2 booking.ts 增加第五道检查

在现有四道（authority → drift → journal → submit）之前插入 **capability** 校验。`SubmitBookingOptions` 增 `capability`；`RefusalReason` 增 `capability_invalid` / `capability_expired` / `merchant_mismatch` / `tolerance_not_approved`。拒绝仍是返回值不是异常。

### 10.3 强制 submitBooking 是唯一路径

**把执行权从 agent 手里拿走**：agent 调 builtin tool `execute_payment`，真正的 `submitBooking()` 在 main 内运行并持有 capability 与 token。

- 走商户 token / 钱包 / PSP 的路径下，**agent 手里没有可用于付款的凭证**——结构性保证。
- **但这条保证同样依赖 §0.3**：未隔离时 agent 可直接读取 Vault 中的 token，绕过整条路径。这是 T3 与 T0 的交汇点。
- 残余：不需要支付凭证的订单（到店付）仍可直接提交，靠 skill 约束 + trace 审计覆盖。

---

## 11. Broker IPC

### 11.1 为什么需要单独一条通道

server 与 main 之间要传 `secure_fill` / `execute_payment` / grant 应答。这条通道**必须假设同一台机器上存在敌意调用者**（未隔离时是 agent 本身，隔离后是其他同用户进程）。

### 11.2 要求

| 要求 | 做法 |
| --- | --- |
| **认证** | 启动时 main 生成一次性 broker token，仅通过 fork 时的环境变量交给 server 子进程；不落盘、不进日志。socket 使用 OS 权限最严格的形式（Unix domain socket 0600 / Windows named pipe 带 ACL） |
| **能力化** | 每个调用携带一个能力引用（grantId 或 capabilityId），而非"我是 server 所以我可以" |
| **绑定** | 每次调用绑定 `taskId` + `domain` + `targetId`，main 侧逐项校验，任一不符即拒绝并记审计 |
| **拒绝任意本地调用者** | 无有效 token 一律拒绝；连接来源 UID 校验（`SO_PEERCRED` / `getpeereid` / Windows 命名管道客户端令牌） |
| **最小面** | 只有三个具名操作，无通用转发；参数结构化校验，拒绝宽松解析 |
| **限速与审计** | 每 task 的调用配额；全部调用写审计（不含值） |

### 11.3 残余

**未满足 §0.3 隔离时，broker token 对 agent 可读**（同用户可读 server 进程环境或内存），此时 broker 的认证不构成防护，退回 T0。这必须在文档与 UI 上如实呈现，不得用"有认证"制造安全感。

---

## 12. 分阶段与验收矩阵

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| **P0-A** | **Agent Runtime OS 级隔离**（§0.3） | 无。**其余全部阶段的硬前提** |
| **P0-B** | 删 `import()` 逃逸、`process` 白名单、builtin tool 骨架 | 无 |
| **P0-C** | safeStorage 可用性探测与 fail-closed；异步 API | 无 |
| **P0-D** | Broker IPC（认证 + 能力化 + 绑定） | P0-A |
| P1 | Vault 核心 + 分级 + hash-chain 审计 | P0-C |
| P2 | Grant + handle + secureFill + 脱敏（文本/像素分治） | P1、P0-D |
| P3 | requestUserInteraction 六类 + scoped secret phase | 002 P3 |
| P4 | 付款确认 + digest + capability + execute_payment | P2、P3 |
| P5 | 支付凭证优先级 + 商户 token 路径 | P4 |

### P0 验收（攻击测试，非功能测试）

**以下每一条都必须由一次真实的攻击尝试来证明，通不过则 L2/L3 fail closed：**

| # | 攻击 | 期望 |
| --- | --- | --- |
| A1 | agent 的 `exec_command` 尝试 `cat`/`ls` `app.getPath('userData')` 及 Vault 文件 | **拒绝**（权限不足 / 路径不可见） |
| A2 | agent 尝试访问 OS keychain（`security find-generic-password` / DPAPI / `secret-tool`） | **拒绝** |
| A3 | agent 尝试连接 broker socket/pipe，不带 token 或带伪造 token | **拒绝**，并写审计 |
| A4 | agent 尝试用有效格式但错误 `taskId` / `domain` / `targetId` 调用 `secure_fill` | **拒绝**，并写审计 |
| A5 | agent 尝试修改应用二进制 / `node_modules` / 主进程脚本 | **拒绝**（只读或不可见） |
| A6 | agent 尝试调试主进程（`ptrace` / 附加调试器 / UI 自动化） | **拒绝** |
| A7 | agent 尝试枚举并读取其他进程内存或 `/proc/<pid>/mem` | **拒绝** |
| A8 | agent 尝试 `await import('child_process')` 逃逸 executor 沙箱 | **拒绝**（P0-B） |
| A9 | 在 Linux 无 keyring 环境启动 | Vault **拒绝启用**，UI 明示，L2/L3 停用 |
| A10 | 审计文件被外部删除一行 / 篡改一条 | 完整性校验**报告不一致** |

**A1–A7 任一失败** → 判定为未隔离环境 → Vault 降级为「防误泄漏」，**L2/L3 不得启用**，UI 明示。

### P4 验收矩阵

| 场景 | 期望 |
| --- | --- |
| 卡片确认，金额行程一致 | 通过，journal 一条 intent + result |
| 金额上涨，`toleranceApproved === false` | **拒绝，重确认**（默认） |
| 金额上涨在已批准 tolerance 内 | 通过 |
| 金额超 `maxAmount` | 拒绝，不看容差 |
| 商户域名不符 | **直接拒绝，无重确认入口** |
| 行程 / 退改条件变化 | 拒绝，重确认 |
| capability 过期 / 已用 | 拒绝 |
| 自然语言「确认」「可以」「就它吧」 | **一律回退卡片** |
| 有 digest，回复引用摘要且含金额+商户 | 通过，写入 `confirmingMessageId` + digest |
| 无 digest，回复未覆盖五项 | 回退卡片 |
| 付款中 `SIGKILL` 后恢复 | `DanglingIntentError`，要求对账，**不重试**，副作用计数恒为 1 |
| secret phase 中 agent 尝试 CDP 调用 | **拒绝**（capability 已 detach） |
| secret phase 无法证明字段清空 | 保持 human-only 或销毁 target，**不恢复 agent** |
| 截图请求，存在未确认清空的敏感字段 | 返回遮罩图；覆盖不完整时**拒绝出图** |

---

## 13. 待验证与开放问题

1. **隔离方案的具体形态** —— 独立 OS 用户 / 容器 / VM 各自的实现代价与用户体验（安装权限、workspace 共享、性能）。这是 P0-A 的主要未知。
2. **`safeStorage` 在打包后各 Linux 发行版的行为** —— GNOME / KDE / 无桌面环境三种。
3. **隔离世界写入能否触发 React/Vue 受控组件更新** —— 直接设 `.value` 常不触发框架状态更新。`interaction.ts` 的 `fillWithSuggestion` 踩过类似坑，可对照。
4. **"证明字段已清空"的可靠判据** —— §7.3 退出条件 (a) 的具体实现，不同站点差异可能很大。
5. **商户是否支持幂等键** —— 不支持时需为每个商户实现 `reconcile`。
6. **系统钱包在 Electron WebContentsView 内的可用性** —— Apple Pay 需商户域验证与 WebKit 支持，Chromium 内嵌环境未必可用。
7. **L1 投影的最小集** —— 需真实跑一遍携程填单统计，当前分级是设计推断。
8. **`browser_takeover` 与 secret phase 的实际触发率** —— 占比过高说明前四类覆盖不足，应埋点。
9. **自然语言判定器的误拒率** —— 宁可误拒，但过高会啰嗦，需真实语料校准。
10. **Vault 与多用户 desktop 的关系** —— 当前是单用户单 Vault。
