# 来源与改动记录

本包与 `packages/browser-extension` 并入自独立仓库 **penguin-browser**。

| | |
| --- | --- |
| 源仓库 | `git@github.com:Youhai020616/penguin-browser.git` |
| 源提交 | `ba9e13b` — "Initial Penguin Browser source import" |
| 并入日期 | 2026-08-12 |
| 源仓库后续状态 | 不再维护，改动直接在 travel-agent 进行 |

并入方式是**文件拷贝 + 本记录**，不是 `git subtree`。原因：subtree 的价值在于 `pull` / `push` 回上游，而源仓库不再维护；且 `subtree add` 会把整仓 81M（含 71M vendored Playwright）永久写进 travel-agent 的对象库，即使随后 `git rm` 也无法回收。详见 `design/001-architecture.md` §3。

## 没有带进来的部分

| 源目录 | 体积 | 原因 |
| --- | --- | --- |
| `playwright/` | 71M | 整个 Playwright fork 的源码。已改为从 npm 依赖同版本包，见下节 |
| `website/` | 4.1M | 官网，travel-agent 不需要 |
| `db/` | 128K | 官网后端的 drizzle schema，CLI 不引用（已验证） |
| `public/` `task/` | ~84K | 两张图片和一个任务文件，无引用 |

## 相对源仓库的改动

1. **Playwright 依赖改为 npm 解析**
   `"@xmorse/playwright-core": "workspace:^"` → `"^1.59.10"`

   并入前做过完整比对，vendored 那份与已发布的 `@xmorse/playwright-core@1.59.10` **无功能性差异**：
   - `types/types.d.ts` 仅 3 处差异，全部是注释里的品牌名（"Penguin Browser" vs "Playwriter"）
   - `package.json` 仅差 `scripts` 字段（npm 发布时的标准剥离）
   - `browsers.json`（浏览器版本锁定）完全一致

   验证：typecheck 通过（27 处导入，含该 fork 特有的 `MouseActionEvent` 类型）、build 通过、62 个单元测试通过、CDP relay 正常监听 `127.0.0.1:19989`。

   > 若将来升级 Playwright 需重新确认，比对方法：`npm pack @xmorse/playwright-core@<版本>` 后 diff `types/types.d.ts` 与 `browsers.json`。

2. **`tsconfig.json` 改为自包含**
   原本 `extends: "../tsconfig.base.json"`。travel-agent 的仓库基线是 `Bundler` + `noEmit`（服务于 web/server），与本包需要的 `NodeNext` + `composite` + 真实 emit 不兼容，因此把原基线设置内联进本包的 `tsconfig.json`。

3. **移除了 `"jsx": "react-jsx"`**（上游基线里有）。本包无 `.tsx` 文件，该选项唯一的作用是让 TS 去解析 `react/jsx-runtime`，从而把 `@types/react` 的 DOM 空桩（`interface HTMLElement extends Element {}`）拖进类型图。在 penguin-browser 仓库里这没造成问题，并入 travel-agent 后 `packages/web` 使 `@types/react` 可解析，`aria-snapshot.ts` 里 `element.setAttribute(...)` 立刻编译失败。

   > 注意 `lib` **刻意不含 `"dom"`**，这是上游的设计：`src/test-declarations.ts` 为 `evaluate()` 回调提供宽松的 `var window: any` / `var document: any`，加入真实 DOM 会与之冲突（`TS2403: Subsequent variable declarations must have the same type`）。

4. **构建不再需要 bun**
   上游 `build` 脚本用 `bun` 跑三个构建脚本，其中只有 `scripts/build-client-bundles.ts` 真正用到 `Bun.build()`。为一次打包调用引入第二个 JS 运行时不划算，已改为 esbuild（travel-agent 本就依赖它），三个脚本统一由 `tsx` 执行。产物一致：5 个浏览器端 IIFE bundle（a11y-client 6kb、ghost-cursor-client 15kb、bippy 30kb、readability 86kb、selector-generator 276kb）。

5. **移除 `prepublishOnly: "pnpm build"`**。本包 `private: true`，永不发布；而 travel-agent 的 workspace 开了 `injectWorkspacePackages`，该脚本会在每次 `pnpm install` 时被触发并失败。

6. **`build-resources.ts` 去掉全部 website 产出**
   上游把生成的 API 文档同时写进 `dist/` 和官网的 `public/resources/`，并额外产出 `website/public/SKILL.md` 与 `.well-known/skills/` 发现端点。官网未并入本仓，故 `writeToDestinations` 只写 `dist/`，`buildWellKnownSkills()` 与其专用的 `parseFrontmatter()` 一并删除。

7. **跨包路径全部重指向**
   上游布局中 `penguin-browser/` 与 `extension/` 是仓库根的同级目录，并入后成为 `packages/browser-cli` 与 `packages/browser-extension`。已修正的位置：

   | 文件 | 原引用 |
   | --- | --- |
   | `scripts/build-extension-bundle.ts` | `../extension` |
   | `src/test-utils.ts`（2 处） | `../extension` |
   | `src/extension-identity.test.ts` | `../../extension/manifest.json` |
   | `src/offscreen-recording.unit.test.ts` | `../../extension/src/offscreen.ts` |
   | `src/relay-navigation.test.ts` | `../extension/test-fixtures/...` |
   | `src/extension-connection.test.ts` | `../extension` |
   | `browser-extension/vite.config.mts` | `../penguin-browser/package.json` |
   | `browser-extension/src/background.ts`（2 处） | `../../penguin-browser/dist/*.js?raw` |

8. **包名保持 `penguin-browser` 未改。** `packages/browser-extension` 的源码以 `penguin-browser/src/...` 形式深层导入本包（`background.ts`、`recording.ts` 等），改名会全部断掉。重命名如有需要应作为独立的一次改动，同时更新这些导入。

9. 删除了空的 `tmp/`（原仓库 `.gitignore` 中已忽略）。

## 并入后的验证结果

2026-08-12 在 travel-agent 内实测：

| 项 | 结果 |
| --- | --- |
| `pnpm install` | 通过 |
| `pnpm --filter penguin-browser build` | 通过（5 bundle → tsc → 扩展打包 147KB → 资源生成） |
| `pnpm --filter penguin-browser-extension build` | 通过 |
| 单元测试（7 个不依赖浏览器的文件） | 62/62 通过，与并入前基线一致 |
| CDP relay | 启动并监听 `127.0.0.1:19989` |
| `browser install` | 下载 Chrome 151.0.7922.138 成功 |
| headless session + 携程 | `hotels.ctrip.com` 加载正常，ARIA 快照 10,205 字符 |

未在本环境验证（需要图形界面的真实 Chrome）：扩展 attach、真实登录态下的完整搜索。已由项目维护者在本机确认可用。

## 构建顺序（有循环依赖，不能颠倒）

`penguin-browser` 的 devDependencies 含 `penguin-browser-extension`（测试要加载扩展），而扩展的 dependencies 含 `penguin-browser`。pnpm 能处理这种 dep ↔ devDep 环，但构建必须按序：

```
packages/browser-cli  →  packages/browser-extension  →  browser-cli 的测试
```

## 已知问题

- `@xmorse/playwright-core` 自带的 CLI 安装器（`node_modules/@xmorse/playwright-core/cli.js install …`）在 Node 24 上抛 `TypeError: onExit is not a function`。**本包不受影响**——它有自己的 Chrome for Testing 下载器（`src/browser-install.ts` 的 `installChrome()`），实测正常。仅当有人绕过本包直接调用 Playwright 安装器时才会遇到。
- Executor 默认执行超时 **10 秒**，较长的脚本需显式传 `--timeout`。
