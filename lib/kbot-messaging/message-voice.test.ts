import { describe, expect, it } from 'vitest'
import { checkMessageVoice } from './message-voice'

/// The birthday check could forbid every business word because a greeting has
/// no business content at all. Lapse recovery and the annual review are, by
/// definition, conversations about the policy — so the prohibition changes
/// shape: they may INVITE a conversation, and may not ASSERT facts (a figure,
/// a date, a number, the account's status).
describe('checkMessageVoice', () => {
  it('keeps the birthday rules exactly as they were', () => {
    expect(checkMessageVoice('Oi Ana, feliz aniversário! Aproveite o dia.', 'Ana', 'BIRTHDAY').ok).toBe(true)
    expect(checkMessageVoice('Oi Ana, feliz aniversário! Sua apólice vence hoje.', 'Ana', 'BIRTHDAY').ok).toBe(false)
  })

  it('lets a lapse message invite a conversation about the policy', () => {
    const check = checkMessageVoice('Oi Ana, vi um aviso na sua apólice e queria ajudar. Podemos conversar?', 'Ana', 'LAPSE_RECOVERY')
    expect(check.ok).toBe(true)
  })

  it('refuses a lapse message that states a figure', () => {
    const check = checkMessageVoice('Oi Ana, sua apólice está com R$ 340 em aberto.', 'Ana', 'LAPSE_RECOVERY')
    expect(check).toMatchObject({ ok: false, reason: 'CONTAINS_NUMBER' })
  })

  it('refuses a lapse message that states a date', () => {
    const check = checkMessageVoice('Oi Ana, sua apólice caiu em 12/08 e precisa de ação.', 'Ana', 'LAPSE_RECOVERY')
    expect(check).toMatchObject({ ok: false, reason: 'CONTAINS_NUMBER' })
  })

  it('refuses any message carrying a link', () => {
    const check = checkMessageVoice('Oi Ana, acesse http://exemplo.com para revisar.', 'Ana', 'ANNUAL_REVIEW')
    expect(check).toMatchObject({ ok: false, reason: 'CONTAINS_LINK' })
  })

  it('refuses a message that never addresses the client by name', () => {
    expect(checkMessageVoice('Bom dia, podemos conversar sobre sua apólice?', 'Ana', 'ANNUAL_REVIEW'))
      .toMatchObject({ ok: false, reason: 'NAME_MISSING' })
  })
})
