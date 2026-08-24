export type WhatsappChannelMode = 'EVOLUTION' | 'META_CLOUD'

/// The transport is a deployment decision, never inferred from whichever
/// provider happens to answer first. This prevents a legacy Evolution session
/// from taking over after an agent has migrated to Meta Cloud.
export function whatsappChannelModeFromEnv(
  env: Record<string, string | undefined>,
): WhatsappChannelMode {
  return env.WHATSAPP_CHANNEL_MODE?.trim().toUpperCase() === 'META_CLOUD'
    ? 'META_CLOUD'
    : 'EVOLUTION'
}
