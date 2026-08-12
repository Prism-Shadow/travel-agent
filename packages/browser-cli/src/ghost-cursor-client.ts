/**
 * Browser-side ghost cursor renderer, injected into every Penguin Browser-attached tab.
 * Auto-enables on load (top frame only). Idles out after 5s of no activity.
 *
 * Two-element DOM structure so move and press have independent CSS transitions:
 *   outer (#__penguinBrowser_ghost_cursor__) → translate3d, move easing/duration
 *   inner (first child)                  → scale + opacity, press easing/duration
 */

import { SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL } from './assets/cursors/screen-studio/pointer-macos-tahoe-data-url.js'

// Top-frame only — skip iframes. try/catch for sandboxed iframes that throw.
const isTopFrame = (() => {
  try {
    return window === window.top
  } catch {
    return false
  }
})()

type GhostCursorActionType = 'move' | 'down' | 'up' | 'wheel'
type GhostCursorButton = 'left' | 'right' | 'middle' | 'none'
type GhostCursorStyle = 'minimal' | 'dot' | 'screenstudio'

interface GhostCursorAction {
  type: GhostCursorActionType
  x: number
  y: number
  button: GhostCursorButton
}

export interface GhostCursorClientOptions {
  style?: GhostCursorStyle
  color?: string
  size?: number
  zIndex?: number
  easing?: string
  minDurationMs?: number
  maxDurationMs?: number
  speedPxPerMs?: number
}

interface GhostCursorRuntimeOptions {
  style: GhostCursorStyle
  color: string
  size: number
  zIndex: number
  easing: string
  minDurationMs: number
  maxDurationMs: number
  speedPxPerMs: number
}

interface GhostCursorRuntimeState {
  outerElement: HTMLDivElement | null
  innerElement: HTMLDivElement | null
  options: GhostCursorRuntimeOptions
  x: number
  y: number
  scale: number
  hasPosition: boolean
  enabled: boolean
  idleHidden: boolean
}

interface GhostCursorApi {
  enable: (options?: GhostCursorClientOptions) => void
  disable: () => void
  applyMouseAction: (action: GhostCursorAction) => void
  isEnabled: () => boolean
}

declare global {
  var __penguinBrowserGhostCursor: GhostCursorApi | undefined
}

const CURSOR_ID = '__penguinBrowser_ghost_cursor__'
const SCREENSTUDIO_POINTER_ASPECT_RATIO = 618 / 958
const SCREENSTUDIO_HOTSPOT_X_RATIO = 0.14
const SCREENSTUDIO_HOTSPOT_Y_RATIO = 0.06
const MINIMAL_TRIANGLE_HOTSPOT_X_RATIO = 0.07
const MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO = 0.06

// Animation curves from Emil Kowalski's guidelines (https://animations.dev):
// moves use ease-in-out (accel/decel), presses use strong ease-out (100-160ms).
const MOVE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)' // easeInOutCubic
const PRESS_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)' // strong ease-out
const PRESS_DURATION_MS = 140

// Cursor fades out after 5s of no activity, wakes on next action.
const IDLE_HIDE_DELAY_MS = 5000
const IDLE_FADE_OUT_MS = 600

const DEFAULT_OPTIONS: GhostCursorRuntimeOptions = {
  style: 'minimal',
  color: '#111827',
  size: 22,
  zIndex: 2147483647,
  easing: MOVE_EASING,
  // Slow enough to track with the eye. Override per-call via ghostCursor.show().
  minDurationMs: 220,
  maxDurationMs: 1500,
  speedPxPerMs: 1.2,
}

const runtime: GhostCursorRuntimeState = {
  outerElement: null,
  innerElement: null,
  options: DEFAULT_OPTIONS,
  x: 0,
  y: 0,
  scale: 1,
  hasPosition: false,
  enabled: false,
  idleHidden: false,
}

let idleHideTimer: ReturnType<typeof setTimeout> | null = null

function clamp(options: { value: number; min: number; max: number }): number {
  const { value, min, max } = options
  return Math.min(max, Math.max(min, value))
}

function mergeOptions(options?: GhostCursorClientOptions): GhostCursorRuntimeOptions {
  if (!options) {
    return DEFAULT_OPTIONS
  }

  return {
    style: options.style ?? DEFAULT_OPTIONS.style,
    color: options.color ?? DEFAULT_OPTIONS.color,
    size: options.size ?? DEFAULT_OPTIONS.size,
    zIndex: options.zIndex ?? DEFAULT_OPTIONS.zIndex,
    easing: options.easing ?? DEFAULT_OPTIONS.easing,
    minDurationMs: options.minDurationMs ?? DEFAULT_OPTIONS.minDurationMs,
    maxDurationMs: options.maxDurationMs ?? DEFAULT_OPTIONS.maxDurationMs,
    speedPxPerMs: options.speedPxPerMs ?? DEFAULT_OPTIONS.speedPxPerMs,
  }
}

function getCursorDimensions(): { width: number; height: number } {
  if (runtime.options.style === 'screenstudio') {
    const height = runtime.options.size
    const width = Math.max(10, Math.round(height * SCREENSTUDIO_POINTER_ASPECT_RATIO))
    return { width, height }
  }

  if (runtime.options.style === 'minimal') {
    const size = Math.max(12, runtime.options.size)
    return { width: size, height: size }
  }

  return { width: runtime.options.size, height: runtime.options.size }
}

function getHotspotOffsetPx(): { x: number; y: number } {
  const dimensions = getCursorDimensions()

  if (runtime.options.style === 'screenstudio') {
    return {
      x: Math.round(dimensions.width * SCREENSTUDIO_HOTSPOT_X_RATIO),
      y: Math.round(dimensions.height * SCREENSTUDIO_HOTSPOT_Y_RATIO),
    }
  }

  if (runtime.options.style === 'minimal') {
    return {
      x: Math.round(dimensions.width * MINIMAL_TRIANGLE_HOTSPOT_X_RATIO),
      y: Math.round(dimensions.height * MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO),
    }
  }

  return {
    x: Math.round(dimensions.width / 2),
    y: Math.round(dimensions.height / 2),
  }
}

function getBaseOpacity(): string {
  if (runtime.options.style === 'screenstudio') {
    return '0.95'
  }

  if (runtime.options.style === 'minimal') {
    return '1'
  }

  return '0.72'
}

// Outer element: translate only (move timing).
function applyTranslate(): void {
  if (!runtime.outerElement) {
    return
  }

  const hotspot = getHotspotOffsetPx()
  runtime.outerElement.style.transform = `translate3d(${runtime.x - hotspot.x}px, ${runtime.y - hotspot.y}px, 0)`
}

// Inner element: scale only (press timing).
function applyScale(): void {
  if (!runtime.innerElement) {
    return
  }

  runtime.innerElement.style.transform = `scale(${runtime.scale})`
}

function computeDurationMs(options: { targetX: number; targetY: number }): number {
  if (!runtime.hasPosition) {
    return 0
  }

  const dx = options.targetX - runtime.x
  const dy = options.targetY - runtime.y
  const distance = Math.hypot(dx, dy)
  const rawDurationMs = distance / runtime.options.speedPxPerMs

  return clamp({
    value: rawDurationMs,
    min: runtime.options.minDurationMs,
    max: runtime.options.maxDurationMs,
  })
}

function createCursorElement(): HTMLDivElement {
  const outer = document.createElement('div')
  outer.id = CURSOR_ID
  outer.setAttribute('aria-hidden', 'true')
  outer.style.position = 'fixed'
  outer.style.left = '0'
  outer.style.top = '0'
  outer.style.pointerEvents = 'none'
  outer.style.zIndex = `${runtime.options.zIndex}`
  outer.style.transitionProperty = 'transform'
  outer.style.transitionTimingFunction = runtime.options.easing
  outer.style.transitionDuration = '0ms'
  outer.style.willChange = 'transform'

  const inner = document.createElement('div')
  inner.style.transitionProperty = 'transform, opacity'
  inner.style.transitionTimingFunction = PRESS_EASING
  inner.style.transitionDuration = `${PRESS_DURATION_MS}ms`
  inner.style.opacity = getBaseOpacity()
  outer.appendChild(inner)

  runtime.outerElement = outer
  runtime.innerElement = inner
  applyRuntimeVisualOptions()

  return outer
}

function ensureCursorElement(): HTMLDivElement {
  const existing = document.getElementById(CURSOR_ID) as HTMLDivElement | null
  if (existing) {
    runtime.outerElement = existing
    runtime.innerElement = (existing.firstElementChild as HTMLDivElement) || null
    return existing
  }

  const outer = createCursorElement()
  const root = document.documentElement || document.body
  root.appendChild(outer)
  return outer
}

function applyRuntimeVisualOptions(): void {
  if (!runtime.innerElement) {
    return
  }

  const dimensions = getCursorDimensions()
  runtime.innerElement.style.width = `${dimensions.width}px`
  runtime.innerElement.style.height = `${dimensions.height}px`

  if (runtime.outerElement) {
    runtime.outerElement.style.zIndex = `${runtime.options.zIndex}`
    runtime.outerElement.style.transitionTimingFunction = runtime.options.easing
  }

  // Scale around the hotspot so press doesn't shift the arrow tip.
  const hotspot = getHotspotOffsetPx()
  runtime.innerElement.style.transformOrigin = `${hotspot.x}px ${hotspot.y}px`

  if (runtime.options.style === 'screenstudio') {
    runtime.innerElement.style.borderRadius = '0'
    runtime.innerElement.style.border = 'none'
    runtime.innerElement.style.backgroundColor = 'transparent'
    runtime.innerElement.style.backgroundImage = `url("${SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL}")`
    runtime.innerElement.style.backgroundRepeat = 'no-repeat'
    runtime.innerElement.style.backgroundPosition = 'left top'
    runtime.innerElement.style.backgroundSize = 'contain'
    runtime.innerElement.style.backdropFilter = 'none'
    runtime.innerElement.style.filter = 'none'
    runtime.innerElement.style.boxShadow = 'none'
    runtime.innerElement.style.opacity = getBaseOpacity()
    return
  }

  if (runtime.options.style === 'minimal') {
    const triangleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="-1 -1 26 26"><path fill="white" stroke="${runtime.options.color}" stroke-width="1.5" stroke-linejoin="round" d="m23.284 19.124l-6.866-6.895a.4.4 0 0 1-.118-.296a.43.43 0 0 1 .163-.282l4.439-3.077a1.48 1.48 0 0 0 .621-1.48a1.48 1.48 0 0 0-1.036-1.198L1.623.302a1.14 1.14 0 0 0-1.11.282A1.13 1.13 0 0 0 .29 1.649L5.928 20.44a1.48 1.48 0 0 0 1.183 1.035a1.48 1.48 0 0 0 1.48-.621l3.078-4.44a.37.37 0 0 1 .31-.118a.43.43 0 0 1 .296.104l6.91 6.91a1.48 1.48 0 0 0 2.087 0l2.086-2.086a1.48 1.48 0 0 0-.074-2.101"/></svg>`
    const triangleDataUrl = `url("data:image/svg+xml,${encodeURIComponent(triangleSvg)}")`
    runtime.innerElement.style.borderRadius = '0'
    runtime.innerElement.style.border = 'none'
    runtime.innerElement.style.backgroundColor = 'transparent'
    runtime.innerElement.style.backgroundImage = triangleDataUrl
    runtime.innerElement.style.backgroundRepeat = 'no-repeat'
    runtime.innerElement.style.backgroundSize = 'contain'
    runtime.innerElement.style.backgroundPosition = 'left top'
    runtime.innerElement.style.backdropFilter = 'none'
    runtime.innerElement.style.boxShadow = 'none'
    runtime.innerElement.style.filter = 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4))'
    runtime.innerElement.style.opacity = getBaseOpacity()
    return
  }

  runtime.innerElement.style.borderRadius = '999px'
  runtime.innerElement.style.border = 'none'
  runtime.innerElement.style.backgroundColor = runtime.options.color
  runtime.innerElement.style.backgroundImage = 'none'
  runtime.innerElement.style.backdropFilter = 'none'
  runtime.innerElement.style.filter = 'none'
  runtime.innerElement.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.18), inset 0 0 0 2px rgba(255, 255, 255, 0.55)'
  runtime.innerElement.style.opacity = getBaseOpacity()
}

function clearIdleHideTimer(): void {
  if (idleHideTimer !== null) {
    clearTimeout(idleHideTimer)
    idleHideTimer = null
  }
}

function scheduleIdleHide(): void {
  clearIdleHideTimer()
  idleHideTimer = setTimeout(() => {
    idleHideTimer = null
    if (!runtime.enabled || !runtime.innerElement) {
      return
    }
    runtime.idleHidden = true
    runtime.innerElement.style.transitionDuration = `${IDLE_FADE_OUT_MS}ms`
    runtime.innerElement.style.transitionTimingFunction = PRESS_EASING
    runtime.innerElement.style.opacity = '0'
  }, IDLE_HIDE_DELAY_MS)
}

function wakeFromIdle(options: { x: number; y: number }): void {
  // Teleport so moveCursor sees zero distance.
  runtime.x = options.x
  runtime.y = options.y
  runtime.hasPosition = true
  if (runtime.innerElement) {
    runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`
    runtime.innerElement.style.transitionTimingFunction = PRESS_EASING
    runtime.innerElement.style.opacity = getBaseOpacity()
  }
}

function moveCursor(options: { x: number; y: number }): void {
  if (!runtime.enabled) {
    return
  }

  ensureCursorElement()
  const durationMs = computeDurationMs({ targetX: options.x, targetY: options.y })
  if (runtime.outerElement) {
    runtime.outerElement.style.transitionDuration = `${Math.round(durationMs)}ms`
    runtime.outerElement.style.transitionTimingFunction = runtime.options.easing
  }

  runtime.x = options.x
  runtime.y = options.y
  runtime.hasPosition = true
  applyTranslate()
}

function setPressed(options: { pressed: boolean }): void {
  if (!runtime.enabled || !runtime.innerElement) {
    return
  }

  // Subtle press feedback (0.95). Dot style uses 0.92 — needs a bigger pulse.
  runtime.scale = options.pressed
    ? runtime.options.style === 'dot'
      ? 0.92
      : 0.95
    : 1
  runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`
  runtime.innerElement.style.transitionTimingFunction = PRESS_EASING
  runtime.innerElement.style.opacity = options.pressed ? '1' : getBaseOpacity()
  applyScale()
}

function enable(options?: GhostCursorClientOptions): void {
  runtime.options = mergeOptions(options)
  runtime.enabled = true
  ensureCursorElement()
  applyRuntimeVisualOptions()

  if (!runtime.hasPosition) {
    runtime.x = Math.round(window.innerWidth / 2)
    runtime.y = Math.round(window.innerHeight / 2)
    runtime.scale = 1
    runtime.hasPosition = true
  }

  runtime.idleHidden = false
  if (runtime.innerElement) {
    runtime.innerElement.style.opacity = getBaseOpacity()
  }

  applyTranslate()
  applyScale()
  scheduleIdleHide()
}

function disable(): void {
  runtime.enabled = false
  runtime.scale = 1
  runtime.hasPosition = false
  runtime.idleHidden = false
  clearIdleHideTimer()

  if (runtime.outerElement) {
    runtime.outerElement.remove()
    runtime.outerElement = null
    runtime.innerElement = null
  }
}

function applyMouseAction(action: GhostCursorAction): void {
  if (!runtime.enabled) {
    return
  }

  if (runtime.idleHidden) {
    runtime.idleHidden = false
    wakeFromIdle({ x: action.x, y: action.y })
  }

  if (action.type === 'move' || action.type === 'wheel') {
    moveCursor({ x: action.x, y: action.y })
  } else if (action.type === 'down') {
    moveCursor({ x: action.x, y: action.y })
    setPressed({ pressed: true })
  } else if (action.type === 'up') {
    moveCursor({ x: action.x, y: action.y })
    setPressed({ pressed: false })
  }

  scheduleIdleHide()
}

const api: GhostCursorApi = {
  enable,
  disable,
  applyMouseAction,
  isEnabled: () => {
    return runtime.enabled
  },
}

if (isTopFrame) {
  globalThis.__penguinBrowserGhostCursor = api

  // Auto-enable. Defer for early injection (addScriptToEvaluateOnNewDocument)
  // when DOM isn't ready yet. After hard navigations the cursor re-centers
  // until the next mouse action arrives.
  try {
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          try {
            api.enable()
          } catch {
            // Non-fatal — DOM may be in an unexpected state.
          }
        },
        { once: true },
      )
    } else {
      api.enable()
    }
  } catch {
    // Restricted contexts (chrome://, devtools://) — silently skip.
  }
}

export {}
