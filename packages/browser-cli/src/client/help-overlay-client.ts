/**
 * Browser-side half of the human handoff primitive (`penguin-browser request-help`).
 *
 * Bundled to `dist/help-overlay-client.js` as a browser IIFE and injected with
 * `page.evaluate(code)`, the same way `a11y-client.ts` is — see `scripts/build-client-bundles.ts`
 * and `getHelpOverlayCode()` in `request-help.ts`. Exposes `globalThis.__penguinHelp`.
 *
 * Two properties this overlay must have, both load-bearing:
 *
 * 1. **Non-modal.** The whole point of a handoff is that the human operates the page — types a
 *    verification code, solves a slider, confirms a payment. A modal backdrop would block the
 *    very interaction being asked for. This is a small floating card that never covers the
 *    page's interactive area, and it never calls preventDefault on page events.
 * 2. **Style-isolated.** It renders inside a shadow root so the host page's CSS cannot restyle
 *    it and its own CSS cannot leak into the page.
 *
 * The Node side polls `result(id)` rather than using an exposed binding: bindings are torn down
 * on navigation, and navigation is precisely what a solved captcha usually causes. Polling plus
 * re-injection survives it (see `request-help.ts`).
 */

const HOST_ID = '__penguin-help-overlay'
const HIGHLIGHT_ID = '__penguin-help-highlight'

/** A handoff being shown to the human. */
export interface HelpRequest {
  /** Correlates the overlay with the CLI call that created it; survives re-injection. */
  id: string
  /** What the human is being asked to do. Imperative, written by the agent. */
  prompt: string
  /** Optional CSS selector of the element to highlight and scroll into view. */
  targetSelector?: string
  /**
   * Why the agent handed the page over at all (`browser_takeover`).
   *
   * Rendered under the instruction, in a quieter line. It is the one thing a person cannot work out
   * from the page itself, and showing it is what keeps a takeover from feeling like the assistant
   * simply gave up on them.
   */
  reason?: string
}

/** The outcome the Node side polls for. */
export interface HelpResult {
  /** true when the human confirmed, false when they cancelled. Timeouts never reach here. */
  resolved: boolean
  /** Free-text note the human left; forwarded to the agent as steering. */
  message?: string
  reason: 'done' | 'cancelled'
}

interface HelpState {
  request: HelpRequest
  result?: HelpResult
}

let state: HelpState | undefined

function removeNode(id: string): void {
  document.getElementById(id)?.remove()
}

function clearHighlight(): void {
  removeNode(HIGHLIGHT_ID)
}

/**
 * Outlines the target with an absolutely-positioned box rather than mutating the element's own
 * style: the page may re-render or restyle the element at any moment, and a handoff must never
 * leave a visual artifact behind on a page the user keeps browsing.
 */
function highlight(selector: string): void {
  clearHighlight()
  let element: Element | null = null
  try {
    element = document.querySelector(selector)
  } catch {
    return // Invalid selector — highlighting is best-effort, never fatal.
  }
  if (!element) return

  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const rect = element.getBoundingClientRect()
  const box = document.createElement('div')
  box.id = HIGHLIGHT_ID
  box.style.cssText = [
    'position:fixed',
    `top:${rect.top - 3}px`,
    `left:${rect.left - 3}px`,
    `width:${rect.width + 6}px`,
    `height:${rect.height + 6}px`,
    'border:2px solid #f59e0b',
    'border-radius:6px',
    'box-shadow:0 0 0 9999px rgba(0,0,0,.12)',
    'pointer-events:none',
    'z-index:2147483646',
  ].join(';')
  document.documentElement.appendChild(box)
}

function finish(result: HelpResult): void {
  if (!state) return
  state.result = result
  clearHighlight()
  removeNode(HOST_ID)
}

function render(request: HelpRequest): void {
  removeNode(HOST_ID)

  const host = document.createElement('div')
  host.id = HOST_ID
  // The host itself is inert; only the card inside takes pointer events, so the page stays
  // fully operable around it.
  host.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none'
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    .card {
      pointer-events: auto;
      width: 320px;
      box-sizing: border-box;
      padding: 14px 16px;
      border-radius: 12px;
      background: #1e293b;
      color: #f1f5f9;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
            "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    .tag {
      display: inline-block;
      margin-bottom: 8px;
      padding: 1px 7px;
      border-radius: 999px;
      background: #f59e0b;
      color: #1e293b;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .02em;
    }
    .prompt { margin: 0 0 10px; white-space: pre-wrap; word-break: break-word; }
    .reason {
      margin: -4px 0 10px;
      color: #94a3b8;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 52px;
      resize: vertical;
      padding: 7px 8px;
      border: 1px solid #475569;
      border-radius: 7px;
      background: #0f172a;
      color: #f1f5f9;
      font: inherit;
    }
    textarea::placeholder { color: #64748b; }
    textarea:focus { outline: 2px solid #f59e0b; outline-offset: 1px; border-color: transparent; }
    .row { display: flex; gap: 8px; margin-top: 10px; }
    button {
      flex: 1;
      padding: 7px 10px;
      border: 0;
      border-radius: 7px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
    .done { background: #f59e0b; color: #1e293b; }
    .cancel { background: #334155; color: #e2e8f0; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `

  const card = document.createElement('div')
  card.className = 'card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Penguin Browser 需要你处理一步')

  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = '需要你处理'

  const prompt = document.createElement('p')
  prompt.className = 'prompt'
  // textContent, never innerHTML: `prompt` is agent-authored text and may contain page content.
  prompt.textContent = request.prompt

  // Agent-authored text, and it may quote the page: textContent, never innerHTML.
  const reason = document.createElement('p')
  reason.className = 'reason'
  if (request.reason) reason.textContent = `交给你的原因：${request.reason}`

  const note = document.createElement('textarea')
  note.placeholder = '想让 agent 知道什么？（可留空）'

  const row = document.createElement('div')
  row.className = 'row'
  const done = document.createElement('button')
  done.className = 'done'
  // "Hand it back", not "OK": what the button does is return control, and the agent resumes from
  // wherever the person left the page.
  done.textContent = '我处理好了，交还'
  const cancel = document.createElement('button')
  cancel.className = 'cancel'
  cancel.textContent = '取消任务'

  done.addEventListener('click', () => {
    finish({ resolved: true, message: note.value.trim() || undefined, reason: 'done' })
  })
  cancel.addEventListener('click', () => {
    finish({ resolved: false, message: note.value.trim() || undefined, reason: 'cancelled' })
  })

  row.append(done, cancel)
  card.append(tag, prompt)
  if (request.reason) card.append(reason)
  card.append(note, row)
  root.append(style, card)
  document.documentElement.appendChild(host)

  if (request.targetSelector) highlight(request.targetSelector)
}

/**
 * Shows a handoff, or re-attaches an already-answered one.
 *
 * Re-injection after navigation calls this again with the same id. If the human already
 * answered, the answer is kept and nothing is drawn — otherwise a page that navigated between
 * the click and the next poll would lose the result and the overlay would reappear.
 */
function show(request: HelpRequest): void {
  if (state?.request.id === request.id && state.result) return
  state = { request }
  render(request)
}

/** The outcome, or undefined while the human has not answered yet. */
function result(id: string): HelpResult | undefined {
  return state?.request.id === id ? state.result : undefined
}

/** Whether a given handoff is currently drawn — the Node side uses this to detect navigation. */
function isShowing(id: string): boolean {
  return state?.request.id === id && !state.result && !!document.getElementById(HOST_ID)
}

/** Removes the overlay and forgets the request (used on timeout and on abort). */
function dismiss(): void {
  clearHighlight()
  removeNode(HOST_ID)
  state = undefined
}

// ============================================================================
// Expose on globalThis for injection
// ============================================================================

;(
  globalThis as {
    __penguinHelp?: {
      show: (request: HelpRequest) => void
      result: (id: string) => HelpResult | undefined
      isShowing: (id: string) => boolean
      dismiss: () => void
    }
  }
).__penguinHelp = { show, result, isShowing, dismiss }
