import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { responses = { create: state.create } } }))

import { generateScheduledMessage } from './scheduled-generation'

const input = { firstName: 'Ana', agentName: 'Felipe', language: 'PT' as const, category: 'LAPSE_RECOVERY' as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KBOT_FOLLOWUP_AI_ENABLED', 'true')
  vi.stubEnv('OPENAI_API_KEY', 'test-never-sent')
})

describe('generateScheduledMessage', () => {
  it('returns the text when the model stays inside the category voice', async () => {
    state.create.mockResolvedValue({ status: 'completed', output_text: 'Oi Ana, vi um aviso na sua apólice e queria ajudar. Podemos conversar?', usage: { input_tokens: 120, output_tokens: 30 } })
    await expect(generateScheduledMessage(input)).resolves.toMatchObject({ ok: true, attempted: true, inputTokens: 120, outputTokens: 30 })
  })

  it('refuses text that states a figure, and still reports the tokens it cost', async () => {
    state.create.mockResolvedValue({ status: 'completed', output_text: 'Oi Ana, há R$ 340 em aberto.', usage: { input_tokens: 120, output_tokens: 12 } })
    await expect(generateScheduledMessage(input)).resolves.toMatchObject({ ok: false, reason: 'CONTAINS_NUMBER', attempted: true, inputTokens: 120, outputTokens: 12 })
  })

  it('charges a timeout as an attempt, because the other side may have processed it', async () => {
    state.create.mockRejectedValue(new Error('timeout'))
    await expect(generateScheduledMessage(input)).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE', attempted: true, inputTokens: 160, outputTokens: 60 })
  })

  it('owes nothing when the feature is off, because nothing was asked of anyone', async () => {
    vi.stubEnv('KBOT_FOLLOWUP_AI_ENABLED', 'false')
    await expect(generateScheduledMessage(input)).resolves.toMatchObject({ ok: false, reason: 'UNAVAILABLE', attempted: false, inputTokens: 0, outputTokens: 0 })
    expect(state.create).not.toHaveBeenCalled()
  })

  it('sends the model only firstName, agentName, language and promptVersion — nothing else', async () => {
    state.create.mockResolvedValue({ status: 'completed', output_text: 'Oi Ana, podemos conversar sobre sua apólice?', usage: { input_tokens: 1, output_tokens: 1 } })
    await generateScheduledMessage(input)
    const call = state.create.mock.calls[0]![0]
    const payload = JSON.parse(call.input)
    // A real pin: any field added later — a phone number, a policy id, an
    // amount — fails this test regardless of what it looks like, because the
    // key set itself is the constraint, not a guess at a leak's shape.
    expect(Object.keys(payload).sort()).toEqual(['agentName', 'firstName', 'language', 'promptVersion'])
    expect(payload.firstName).toBe('Ana')
    expect(payload.agentName).toBe('Felipe')
  })

  it('delegates BIRTHDAY to the birthday prompt, not the scheduled one', async () => {
    state.create.mockResolvedValue({ status: 'completed', output_text: 'Oi Ana, feliz aniversário! Aproveite o dia.', usage: { input_tokens: 10, output_tokens: 10 } })
    await generateScheduledMessage({ ...input, category: 'BIRTHDAY' })
    const call = state.create.mock.calls[0]![0]
    const payload = JSON.parse(call.input)
    expect(payload.promptVersion).toBe('birthday-v1')
    expect(call.instructions).toContain('Write a short birthday message')
    expect(call.instructions).not.toContain('policy needs attention')
  })
})
