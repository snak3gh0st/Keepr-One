import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'
import { describe, expect, it } from 'vitest'
import configureNext from './next.config'

// Stored notifications and already-created Stripe sessions still point at the
// pre-consolidation K-Bot URLs, and neither can be rewritten. The redirects are
// the only thing that keeps those links working.
describe('K-Bot AI redirects', () => {
  it.each([
    ['/agent/mensagens', '/agent/ai/mensagens'],
    ['/agent/kbot/agendadas', '/agent/ai/agendadas'],
    ['/agent/kbot', '/agent/ai/acoes'],
  ])('permanently sends %s to %s', async (source, destination) => {
    const config = await configureNext(PHASE_DEVELOPMENT_SERVER)
    const redirects = await config.redirects!()

    expect(redirects).toContainEqual({ source, destination, permanent: true })
  })

  it('matches the scheduled page before its parent', async () => {
    const config = await configureNext(PHASE_DEVELOPMENT_SERVER)
    const sources = (await config.redirects!()).map((redirect) => redirect.source)

    expect(sources.indexOf('/agent/kbot/agendadas')).toBeLessThan(sources.indexOf('/agent/kbot'))
  })
})
