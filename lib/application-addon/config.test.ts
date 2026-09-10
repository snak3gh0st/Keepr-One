import { afterEach, describe, expect, it } from 'vitest'
import { isKBotApplicationEnabled } from './config'

const original = process.env.KBOT_IGO_APPLICATION_ENABLED

afterEach(() => {
  if (original === undefined) delete process.env.KBOT_IGO_APPLICATION_ENABLED
  else process.env.KBOT_IGO_APPLICATION_ENABLED = original
})

describe('isKBotApplicationEnabled', () => {
  it('stays closed when the switch is absent', () => {
    delete process.env.KBOT_IGO_APPLICATION_ENABLED
    expect(isKBotApplicationEnabled()).toBe(false)
  })

  it('stays closed for an empty value rather than guessing', () => {
    process.env.KBOT_IGO_APPLICATION_ENABLED = ''
    expect(isKBotApplicationEnabled()).toBe(false)
  })

  it('opens only for an explicit true', () => {
    process.env.KBOT_IGO_APPLICATION_ENABLED = 'true'
    expect(isKBotApplicationEnabled()).toBe(true)
    process.env.KBOT_IGO_APPLICATION_ENABLED = 'false'
    expect(isKBotApplicationEnabled()).toBe(false)
  })

  it('refuses an ambiguous value instead of failing open or closed silently', () => {
    process.env.KBOT_IGO_APPLICATION_ENABLED = 'yes'
    expect(() => isKBotApplicationEnabled()).toThrow('must be true or false')
  })
})
