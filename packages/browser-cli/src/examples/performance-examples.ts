// Example snippets for profiling website performance with Penguin Browser and CDP.

import { console, getCDPSession, page } from './debugger-examples-types.js'

type PerfMetrics = {
  paints: Record<string, number>
  lcp: number
  cls: number
}

type ObservedPerfEntry = {
  name: string
  startTime: number
  duration: number
  hadRecentInput?: boolean
  value?: number
  interactionId?: number
}

type NavigationTimingEntry = {
  responseStart: number
  domContentLoadedEventEnd: number
  loadEventEnd: number
}

type LongTaskEntry = {
  startTime: number
  duration: number
}

type EventTimingEntry = {
  name: string
  duration: number
  interactionId: number
}

// Example: Collect navigation timing and basic web vitals from the current page
async function collectWebVitals() {
  await page.evaluate(() => {
    const metrics: PerfMetrics = {
      paints: {},
      lcp: 0,
      cls: 0,
    }

    const perfGlobal = globalThis as typeof globalThis & {
      __pwPerfMetrics?: PerfMetrics
    }

    perfGlobal.__pwPerfMetrics = metrics

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as ObservedPerfEntry[]) {
        metrics.paints[entry.name] = entry.startTime
      }
    }).observe({ type: 'paint', buffered: true } as never)

    new PerformanceObserver((list) => {
      const entries = list.getEntries() as ObservedPerfEntry[]
      const lastEntry = entries[entries.length - 1]
      if (!lastEntry) {
        return
      }
      metrics.lcp = lastEntry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true } as never)

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as ObservedPerfEntry[]) {
        if (entry.hadRecentInput) {
          continue
        }
        metrics.cls += entry.value || 0
      }
    }).observe({ type: 'layout-shift', buffered: true } as never)
  })

  await page.reload({ waitUntil: 'domcontentloaded' })

  const report = await page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwPerfMetrics?: PerfMetrics
    }
    const nav = performance.getEntriesByType('navigation' as never)[0] as unknown as
      | NavigationTimingEntry
      | undefined
    const metrics = perfGlobal.__pwPerfMetrics

    return {
      ttfb: nav?.responseStart || 0,
      domContentLoaded: nav?.domContentLoadedEventEnd || 0,
      load: nav?.loadEventEnd || 0,
      fcp: metrics?.paints['first-contentful-paint'] || 0,
      lcp: metrics?.lcp || 0,
      cls: metrics?.cls || 0,
    }
  })

  console.log(report)
}

// Example: Measure the biggest transferred requests with raw CDP network events
async function collectHeaviestRequests() {
  const cdp = await getCDPSession({ page })
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const responses = new Map<string, { url: string; mimeType: string }>()
  const finished = new Map<string, number>()

  cdp.on('Network.responseReceived', (event) => {
    responses.set(event.requestId, {
      url: event.response.url,
      mimeType: event.response.mimeType,
    })
  })

  cdp.on('Network.loadingFinished', (event) => {
    finished.set(event.requestId, event.encodedDataLength)
  })

  await page.reload({ waitUntil: 'domcontentloaded' })

  const largest = [...responses.entries()]
    .map(([requestId, response]) => {
      return {
        url: response.url,
        mimeType: response.mimeType,
        bytes: finished.get(requestId) || 0,
      }
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)

  console.log(largest)
}

// Example: Check whether interactivity is blocked by long tasks or slow events
async function measureInteractivity() {
  await page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwLongTasks?: LongTaskEntry[]
      __pwEventTimings?: EventTimingEntry[]
    }

    perfGlobal.__pwLongTasks = []
    perfGlobal.__pwEventTimings = []

    new PerformanceObserver((list) => {
      perfGlobal.__pwLongTasks?.push(
        ...(list.getEntries() as ObservedPerfEntry[]).map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      )
    }).observe({ type: 'longtask', buffered: true } as never)

    new PerformanceObserver((list) => {
      perfGlobal.__pwEventTimings?.push(
        ...(list.getEntries() as ObservedPerfEntry[]).map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          interactionId: entry.interactionId || 0,
        })),
      )
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as never)
  })

  const button = page.getByRole('button').first()
  await button.click()

  const report = await page.evaluate(() => {
    const perfGlobal = globalThis as typeof globalThis & {
      __pwLongTasks?: LongTaskEntry[]
      __pwEventTimings?: EventTimingEntry[]
    }

    return {
      longTasks: (perfGlobal.__pwLongTasks || []).filter((entry) => entry.duration >= 50),
      events: (perfGlobal.__pwEventTimings || []).filter((entry) => entry.interactionId !== 0),
    }
  })

  console.log(report)
}

export { collectWebVitals, collectHeaviestRequests, measureInteractivity }
