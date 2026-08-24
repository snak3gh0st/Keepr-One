/// Absent configuration means the feature is off, not broken: deployments that have
/// not adopted messaging must keep working untouched.
/// Takes the narrowest shape it actually reads rather than the whole `ProcessEnv`:
/// callers can pass `process.env`, and tests can pass two fields without inventing
/// the rest of the environment.
export function chatwootConfigFromEnv(
  env: Record<string, string | undefined>,
): { baseUrl: string; platformToken: string } | null {
  const rawUrl = (env.CHATWOOT_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const platformToken = (env.CHATWOOT_PLATFORM_TOKEN ?? '').trim()
  if (!rawUrl || !platformToken) return null
  // The platform token can act on every account in the instance. It does not
  // travel over plaintext.
  if (!rawUrl.startsWith('https://')) return null
  return { baseUrl: rawUrl, platformToken }
}
