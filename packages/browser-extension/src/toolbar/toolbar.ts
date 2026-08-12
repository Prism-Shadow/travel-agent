// Toolbar injected into the page's MAIN world via chrome.scripting.executeScript({ func }).
//
// CRITICAL: entirely self-contained. The function is serialized via
// Function.prototype.toString(), so no external imports, no module-level refs,
// all helpers as inner functions, all constants defined inline. TS type
// annotations are stripped at compile time — safe to use.
//
// window.__penguinBrowserPinCount is a shared MAIN-world counter so toolbar pins
// and right-click menu pins never collide on globalThis.penguinBrowserPinnedElemN.

declare global {
  interface Window {
    __penguinBrowserToolbarInstalled?: boolean
    __penguinBrowserToolbarDestroy?: () => void
    __penguinBrowserPinCount?: number
    // Template literal index for pinned element globals (penguinBrowserPinnedElem1, etc.)
    [key: `penguinBrowserPinnedElem${number}`]: Element | undefined
  }
}

export function initPenguinBrowserToolbar(penguinLogoUrl: string): void {
  if (window.__penguinBrowserToolbarInstalled) return
  window.__penguinBrowserToolbarInstalled = true

  // Top-level frame only — skip iframes (cross-origin access throws).
  try {
    if (window !== window.top) return
  } catch {
    return
  }

  let pinModeActive = false
  let pinCount = 0
  let toastTimer: number | null = null
  let overlayEl: HTMLDivElement | null = null
  // Declared here so the hoisted setPinMode can reference it before assignment.
  let pinBtn!: HTMLButtonElement

  // ── Create shadow-DOM host ─────────────────────────────────────────────────

  const host = document.createElement('div')
  host.setAttribute('data-penguin-browser-toolbar', '1')
  // pointer-events:none on the host so the shadow-DOM children (pointer-events:all)
  // control interactivity without the host element itself blocking page events
  host.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;font-size:0;line-height:0;'

  // Closed shadow root: page scripts cannot access our toolbar DOM
  const shadow = host.attachShadow({ mode: 'closed' })

  const styleEl = document.createElement('style')
  // Toolbar styles mirror mesurer's toolbar.tsx:
  //   - white bg, rounded-[12px], p-1
  //   - shadow: 0px 0px .5px rgba(0,0,0,.18), 0px 3px 8px rgba(0,0,0,.1), 0px 1px 3px rgba(0,0,0,.1)
  //   - active button: #0d99ff background, white text
  //   - inactive hover: bg-black/4 (rgba(0,0,0,0.04))
  styleEl.textContent = `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      background: #fff;
      border-radius: 10px;
      pointer-events: all;
      user-select: none;
      box-shadow: 0px 0px 0.5px rgba(0,0,0,0.18), 0px 3px 8px rgba(0,0,0,0.1), 0px 1px 3px rgba(0,0,0,0.1);
    }
    .divider {
      width: 1px;
      height: 12px;
      background: rgba(0, 0, 0, 0.08);
      margin: 0 1px;
      flex-shrink: 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: #000;
      cursor: pointer;
      transition: background 0.1s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .btn:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    .btn.active {
      background: #0d99ff;
      color: #fff;
    }
    .btn.active:hover {
      background: #0d99ff;
      filter: brightness(1.05);
    }
    .penguin-logo {
      width: 18px;
      height: 18px;
      display: block;
    }
    .toast {
      position: fixed;
      background: #0f172a;
      border-radius: 8px;
      padding: 9px 18px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 11px;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
      z-index: 1;
      --toast-transform: translateX(-50%);
      animation: toast-in 0.15s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: var(--toast-transform) translateY(4px); }
      to   { opacity: 1; transform: var(--toast-transform); }
    }
  `

  const toolbarEl = document.createElement('div')
  toolbarEl.className = 'toolbar'
  toolbarEl.setAttribute('role', 'toolbar')
  toolbarEl.setAttribute('aria-label', 'Penguin Browser tools')

  shadow.appendChild(styleEl)
  shadow.appendChild(toolbarEl)

  // ── Helper: toast notification ─────────────────────────────────────────────

  function showToast(msg: string, anchorRect?: DOMRect): void {
    shadow.querySelectorAll('.toast').forEach((el) => {
      el.remove()
    })
    if (toastTimer !== null) clearTimeout(toastTimer)
    const toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.textContent = msg

    if (anchorRect) {
      // Position like a tooltip just below the element, centered horizontally
      const GAP = 8
      const centerX = anchorRect.left + anchorRect.width / 2
      const belowY = anchorRect.bottom + GAP

      // Flip above if too close to viewport bottom (toast is ~30px tall)
      const fitsBelow = belowY + 36 < window.innerHeight
      const top = fitsBelow ? belowY : anchorRect.top - GAP
      const transformOrigin = fitsBelow ? 'top center' : 'bottom center'

      toastEl.style.left = Math.max(8, Math.min(centerX, window.innerWidth - 8)) + 'px'
      toastEl.style.top = top + 'px'
      // Set base transform via CSS variable so the @keyframes animation includes it.
      // Without this, the keyframe overrides the inline transform during animation
      // and the toast jumps when positioned above the anchor (translateY(-100%)).
      const baseTransform = fitsBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)'
      toastEl.style.setProperty('--toast-transform', baseTransform)
      toastEl.style.transform = baseTransform
      toastEl.style.transformOrigin = transformOrigin
    } else {
      // Fallback: bottom-center of viewport
      toastEl.style.bottom = '20px'
      toastEl.style.left = '50%'
      toastEl.style.transform = 'translateX(-50%)'
    }

    shadow.appendChild(toastEl)
    toastTimer = window.setTimeout(() => {
      toastEl.remove()
    }, 1900)
  }

  // ── Helper: hover overlay (shown under cursor in pin mode) ─────────────────
  //
  // Matches mesurer's rendering exactly: four 1px-thin edge divs as the border,
  // plus a very subtle fill background. Colors from mesurer's measurement-box.tsx:
  //   outlineColor = color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)
  //   fillColor    = color-mix(in oklch, oklch(0.62 0.18 255) 8%,  transparent)
  // This is thinner and cleaner than a CSS outline/border.

  function getOverlay(): HTMLDivElement {
    if (!overlayEl) {
      const EDGE = 'color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)'
      const FILL = 'color-mix(in oklch, oklch(0.62 0.18 255) 8%, transparent)'

      const container = document.createElement('div')
      container.setAttribute('data-penguin-browser-overlay', '1')
      container.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:2147483646',
        `background:${FILL}`,
        'display:none',
      ].join(';')

      // Four 1px edge divs — same technique as mesurer measurement-box
      const edgeTop = document.createElement('div')
      edgeTop.style.cssText = `position:absolute;top:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeRight = document.createElement('div')
      edgeRight.style.cssText = `position:absolute;top:0;right:0;width:1px;height:100%;background:${EDGE};`

      const edgeBottom = document.createElement('div')
      edgeBottom.style.cssText = `position:absolute;bottom:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeLeft = document.createElement('div')
      edgeLeft.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100%;background:${EDGE};`

      container.appendChild(edgeTop)
      container.appendChild(edgeRight)
      container.appendChild(edgeBottom)
      container.appendChild(edgeLeft)

      document.documentElement.appendChild(container)
      overlayEl = container
    }
    return overlayEl
  }

  function positionOverlay(target: Element): void {
    const rect = target.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    const overlay = getOverlay()
    overlay.style.display = 'block'
    overlay.style.top = rect.top + 'px'
    overlay.style.left = rect.left + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
  }

  function hideOverlay(): void {
    if (overlayEl) overlayEl.style.display = 'none'
  }

  function removeOverlay(): void {
    if (overlayEl) {
      overlayEl.remove()
      overlayEl = null
    }
  }

  // ── Helper: find element at point, skipping our own injected DOM ───────────

  function getTargetAt(x: number, y: number): Element | null {
    // pointer-events:none elements are excluded from elementsFromPoint per spec,
    // so the overlay is already filtered. We still skip our toolbar host explicitly.
    const els = document.elementsFromPoint(x, y)
    return (
      els.find(
        (el) =>
          !el.hasAttribute('data-penguin-browser-overlay') &&
          !el.hasAttribute('data-penguin-browser-toolbar') &&
          el !== document.documentElement &&
          el !== document.body,
      ) ?? null
    )
  }

  // composedPath with a closed shadow root still includes the host element,
  // so this correctly detects clicks/moves that land on our toolbar
  function isOverToolbar(e: MouseEvent): boolean {
    return e.composedPath().some((node) => node === host)
  }

  // ── Helper: flash green outline on a pinned element ────────────────────────

  function flashElement(el: Element): void {
    const s = (el as HTMLElement).style
    if (!s) return
    const prevOutline = s.outline
    const prevOffset = s.outlineOffset
    s.outline = '1px solid #22c55e'
    s.outlineOffset = '2px'
    window.setTimeout(() => {
      s.outline = prevOutline
      s.outlineOffset = prevOffset
    }, 350)
  }

  // ── Helper: copy text to clipboard with execCommand fallback ───────────────

  function copyText(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for pages where the Clipboard API is blocked by Permissions-Policy
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        ta.remove()
      } catch {}
    })
  }

  // ── Pin mode: allocate the next reference name ─────────────────────────────

  function allocatePinName(): `penguinBrowserPinnedElem${number}` {
    // Sync with the shared MAIN-world counter so right-click and toolbar
    // pins never produce conflicting globalThis.penguinBrowserPinnedElemN names
    const shared = window.__penguinBrowserPinCount
    if (typeof shared === 'number' && shared > pinCount) pinCount = shared
    pinCount++
    window.__penguinBrowserPinCount = pinCount
    return `penguinBrowserPinnedElem${pinCount}`
  }

  // ── Pin mode event handlers ────────────────────────────────────────────────

  function onMouseMove(e: MouseEvent): void {
    if (isOverToolbar(e)) {
      hideOverlay()
      return
    }
    const target = getTargetAt(e.clientX, e.clientY)
    if (target) positionOverlay(target)
    else hideOverlay()
  }

  // Build a tiny eval that delegates all logging and React inspection to Penguin Browser.
  // JSON.stringify does NOT escape literal ' characters, so "Don't save"
  // stays "Don't save" in the output. That would break the outer bash '…'
  // wrapper. Replace ' with \u0027 — valid JSON, parses back to ' in the
  // JS engine — so the whole code is single-quote-free and slots safely
  // into the bash 'penguin-browser -e …' wrapper regardless of element text.
  function buildInspectionCode(n: number, url: string): string {
    const URL_LIT = JSON.stringify(url).replace(/'/g, '\\u0027')
    return `inspectPinnedElement(${URL_LIT},"globalThis.penguinBrowserPinnedElem${n}")`
  }

  function onClick(e: MouseEvent): void {
    if (isOverToolbar(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()

    const target = getTargetAt(e.clientX, e.clientY)
    if (!target) return

    const name = allocatePinName()
    const n = pinCount
    window[name] = target

    flashElement(target)

    // Copy only the command so pasting it into a shell or agent prompt stays compact.
    const url = location.href
    const code = buildInspectionCode(n, url)
    const clipboardText = "penguin-browser -e '" + code + "'"
    copyText(clipboardText)
    showToast('Copied penguin-browser element reference, use it in your agent prompt', target.getBoundingClientRect())
    setPinMode(false)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') setPinMode(false)
  }

  // ── Pin mode toggle ────────────────────────────────────────────────────────

  let previousDocumentCursor: string | undefined

  function setPinMode(on: boolean): void {
    pinModeActive = on
    // pinBtn is declared above and assigned below; safe to reference here
    // because setPinMode is only called from event listeners that fire after
    // all setup code has run
    pinBtn.classList.toggle('active', on)

    if (on) {
      if (previousDocumentCursor === undefined) {
        previousDocumentCursor = document.documentElement.style.cursor
      }
      document.documentElement.style.cursor = 'crosshair'
      getOverlay() // ensure overlay element exists in DOM
      document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      if (previousDocumentCursor !== undefined) {
        document.documentElement.style.cursor = previousDocumentCursor
        previousDocumentCursor = undefined
      }
      hideOverlay()
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }

  // ── SVG icon strings (defined inside function — required for func injection) ─

  const PENGUIN_LOGO = `<img class="penguin-logo" src="${penguinLogoUrl}" alt="Penguin Browser" />`

  // Lucide x icon
  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  // ── Build toolbar buttons ──────────────────────────────────────────────────

  // Pin element button
  pinBtn = document.createElement('button')
  pinBtn.className = 'btn'
  pinBtn.setAttribute(
    'aria-label',
    'Pin element — click any element to copy inspection code for a penguin-browser -e call',
  )
  pinBtn.setAttribute('title', 'Pin element (click to copy inspection code)')
  pinBtn.innerHTML = PENGUIN_LOGO
  pinBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    setPinMode(!pinModeActive)
  })

  const dividerEl = document.createElement('div')
  dividerEl.className = 'divider'
  dividerEl.setAttribute('aria-hidden', 'true')

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.className = 'btn'
  closeBtn.setAttribute('aria-label', 'Close Penguin Browser toolbar')
  closeBtn.setAttribute('title', 'Close toolbar')
  closeBtn.innerHTML = CLOSE_SVG
  closeBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    setPinMode(false)
    host.style.display = 'none'
  })

  toolbarEl.appendChild(pinBtn)
  toolbarEl.appendChild(dividerEl)
  toolbarEl.appendChild(closeBtn)

  // Attach host to the document (appended to <html> so it survives body rewrites)
  document.documentElement.appendChild(host)

  // ── Cleanup hook called by background.ts on tab disconnect ─────────────────

  window.__penguinBrowserToolbarDestroy = function (): void {
    setPinMode(false)
    removeOverlay()
    host.remove()
    delete window.__penguinBrowserToolbarInstalled
    delete window.__penguinBrowserToolbarDestroy
    delete window.__penguinBrowserPinCount
  }
}
