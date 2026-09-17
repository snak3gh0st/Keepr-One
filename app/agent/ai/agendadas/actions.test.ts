import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  headers: vi.fn(),
  assertSameOriginAction: vi.fn(),
  revalidatePath: vi.fn(),
  templateUpsert: vi.fn(),
  templateCount: vi.fn(),
  templateFindMany: vi.fn(),
  templateUpdateMany: vi.fn(),
  preferenceUpsert: vi.fn(),
  consentCreate: vi.fn(),
  transaction: vi.fn(),
  approve: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.assertSameOriginAction }))
vi.mock('@/lib/kbot-messaging/approval', () => ({
  approveScheduledMessages: mocks.approve,
  discardScheduledMessages: mocks.discard,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({ language: 'EN', copy: (_pt: string, en: string) => en }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    kBotMessageTemplate: { upsert: mocks.templateUpsert, count: mocks.templateCount, updateMany: mocks.templateUpdateMany, findMany: mocks.templateFindMany },
    kBotContactPreference: { upsert: mocks.preferenceUpsert },
    kBotContactConsentEvent: { create: mocks.consentCreate },
    $transaction: mocks.transaction,
  },
}))

import {
  approveScheduledProposals,
  discardScheduledProposals,
  saveScheduledTemplate,
  setContactConsent,
  setScheduledCategoryAutoSend,
  setScheduledCategoryEnabled,
} from './actions'

const tx = {
  // The per-agent advisory lock that serializes saving a template against
  // switching the category on or off.
  $executeRaw: vi.fn(),
  kBotMessageTemplate: { count: mocks.templateCount, updateMany: mocks.templateUpdateMany, upsert: mocks.templateUpsert, findMany: mocks.templateFindMany },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(new Headers({ origin: 'https://app.keepr.one', host: 'app.keepr.one' }))
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (client: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]))
  // `clearAllMocks` clears calls but keeps implementations, and one test below
  // makes this one throw. Reset it so the throw cannot leak into its neighbours.
  mocks.assertSameOriginAction.mockImplementation(() => {})
  mocks.approve.mockResolvedValue({ released: 2 })
  mocks.discard.mockResolvedValue({ released: 2 })
})

describe('saving a scheduled template', () => {
  it('refuses an unknown variable before anything is written', async () => {
    await expect(saveScheduledTemplate({ category: 'BIRTHDAY', language: 'PT', body: 'Oi {{nome_do_cliente}}' })).resolves.toEqual({
      ok: false,
      message: 'These variables do not exist: nome_do_cliente. Use only the ones listed.',
    })
    expect(mocks.templateUpsert).not.toHaveBeenCalled()
  })

  it('refuses an empty body and an unmatched brace', async () => {
    await expect(saveScheduledTemplate({ category: 'BIRTHDAY', language: 'PT', body: '  ' })).resolves.toMatchObject({ ok: false })
    await expect(saveScheduledTemplate({ category: 'BIRTHDAY', language: 'PT', body: 'Oi {{nome' })).resolves.toEqual({
      ok: false,
      message: 'There is an unmatched {{ or }} in the message. Close the variable before saving.',
    })
    expect(mocks.templateUpsert).not.toHaveBeenCalled()
  })

  it('creates the first template switched off and returns the preview that was checked', async () => {
    mocks.templateCount.mockResolvedValue(0)
    const result = await saveScheduledTemplate({ category: 'BIRTHDAY', language: 'PT', body: ' Feliz aniversário, {{primeiro_nome}}! ' })
    expect(result).toEqual({ ok: true, preview: 'Feliz aniversário, Ana!' })
    expect(mocks.templateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { agentId: 'agent-1', category: 'BIRTHDAY', language: 'PT', body: 'Feliz aniversário, {{primeiro_nome}}!', enabled: false },
      update: { body: 'Feliz aniversário, {{primeiro_nome}}!' },
    }))
  })

  it('lets a new language join a category that is already on', async () => {
    mocks.templateCount.mockResolvedValue(1)
    await expect(saveScheduledTemplate({ category: 'BIRTHDAY', language: 'EN', body: 'Happy birthday, {{primeiro_nome}}!' })).resolves.toMatchObject({ ok: true })
    expect(mocks.templateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ language: 'EN', enabled: true }),
    }))
  })

  it('never reaches the database for a caller without an agent', async () => {
    mocks.getCurrentAgent.mockRejectedValue(new Error('Forbidden'))
    await expect(saveScheduledTemplate({ category: 'BIRTHDAY', language: 'PT', body: 'Oi {{nome}}' })).resolves.toMatchObject({ ok: false })
    expect(mocks.templateUpsert).not.toHaveBeenCalled()
  })
})

describe('turning a category on', () => {
  it('refuses to activate a category that has no text yet', async () => {
    mocks.templateCount.mockResolvedValue(0)
    await expect(setScheduledCategoryEnabled({ category: 'ANNUAL_REVIEW', enabled: true })).resolves.toEqual({
      ok: false,
      message: 'Write and save this category message before turning it on.',
    })
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled()
  })

  it('moves every language of the category together', async () => {
    mocks.templateCount.mockResolvedValue(2)
    mocks.templateUpdateMany.mockResolvedValue({ count: 2 })
    await expect(setScheduledCategoryEnabled({ category: 'ANNUAL_REVIEW', enabled: true })).resolves.toEqual({ ok: true })
    expect(mocks.templateUpdateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', category: 'ANNUAL_REVIEW' },
      data: { enabled: true },
    })
  })
})

describe('opting a contact out from the screen', () => {
  it('writes the event and the projection on the same key, in one transaction', async () => {
    await expect(setContactConsent({ subjectKey: '+14075550100', optedOut: true })).resolves.toEqual({ ok: true })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.preferenceUpsert).toHaveBeenCalledWith({
      where: { agentId_subjectKey: { agentId: 'agent-1', subjectKey: '+14075550100' } },
      create: { agentId: 'agent-1', subjectKey: '+14075550100', optedOut: true },
      update: { optedOut: true },
    })
    expect(mocks.consentCreate).toHaveBeenCalledWith({
      data: { agentId: 'agent-1', subjectKey: '+14075550100', action: 'OPT_OUT', source: 'AGENT_UI' },
    })
  })

  it('records allowing contact again as its own event rather than erasing the old one', async () => {
    await expect(setContactConsent({ subjectKey: '+14075550100', optedOut: false })).resolves.toEqual({ ok: true })
    expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { optedOut: false, snoozedUntil: null },
    }))
    expect(mocks.consentCreate).toHaveBeenCalledWith({
      data: { agentId: 'agent-1', subjectKey: '+14075550100', action: 'OPT_IN', source: 'AGENT_UI' },
    })
  })

  it('rejects a subject key that is not a phone number', async () => {
    await expect(setContactConsent({ subjectKey: 'client:abc', optedOut: true })).resolves.toMatchObject({ ok: false })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('turning automatic sending on', () => {
  it('moves every language of the category together, under the agent lock', async () => {
    mocks.templateFindMany.mockResolvedValue([{ body: 'Parabéns, {{primeiro_nome}}!' }, { body: 'Happy birthday, {{primeiro_nome}}!' }])
    mocks.templateUpdateMany.mockResolvedValue({ count: 2 })

    const result = await setScheduledCategoryAutoSend({ category: 'BIRTHDAY', autoSend: true })

    expect(result).toEqual({ ok: true })
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(mocks.templateUpdateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', category: 'BIRTHDAY' },
      data: { autoSend: true },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/ai/agendadas')
  })

  it('refuses a category that has no rows at all', async () => {
    mocks.templateFindMany.mockResolvedValue([])

    const result = await setScheduledCategoryAutoSend({ category: 'BIRTHDAY', autoSend: true })

    expect(result).toEqual({ ok: false, message: expect.stringContaining('before changing how it is sent') })
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled()
  })

  // O caso que a migration tornou universal: a linha existe, ligada, com `body`
  // nulo. Automático aí significaria o modelo escrevendo sobre uma apólice em
  // lapso e a mensagem saindo sem ninguém ter lido.
  it('refuses a category the K-Bot still writes, however the row got there', async () => {
    mocks.templateFindMany.mockResolvedValue([{ body: null }])

    const result = await setScheduledCategoryAutoSend({ category: 'LAPSE_RECOVERY', autoSend: true })

    expect(result).toEqual({ ok: false, message: expect.stringContaining('delivers the text you approved') })
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled()
  })

  // O motor lê a linha do idioma do próprio agente, e o `updateMany` liga todas.
  // Uma linha com texto não pode autorizar as outras.
  it('refuses when one language has text and the other has none', async () => {
    mocks.templateFindMany.mockResolvedValue([{ body: 'Happy birthday!' }, { body: '   ' }])

    const result = await setScheduledCategoryAutoSend({ category: 'BIRTHDAY', autoSend: true })

    expect(result.ok).toBe(false)
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled()
  })

  it('never blocks turning it back off', async () => {
    mocks.templateFindMany.mockResolvedValue([{ body: null }])
    mocks.templateUpdateMany.mockResolvedValue({ count: 1 })

    const result = await setScheduledCategoryAutoSend({ category: 'LAPSE_RECOVERY', autoSend: false })

    expect(result).toEqual({ ok: true })
    expect(mocks.templateUpdateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', category: 'LAPSE_RECOVERY' },
      data: { autoSend: false },
    })
  })

  it('rejects anything that is not a scheduled category', async () => {
    const result = await setScheduledCategoryAutoSend({ category: 'FOLLOWUP', autoSend: true })
    expect(result.ok).toBe(false)
    expect(mocks.templateUpdateMany).not.toHaveBeenCalled()
  })
})

describe('releasing proposals', () => {
  it('passes the signed-in agent, never an id from the screen', async () => {
    const result = await approveScheduledProposals({ jobIds: ['j1', 'j2'] })

    expect(mocks.approve).toHaveBeenCalledWith('agent-1', ['j1', 'j2'])
    expect(result).toEqual({ ok: true, released: 2 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/ai/agendadas')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/ai/mensagens')
  })

  it('refuses a payload that tries to name its own agent', async () => {
    const result = await approveScheduledProposals({ jobIds: ['j1'], agentId: 'agent-2' })

    expect(result.ok).toBe(false)
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('checks the request came from this site before touching anything', async () => {
    mocks.assertSameOriginAction.mockImplementation(() => { throw new Error('cross-origin') })

    const result = await approveScheduledProposals({ jobIds: ['j1'] })

    expect(result.ok).toBe(false)
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('hands the discarded ones to the path that gives the credit back', async () => {
    const result = await discardScheduledProposals({ jobIds: ['j1', 'j2'] })

    expect(mocks.discard).toHaveBeenCalledWith('agent-1', ['j1', 'j2'])
    expect(result).toEqual({ ok: true, released: 2 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/ai/mensagens')
  })

  it('refuses an empty selection instead of reporting a no-op as done', async () => {
    const result = await approveScheduledProposals({ jobIds: [] })
    expect(result.ok).toBe(false)
    expect(mocks.approve).not.toHaveBeenCalled()
  })
})
