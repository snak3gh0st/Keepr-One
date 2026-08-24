/// Absent configuration means WhatsApp is simply not offered — the same rule the
/// inbox itself follows. A deployment without the provider shows no connect button
/// rather than a button that fails.
export function whatsappConfigFromEnv(
  env: Record<string, string | undefined>,
): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (env.WHATSAPP_PROVIDER_URL ?? '').trim().replace(/\/+$/, '')
  const apiKey = (env.WHATSAPP_PROVIDER_API_KEY ?? '').trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}
