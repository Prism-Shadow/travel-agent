# 内嵌浏览器(IAB)实现原理

> 用 Mermaid 图讲清楚"应用内浏览器"是怎么工作的。用 VS Code(Mermaid 预览插件)或
> 在 GitHub 上打开本文件即可看到渲染后的图。
>
> 参考:`design/002-codex-style-single-window-iab.md`;代码:`packages/desktop/src/browser-pane.ts`、
> `iab-transport.ts`、`packages/browser-cli/src/cdp-relay.ts`、`executor.ts`。

## 一句话

在 Electron 主窗口右侧嵌一块**真实的 Chromium 网页视图**(`WebContentsView`),让 agent 通过一条
自建的 CDP 中继通道去驱动它——用的是 `webContents.debugger`,而**不开**危险的
`--remote-debugging-port`。

---

## 1. 整体架构(三层进程)

```mermaid
flowchart LR
    subgraph agent["Agent 侧"]
        PW["Playwright / executor<br/>(browser-cli)"]
    end

    subgraph relay["Relay 进程 (cdp-relay.ts)"]
        EP["标准 CDP 端点<br/>(对 agent 呈现)"]
        SYN["target 合成层<br/>+ 归属校验"]
        WS["/iab WebSocket<br/>(iabKey 握手)"]
    end

    subgraph main["Electron 主进程"]
        TR["iab-transport.ts<br/>webContents.debugger 代理"]
        PANE["BrowserPane<br/>自绘 tab / 地址栏 / 生命周期"]
        V1["WebContentsView #1<br/>(ctrip.com)"]
        V2["WebContentsView #2"]
    end

    PW -->|"CDP over WS"| EP
    EP <--> SYN
    SYN <-->|"forwardCDPCommand / forwardCDPEvent"| WS
    WS <-->|"/iab"| TR
    TR -->|"debugger.sendCommand"| V1
    TR -->|"debugger.sendCommand"| V2
    PANE -.->|"new WebContentsView 摆放/管理"| V1
    PANE -.-> V2
```

**要点**:agent 眼里只有一个"标准 CDP 端点";relay 把命令包成 `forwardCDPCommand` 经 `/iab` 通道送进
主进程;主进程用 `webContents.debugger` 对**每一个** view 单独执行。不开 `--remote-debugging-port`,
安全边界就在这。

---

## 2. "打开携程搜酒店"整条时序

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent/executor
    participant R as Relay
    participant M as 主进程
    participant V as WebContentsView

    Note over A,V: ① 开新页(CDP 干不了,走自造命令)
    A->>R: newPage() → Target.createTarget
    R->>M: iab-open-tab (带 sessionId/taskId)
    M->>V: new WebContentsView
    M->>V: attach webContents.debugger
    M-->>R: 返回合成的 targetId
    R-->>A: 新 target 出现(像新页开好了)

    Note over A,V: ② 打开携程(普通页面级命令,原样转发)
    A->>R: page.goto("ctrip.com") → Page.navigate
    R->>M: forwardCDPCommand
    M->>V: debugger: Page.navigate
    V-->>A: 页面加载完成(经事件回传)

    Note over A,V: ③ 填目的地/日期 + 点搜索
    A->>R: fill / click → Input/DOM 命令
    R->>M: forwardCDPCommand
    M->>V: debugger 执行
    V-->>A: 结果 + 快照
```

只有"开新页"这一步不走 CDP,由主进程用 Electron API 造 view;其余全是普通 CDP 命令原样转发。

---

## 3. 为什么 `Target.createTarget` 在 Electron 上要特判

```mermaid
flowchart TB
    CMD["Target.createTarget (开新页)"]
    Q{"浏览器级命令<br/>还是页面级命令?"}
    CMD --> Q
    Q -->|"浏览器级<br/>(要求'整个浏览器'造新 target)"| BROWSER

    subgraph BROWSER["需要'浏览器级'调试端点"]
        direction TB
        WCD["webContents.debugger<br/>只 attach 在**一个页面**上<br/>= 页面级遥控器"]
        NO["够不着 → 报错<br/>Cannot access browser-level commands"]
        WCD --> NO
    end

    NO --> FIX["解决:拆出这一步<br/>iab-open-tab → 主进程 new WebContentsView<br/>再 attach debugger,合成 targetId"]

    subgraph EXT["对照:扩展后端就能接"]
        direction TB
        TABS["chrome.tabs.create<br/>有'建标签'的权力"]
        OK["→ 就地模拟 createTarget"]
        TABS --> OK
    end
```

`webContents.debugger` 是**页面级**遥控器,开不出兄弟页;扩展后端有 `chrome.tabs` 建页权,所以它反而
能接这条命令。

---

## 4. 两个后端对照

```mermaid
flowchart LR
    subgraph iab["IAB 后端(默认)"]
        direction TB
        I1["Electron WebContentsView<br/>persist:travel-iab 独立 profile"]
        I2["webContents.debugger 驱动"]
        I3["开页:iab-open-tab → new WebContentsView"]
    end

    subgraph ext["扩展后端"]
        direction TB
        E1["用户自己的 Chrome<br/>(带真实登录态)"]
        E2["chrome.debugger 驱动"]
        E3["开页:chrome.tabs.create"]
    end

    RELAY["同一个 relay 接口<br/>(target 合成 + 归属)"]
    iab --> RELAY
    ext --> RELAY
    RELAY --> AGENT["Agent 无感知<br/>可按任务切换后端"]
```

两个后端对 relay 呈现**一模一样**的接口,所以可以按任务切换。

---

## 5. 归属与生命周期(把浏览器搬进 app 后必须自己写的策略)

```mermaid
flowchart TB
    OPEN["iab-open-tab / iab-claim-tab"] --> BIND["从**绑定身份**构造<br/>sessionId / taskId / relaySessionId"]
    BIND --> CHECK{"归属校验"}
    CHECK -->|"身份不符 / 缺失"| REJECT["拒绝 + 写审计<br/>(防跨任务/跨会话伪造)"]
    CHECK -->|"通过"| OWN["tab.ownedByTask = 本轮任务<br/>只有它能写这个页面"]

    OWN --> LIFE{"任务结束 / 崩溃?"}
    LIFE -->|"read_only"| CLOSE["关闭 tab"]
    LIFE -->|"committed / failed / unknown"| RETAIN["retain:交还用户<br/>ownedByTask=null"]
    LIFE -->|"渲染进程崩溃"| REBUILD["只重建该 tab<br/>绝不重载主窗口"]

    RETAIN --> USERKEEP["用户手动'保留'优先级最高"]
    REBUILD --> CKPT["checkpoint 只记 URL + 归属<br/>从不记 WebContents(跨不了进程)"]
    CKPT --> RESTORE["重启后按 URL 快照重开"]
```

**要点**:tab 带 `ownedByTask`,只有当前这轮 agent 能写;开页/认领都从绑定身份构造标识、拒绝伪造;
崩溃只重建单个 tab,不动主窗口;checkpoint 只存 URL 与归属,重启按 URL 恢复,用户"保留"标记压倒一切
自动策略。

---

## 三层职责小结

| 进程 | 角色 |
| --- | --- |
| **桌面主进程** | 持有 `WebContentsView`、自绘 chrome、`webContents.debugger` 执行 CDP、管归属/生命周期 |
| **Relay** | 对 agent 呈现标准 CDP 端点,`/iab` 通道转发到主进程;target 合成层 |
| **Agent / executor** | 用 Playwright 经 relay 驱动;`tabs.open()` 特判走 `iab-open-tab` |

**关键取舍**:不开 `--remote-debugging-port`(那会把进程里所有 target 零认证暴露给任意本地进程),
改用 `webContents.debugger` 逐 target 代理——安全边界就在这一条上。
