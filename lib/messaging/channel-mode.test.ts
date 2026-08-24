import { describe, expect, it } from 'vitest'
import { whatsappChannelModeFromEnv } from './channel-mode'

describe('whatsappChannelModeFromEnv', () => {
  it('keeps the existing transport by default during migration', () => {
    expect(whatsappChannelModeFromEnv({})).toBe('EVOLUTION')
  })

  it('selects the official Meta Cloud transport explicitly', () => {
    expect(whatsappChannelModeFromEnv({ WHATSAPP_CHANNEL_MODE: ' meta_cloud ' }))
      .toBe('META_CLOUD')
  })
})
