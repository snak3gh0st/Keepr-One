import { describe, expect, it, vi } from 'vitest'
import { enableAllAgentContacts, setContactEnabled } from './contact-enablement'

const now = new Date('2026-09-12T15:00:00.000Z')

function db(contacts: Array<{ id: string; phone: string | null }>, optedOut: string[] = []) {
  return {
    client: { findMany: vi.fn(async () => contacts) },
    kBotContactPreference: {
      findMany: vi.fn(async () => optedOut.map((subjectKey) => ({ subjectKey, optedOut: true }))),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  }
}

describe('setContactEnabled', () => {
  it('liga gravando a data, sem tocar no pedido do cliente', async () => {
    const deps = db([])

    await setContactEnabled(deps as never, { agentId: 'a1', subjectKey: 'c1', enabled: true, now })

    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: 'a1', subjectKey: 'c1', kbotEnabledAt: now }),
      update: { kbotEnabledAt: now },
    }))
  })

  it('desliga limpando a data, e também sem tocar no pedido do cliente', async () => {
    const deps = db([])

    await setContactEnabled(deps as never, { agentId: 'a1', subjectKey: 'c1', enabled: false, now })

    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { kbotEnabledAt: null },
    }))
    expect(JSON.stringify(deps.kBotContactPreference.upsert.mock.calls)).not.toContain('optedOut')
  })
})

describe('enableAllAgentContacts', () => {
  it('liga só quem tem telefone e conta o resto', async () => {
    const deps = db([
      { id: 'c1', phone: '+5511999990001' },
      { id: 'c2', phone: null },
      { id: 'c3', phone: '+5511999990003' },
    ])

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 2, withoutPhone: 1, optedOut: 0 })
    expect(deps.kBotContactPreference.upsert).toHaveBeenCalledTimes(2)
  })

  it('nunca inclui quem pediu para parar', async () => {
    const deps = db(
      [{ id: 'c1', phone: '+5511999990001' }, { id: 'c2', phone: '+5511999990002' }],
      ['c2'],
    )

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 1, withoutPhone: 0, optedOut: 1 })
    expect(JSON.stringify(deps.kBotContactPreference.upsert.mock.calls)).not.toContain('c2')
  })
})
