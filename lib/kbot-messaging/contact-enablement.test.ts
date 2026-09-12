import { describe, expect, it, vi } from 'vitest'
import { enableAllAgentContacts, setContactEnabled } from './contact-enablement'

const now = new Date('2026-09-12T15:00:00.000Z')

function db(contacts: Array<{ id: string; phone: string | null }>, optedOut: string[] = [], existingPrefs: Array<{ subjectKey: string; optedOut: boolean }> = []) {
  return {
    client: { findMany: vi.fn(async () => contacts) },
    kBotContactPreference: {
      findMany: vi.fn(async () => existingPrefs.length > 0 ? existingPrefs : optedOut.map((subjectKey) => ({ subjectKey, optedOut: true }))),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({})),
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
    // Deve usar batch operations, não upsert por contato
    expect(deps.kBotContactPreference.createMany).toHaveBeenCalled()
  })

  it('nunca inclui quem pediu para parar', async () => {
    const deps = db(
      [{ id: 'c1', phone: '+5511999990001' }, { id: 'c2', phone: '+5511999990002' }],
      ['c2'],
    )

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 1, withoutPhone: 0, optedOut: 1 })
    // c2 nunca deve aparecer nas operações de batch
    expect(JSON.stringify(deps.kBotContactPreference.createMany.mock.calls)).not.toContain('c2')
  })

  it('com 5 contatos elegíveis não faz upsert por contato, usa batch operations', async () => {
    const deps = db([
      { id: 'c1', phone: '+5511999990001' },
      { id: 'c2', phone: '+5511999990002' },
      { id: 'c3', phone: '+5511999990003' },
      { id: 'c4', phone: '+5511999990004' },
      { id: 'c5', phone: '+5511999990005' },
    ])

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 5, withoutPhone: 0, optedOut: 0 })
    // Não deve chamar upsert por contato
    expect(deps.kBotContactPreference.upsert).not.toHaveBeenCalled()
    // Deve chamar updateMany e/ou createMany
    expect(deps.kBotContactPreference.createMany).toHaveBeenCalled()
  })

  it('com 2500 contatos elegíveis faz chunking em createMany', async () => {
    // Criar 2500 contatos com telefone
    const contacts = Array.from({ length: 2500 }, (_, i) => ({
      id: `c${i}`,
      phone: `+551199990${String(i).padStart(4, '0')}`,
    }))
    const deps = db(contacts)

    const result = await enableAllAgentContacts(deps as never, { agentId: 'a1', now })

    expect(result).toEqual({ enabled: 2500, withoutPhone: 0, optedOut: 0 })
    // createMany deve ser chamado mais de uma vez (pelo menos 3 vezes: 1000 + 1000 + 500)
    expect(deps.kBotContactPreference.createMany).toHaveBeenCalledTimes(3)
    // Nenhuma chamada deve ter mais de 1000 entradas
    const createManyCalls = (deps.kBotContactPreference.createMany as any).mock.calls
    for (const call of createManyCalls) {
      const dataLength = call[0].data.length
      expect(dataLength).toBeLessThanOrEqual(1000)
    }
  })
})
