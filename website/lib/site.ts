/**
 * The canonical origin, for metadata (canonical, hreflang, Open Graph) only. Fixed rather than
 * read from request headers, which a caller controls. Change it here when the site moves to
 * its own domain; the Vercel-issued address stays valid alongside.
 */
export const siteOrigin = "https://opentravelagent.vercel.app";
