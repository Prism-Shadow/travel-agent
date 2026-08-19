/**
 * Generates markdown resource files for the MCP at build time.
 *
 * These files are written to `dist/`, for the MCP to read at runtime.
 *
 * Source of truth: `src/skill.md` — manually edited, contains full docs including CLI usage.
 * The agent-facing stub with frontmatter lives at
 * `packages/skills/skills/penguin-browser/SKILL.md`.
 *
 * Generated files:
 * - dist/debugger-api.md · dist/editor-api.md · dist/styles-api.md
 * - dist/performance-profiling.md
 * - dist/prompt.md — MCP prompt (skill.md minus CLI sections)
 *
 * 并入 travel-agent 时移除了全部 website/ 产物（官网双写、SKILL.md 托管副本、
 * .well-known/skills 发现端点）——官网未并入本仓。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dedent from 'string-dedent'
import { Lexer, type Token, type Tokens } from 'marked'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const penguinBrowserDir = path.join(__dirname, '..')
const distDir = path.join(penguinBrowserDir, 'dist')
// 并入 travel-agent 时移除了 website/ 双写目标：上游把这些资源同时写进 dist 和官网的
// public/resources，官网未并入本仓，只保留 dist 产物。

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(penguinBrowserDir, relativePath), 'utf-8')
}

function writeToDestinations(filename: string, content: string) {
  ensureDir(distDir)
  fs.writeFileSync(path.join(distDir, filename), content, 'utf-8')
  console.log(`Generated ${filename}`)
}

function cleanTypes(typesContent: string): string {
  return typesContent.replace(/\/\/# sourceMappingURL=.*$/gm, '').trim()
}

function buildDebuggerApi() {
  const debuggerTypes = cleanTypes(readFile('dist/page/debugger.d.ts'))
  const debuggerExamples = readFile('src/examples/debugger-examples.ts')

  const content = dedent`
    # Debugger API Reference

    ## Types

    \`\`\`ts
    ${debuggerTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${debuggerExamples}
    \`\`\`
  `

  writeToDestinations('debugger-api.md', content)
}

function buildEditorApi() {
  const editorTypes = cleanTypes(readFile('dist/page/editor.d.ts'))
  const editorExamples = readFile('src/examples/editor-examples.ts')

  const content = dedent`
    # Editor API Reference

    The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

    ## Types

    \`\`\`ts
    ${editorTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${editorExamples}
    \`\`\`
  `

  writeToDestinations('editor-api.md', content)
}

function buildStylesApi() {
  const stylesTypes = cleanTypes(readFile('dist/page/styles.d.ts'))
  const stylesExamples = readFile('src/examples/styles-examples.ts')

  const content = dedent`
    # Styles API Reference

    The getStylesForLocator function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

    ## Types

    \`\`\`ts
    ${stylesTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${stylesExamples}
    \`\`\`
  `

  writeToDestinations('styles-api.md', content)
}

function buildPerformanceProfiling() {
  const performanceExamples = readFile('src/examples/performance-examples.ts')

  const content = dedent`
    # Profile Website Performance with Penguin Browser

    Penguin Browser can profile a real website in your own Chrome using **CDP**, **Navigation Timing**,
    and **PerformanceObserver**.

    Use it to answer four practical questions quickly:

    1. **Did the page render fast enough?**
    2. **What requests cost the most bytes?**
    3. **What blocked first paint or LCP?**
    4. **What blocked interactivity?**

    ## What to measure

    | Metric | Good | Needs work | Usually means |
    | --- | --- | --- | --- |
    | **TTFB** | under **800ms** | over **1.2s** | slow server or cache miss |
    | **FCP** | under **1.8s** | over **3s** | content appears late |
    | **LCP** | under **2.5s** | over **4s** | hero image, font, CSS, server, or JS delay |
    | **CLS** | under **0.1** | over **0.25** | unstable layout |
    | **Long task** | under **50ms** | over **100ms** | main thread blocked by JS |
    | **JS transfer** | under **250KB** | over **500KB** | too much hydration or client code |
    | **Font / media transfer** | context dependent | large above-the-fold assets | fonts, posters, videos, hero images |

    ## What usually blocks what

    - **First paint / FCP** is usually gated by **TTFB**, critical HTML, critical CSS, and above-the-fold fonts/images.
    - **LCP** is usually gated by the **largest hero asset**. Common causes: hero image, poster image, custom font, render-blocking CSS, or slow server response.
    - **Interactivity** is usually gated by **long tasks**. Common causes: too much JS on startup, hydration, or a large framework chunk.
    - **Load event** often stays late because of **non-critical assets** like videos, analytics, background images, and delayed client bundles.

    ## Quick commands

    Create a session and open a page:

    \`\`\`bash
    penguin-browser session new
    penguin-browser -s 1 -e 'state.page = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage()); await state.page.goto("https://example.com", { waitUntil: "domcontentloaded" })'
    \`\`\`

    Collect a concise vitals report:

    \`\`\`bash
    penguin-browser -s 1 -e "$(cat <<'EOF'
    await state.page.evaluate(() => {
      const metrics = { paints: {}, lcp: 0, cls: 0 }
      globalThis.__pwMetrics = metrics

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          metrics.paints[entry.name] = entry.startTime
        }
      }).observe({ type: 'paint', buffered: true })

      new PerformanceObserver((list) => {
        const lastEntry = list.getEntries().at(-1)
        if (lastEntry) {
          metrics.lcp = lastEntry.startTime
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            metrics.cls += entry.value
          }
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })

    await state.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForPageLoad({ page: state.page, timeout: 10000 })
    await state.page.waitForTimeout(3000)

    const report = await state.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const metrics = globalThis.__pwMetrics
      return {
        ttfb: nav?.responseStart || 0,
        domContentLoaded: nav?.domContentLoadedEventEnd || 0,
        load: nav?.loadEventEnd || 0,
        fcp: metrics?.paints['first-contentful-paint'] || 0,
        lcp: metrics?.lcp || 0,
        cls: metrics?.cls || 0,
      }
    })

    console.log(JSON.stringify(report, null, 2))
    EOF
    )"
    \`\`\`

    List the heaviest requests with CDP:

    \`\`\`bash
    penguin-browser -s 1 -e "$(cat <<'EOF'
    const cdp = await getCDPSession({ page: state.page })
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

    const responses = new Map()
    const finished = new Map()

    cdp.on('Network.responseReceived', (event) => {
      responses.set(event.requestId, {
        url: event.response.url,
        mimeType: event.response.mimeType,
      })
    })

    cdp.on('Network.loadingFinished', (event) => {
      finished.set(event.requestId, event.encodedDataLength)
    })

    await state.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForPageLoad({ page: state.page, timeout: 10000 })
    await state.page.waitForTimeout(3000)

    const largest = [...responses.entries()]
      .map(([requestId, response]) => ({
        url: response.url,
        mimeType: response.mimeType,
        bytes: finished.get(requestId) || 0,
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10)

    console.log(JSON.stringify(largest, null, 2))
    EOF
    )"
    \`\`\`

    Check interactivity blockers:

    \`\`\`bash
    penguin-browser -s 1 -e "$(cat <<'EOF'
    await state.page.evaluate(() => {
      globalThis.__pwLongTasks = []
      globalThis.__pwEvents = []

      new PerformanceObserver((list) => {
        globalThis.__pwLongTasks.push(
          ...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
        )
      }).observe({ type: 'longtask', buffered: true })

      new PerformanceObserver((list) => {
        globalThis.__pwEvents.push(
          ...list.getEntries().map((entry) => ({
            name: entry.name,
            duration: entry.duration,
            interactionId: entry.interactionId,
          })),
        )
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
    })

    await state.page.getByRole('button').first().click()
    await state.page.waitForTimeout(1000)

    const report = await state.page.evaluate(() => ({
      longTasks: globalThis.__pwLongTasks.filter((entry) => entry.duration >= 50),
      interactions: globalThis.__pwEvents.filter((entry) => entry.interactionId !== 0),
    }))

    console.log(JSON.stringify(report, null, 2))
    EOF
    )"
    \`\`\`

    ## How to read the results

    **Fast render, heavy payload**

    - If **FCP** and **LCP** are good but total bytes are huge, the page probably **looks fast on desktop** but wastes bandwidth on mobile.
    - This often happens with **hero videos**, large poster images, or custom fonts.

    **Slow first paint**

    - If **TTFB** is high, fix **server latency** or caching first.
    - If **TTFB** is fine but **FCP** is slow, inspect critical CSS, fonts, and above-the-fold images.

    **Slow interactivity**

    - If you see **long tasks over 50ms**, startup JS is the first suspect.
    - Look for large client bundles, hydration-heavy UI, and event handlers doing too much work.

    **Need deeper CPU answers**

    - If vitals and request sizes are not enough, record a **\`.cpuprofile\`** with Penguin Browser's raw **\`Profiler.*\`** CDP commands and inspect it with **[profano](https://github.com/remorses/profano)**.
    - A good place to keep your reusable profiling snippets is your dots repo, for example **\`~/.config/opencode/\`**.

    **Good load event is not enough**

    - A page can have a decent \`load\` time and still feel slow if **LCP** or **long tasks** are bad.
    - Prefer **TTFB + FCP + LCP + CLS + long tasks** over the load event alone.

    ## Performance checklist

    **If TTFB is bad**

    - cache HTML closer to users
    - reduce origin work before response
    - avoid expensive server-side data fetching on the critical route

    **If FCP or LCP is bad**

    - trim or defer render-blocking CSS
    - avoid large above-the-fold fonts and images
    - preload only truly critical assets
    - compress hero media harder

    **If interactivity is bad**

    - reduce startup JS
    - split large client bundles
    - avoid hydrating UI that is not immediately interactive
    - move optional widgets behind user action or idle time
    - if the culprit is still unclear, switch from vitals to a CPU profile and inspect hot functions with **profano**

    **If bytes are bad but vitals look good**

    - optimize for slower devices anyway
    - background videos are the first thing to cut
    - subset fonts and trim non-critical client features

    ## Examples

    \`\`\`ts
    ${performanceExamples}
    \`\`\`
  `

  writeToDestinations('performance-profiling.md', content)
}

/**
 * Removes CLI-related sections from skill.md to create prompt.md for the MCP.
 *
 * Sections removed:
 * - "## CLI Usage" section and all its subsections
 */
function stripCliSectionsFromSkill(skillContent: string): string {
  // Parse markdown tokens
  const tokens = Lexer.lex(skillContent)

  // Filter out CLI Usage section and its subsections
  const filteredTokens: Token[] = []
  let skipUntilLevel: number | null = null

  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      // Check if we should start skipping (CLI Usage section)
      if (heading.depth === 2 && heading.text === 'CLI Usage') {
        skipUntilLevel = 2
        continue
      }
      // Check if we should stop skipping (next h2 section)
      if (skipUntilLevel !== null && heading.depth <= skipUntilLevel) {
        skipUntilLevel = null
      }
    }

    if (skipUntilLevel === null) {
      filteredTokens.push(token)
    }
  }

  // Reconstruct markdown from tokens
  return (
    filteredTokens
      .map((token) => {
        return token.raw
      })
      .join('')
      .trim() + '\n'
  )
}

function buildPromptFromSkill() {
  // Read skill.md as source of truth
  const skillPath = path.join(penguinBrowserDir, 'src', 'skill.md')
  const skillContent = fs.readFileSync(skillPath, 'utf-8')

  // Generate prompt.md for MCP (without CLI sections)
  const promptContent = stripCliSectionsFromSkill(skillContent)
  const distPromptPath = path.join(distDir, 'prompt.md')
  fs.writeFileSync(distPromptPath, promptContent, 'utf-8')
  console.log('Generated dist/prompt.md (from skill.md)')
  // 上游在此还会把完整 skill.md 拷到 website/public/ 供官网托管；官网未并入本仓，已移除。
}

// Run all builds
buildDebuggerApi()
buildEditorApi()
buildStylesApi()
buildPerformanceProfiling()
buildPromptFromSkill()
// buildWellKnownSkills() 已移除：它只产出官网的 .well-known/skills 清单，官网未并入本仓。

console.log('Resource files generated successfully')
