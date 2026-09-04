/**
 * Better Auth marks the short-lived, administrator-owned support session on
 * the target session itself. Keep this check structural so server components,
 * routes, and the proxy share the same read-only boundary without trusting a
 * request header or duplicating an unsafe cast.
 */
export function isReadOnlySupportPreview(
  session: { session?: { impersonatedBy?: unknown } | null } | null | undefined,
) {
  return typeof session?.session?.impersonatedBy === 'string'
}
