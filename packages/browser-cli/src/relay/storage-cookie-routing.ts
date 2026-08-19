export const ROOT_STORAGE_COOKIE_METHODS = new Set(['Storage.getCookies', 'Storage.setCookies', 'Storage.clearCookies'])

export type StorageCookieRoutingTarget = {
  sessionId: string
  targetInfo: {
    type: string
    url?: string
    browserContextId?: string
  }
}

/**
 * Choose an already-authorized page target that belongs to the requested
 * browser context. The caller passes targets from one extension connection,
 * so this must never fall back to a different profile or extension.
 */
export function selectStorageCookieRoutingTarget({
  connectedTargets,
  browserContextId,
}: {
  connectedTargets: Iterable<StorageCookieRoutingTarget>
  browserContextId?: string
}): StorageCookieRoutingTarget {
  const pageTargets = Array.from(connectedTargets).filter((candidate) => {
    return candidate.targetInfo.type === 'page'
  })

  if (browserContextId !== undefined) {
    const target = pageTargets.find((candidate) => {
      return candidate.targetInfo.browserContextId === browserContextId
    })
    if (!target) {
      throw new Error(`No authorized page target is attached for browser context ${browserContextId}`)
    }
    return target
  }

  // Chrome's page TargetInfo can expose an opaque browserContextId even for
  // the persistent profile that Playwright models as its default context (and
  // therefore addresses without browserContextId on the root session). Prefer
  // a truly id-less target, otherwise accept a single unambiguous context.
  const defaultTarget = pageTargets.find((candidate) => {
    return candidate.targetInfo.browserContextId === undefined
  })
  if (defaultTarget) return defaultTarget

  const contextIds = new Set(
    pageTargets
      .map((candidate) => candidate.targetInfo.browserContextId)
      .filter((contextId): contextId is string => contextId !== undefined),
  )
  if (contextIds.size === 1 && pageTargets.length > 0) {
    return pageTargets[0]
  }

  if (contextIds.size > 1) {
    throw new Error('Root Storage cookie command is ambiguous across multiple browser contexts')
  }
  throw new Error('No authorized page target is attached for the default browser context')
}

export function getAuthorizedCookieUrls({
  connectedTargets,
  selectedTarget,
}: {
  connectedTargets: Iterable<StorageCookieRoutingTarget>
  selectedTarget: StorageCookieRoutingTarget
}): string[] {
  const selectedContextId = selectedTarget.targetInfo.browserContextId
  const urls = new Set<string>()

  for (const target of connectedTargets) {
    if (target.targetInfo.type !== 'page') continue
    if (target.targetInfo.browserContextId !== selectedContextId) continue
    const url = parseHttpUrl(target.targetInfo.url)
    if (url) urls.add(url.href)
  }

  return Array.from(urls)
}

export type StorageCookieParam = {
  name?: unknown
  url?: unknown
  domain?: unknown
}

export function assertStorageCookiesAreAuthorized({
  cookies,
  authorizedUrls,
}: {
  cookies: StorageCookieParam[]
  authorizedUrls: string[]
}): void {
  const authorizedHosts = authorizedUrls
    .map((url) => parseHttpUrl(url)?.hostname.toLowerCase())
    .filter((hostname): hostname is string => Boolean(hostname))

  for (const cookie of cookies) {
    const cookieName = typeof cookie.name === 'string' ? cookie.name : '<unnamed>'
    const cookieUrl = typeof cookie.url === 'string' ? parseHttpUrl(cookie.url) : null
    if (cookieUrl) {
      if (authorizedHosts.includes(cookieUrl.hostname.toLowerCase())) continue
      throw new Error(`Refusing to set cookie ${cookieName} for an unauthorized URL`)
    }

    if (typeof cookie.domain === 'string') {
      const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase()
      const isAuthorized = authorizedHosts.some((hostname) => {
        return hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`)
      })
      if (isAuthorized) continue
    }

    throw new Error(`Refusing to set cookie ${cookieName} for an unauthorized domain`)
  }
}

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
