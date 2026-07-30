/// Extracts the portal's own route list from a rendered page.
///
/// This is how the real `/agent/...` paths were found the first time, but it
/// lived in a throwaway probe that was deleted after use. The next
/// investigation inherited only remembered names — "commissions-payment-portal",
/// "client-intelligence" — and no paths, and guessing a URL costs a carrier hit
/// against a session that lives ~20 minutes. So it belongs in a committed,
/// tested module rather than in a scratch script.
const PORTAL_HOSTNAME = 'www.nationallife.com'

/// Every distinct `/agent/` route the HTML links to, deduped and sorted.
///
/// Query strings are dropped: they carry per-record drill-down tokens, and the
/// route is the thing worth knowing. Embedded record ids collapse to `{id}` so
/// 9,000 policy links report as one drill-down template instead of flooding the
/// list.
export function portalRoutesIn(html: string): string[] {
  const hrefs = (html.match(/\shref=["']([^"']+)["']/gi) ?? []).map(
    (attr) => attr.match(/["']([^"']+)["']$/)?.[1] ?? '',
  )

  const routes = hrefs
    .map((href) => {
      // Absolute carrier URLs and root-relative paths both resolve here;
      // anything off-origin or non-HTTP is dropped by the try/catch.
      try {
        const url = new URL(href, `https://${PORTAL_HOSTNAME}`)
        if (url.hostname !== PORTAL_HOSTNAME) return ''
        return url.pathname
      } catch {
        return ''
      }
    })
    .filter((path) => path.startsWith('/agent/'))
    // A path segment that is a long hex or numeric id is a drill-down template,
    // not a distinct area of the portal.
    .map((path) => path.replace(/\/(?:[0-9a-f]{16,}|\d{4,})(?=\/|$)/gi, '/{id}'))
    // Trailing slashes are not a different route.
    .map((path) => (path.length > '/agent/'.length ? path.replace(/\/+$/, '') : path))

  return Array.from(new Set(routes.filter(Boolean))).sort()
}
