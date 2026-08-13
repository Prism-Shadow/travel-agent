# travel-agent

把 [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness)（agent 引擎）和 penguin-browser（控制用户自己的 Chrome）粘起来。携程是演示场景，不是产品。

用户说一句话。agent 去搜，把选项空间收到几个带理由的代表，等一次同时等于授权的点击，然后填单，停在支付页。**不做**降价监控、自动改签、抢票，以及任何需要长期驻留的事。

设计见 [design/001-architecture.md](design/001-architecture.md)。

## 现状

本仓是 PenguinHarness `0.2.2`（`d14be6f`）的**硬分叉**。不再 merge 上游。引擎留下，下游身份去掉。

| 里程碑 | 含义 | 状态 |
| --- | --- | --- |
| M0 | 浏览器栈进仓，携程酒店页能开 | 完成 |
| M1 | 人机移交（`requestHelp`） | 完成 |
| M2 | 事务层（WAL / 承诺 / 检查点 / 升级） | 库完成 |
| M3 | 一句话 → 停在支付页 | **未完成** — 表单原语能跑；列表提取和宿主编排没有 |
| M4 | tab 归属 + 跨站方案对齐 | 库完成 |
| M5 | 机票 | 未开始 |

`@travel-agent/domain` 和 `@travel-agent/transaction` 还没接到 agent 循环上。库测过，产品路径没有。

## 目录

| 包 | 职责 |
| --- | --- |
| `packages/core`、`cli`、`server`、`web` | PenguinHarness 引擎和界面（冻结快照） |
| `packages/browser-cli`、`browser-extension` | 并入的 penguin-browser |
| `packages/transaction` | 不可逆动作的语义 |
| `packages/travel-domain` | 代表集、对齐、守卫下单 |
| `packages/skills/skills/penguin-browser` | 教 agent 怎么开 Chrome |

## 开发

需要 Node >= 24、pnpm 11。

```bash
pnpm install && pnpm build
pnpm dev                 # server + web；数据在 ~/.penguin/dev-data
```

开发数据和已安装的 PenguinHarness 用的 `~/.penguin/data` 是分开的。

在加入 `penguin-browser` 之前创建的 `default_agent`，下次加载会补上这个 skill。拉代码后请**开一个新对话**——系统提示在创建 session 时组装。

`penguin-browser` CLI 需要在 `PATH` 上（`pnpm build` 会 link）。skill 正文里写的独立仓库路径已经过时。

## 这不是什么

- 不是携程 / 飞猪客户端。
- 不是准备作为产品回赠给 PenguinHarness 的 fork。
- 不是 PenguinHarness 的签名桌面安装包（那在上游）。
