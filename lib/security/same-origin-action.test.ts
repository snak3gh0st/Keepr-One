import { describe, expect, it } from 'vitest'
import { assertSameOriginAction } from './same-origin-action'

describe('same-origin mutation boundary', () => {
  it('accepts an exact HTTPS production origin', () => {
    expect(() =>
      assertSameOriginAction({
        origin: 'https://app.keepr.one',
        host: 'app.keepr.one',
        forwardedHost: null,
        forwardedProto: 'https',
        nodeEnv: 'production',
      }),
    ).not.toThrow()
  })

  it.each([
    {
      origin: null,
      host: 'app.keepr.one',
      forwardedHost: null,
      forwardedProto: 'https',
      label: 'absent origin',
    },
    {
      origin: 'https://evil.test',
      host: 'app.keepr.one',
      forwardedHost: null,
      forwardedProto: 'https',
      label: 'mismatched host',
    },
    {
      origin: 'https://app.keepr.one',
      host: 'internal:3000',
      forwardedHost: 'app.keepr.one, evil.test',
      forwardedProto: 'https',
      label: 'multiple forwarded hosts',
    },
    {
      origin: 'http://app.keepr.one',
      host: 'app.keepr.one',
      forwardedHost: null,
      forwardedProto: 'http',
      label: 'non-HTTPS production origin',
    },
    {
      origin: 'https://app.keepr.one.evil.test',
      host: 'app.keepr.one',
      forwardedHost: null,
      forwardedProto: 'https',
      label: 'lookalike domain',
    },
  ])('rejects $label', (input) => {
    expect(() =>
      assertSameOriginAction({ ...input, nodeEnv: 'production' }),
    ).toThrow('Invalid action origin')
  })
})
