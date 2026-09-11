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

  it('refuses everything when there is no name to check against', () => {
    // `includes('')` is true for every string — an empty firstName must not
    // turn the name guard into a pass-through for a non-birthday category.
    expect(checkMessageVoice('Podemos conversar sobre sua apólice?', '', 'LAPSE_RECOVERY'))
      .toMatchObject({ ok: false, reason: 'NAME_MISSING' })
  })

  it('refuses a name that only appears inside another name', () => {
    // "Ana" is inside "Anabela" — a substring check would call this addressed,
    // sending a message meant for Ana to someone named Anabela instead.
    expect(checkMessageVoice('Oi Anabela, podemos conversar sobre sua apólice?', 'Ana', 'LAPSE_RECOVERY'))
      .toMatchObject({ ok: false, reason: 'NAME_MISSING' })
  })

  it('refuses a bare domain with no scheme', () => {
    expect(checkMessageVoice('Oi Ana, acesse exemplo.com para revisar.', 'Ana', 'ANNUAL_REVIEW'))
      .toMatchObject({ ok: false, reason: 'CONTAINS_LINK' })
  })

  it('refuses a single-brace placeholder', () => {
    expect(checkMessageVoice('Oi Ana, {nome} ainda não revisou a apólice.', 'Ana', 'ANNUAL_REVIEW'))
      .toMatchObject({ ok: false, reason: 'CONTAINS_PLACEHOLDER' })
  })

  it('refuses a message that asserts the policy is cancelled', () => {
    // No digit and no other forbidden word — this would clear the validator
    // without status vocabulary, and telling a client their policy is
    // cancelled on the model's invented say-so is the worst case this guard
    // exists for.
    expect(checkMessageVoice('Oi Ana, sua apólice está cancelada. Podemos conversar?', 'Ana', 'LAPSE_RECOVERY'))
      .toMatchObject({ ok: false, reason: 'MENTIONS_BUSINESS' })
  })

  it('refuses a message that asserts the policy is overdue', () => {
    expect(checkMessageVoice('Oi Ana, sua apólice está em atraso. Podemos conversar?', 'Ana', 'LAPSE_RECOVERY'))
      .toMatchObject({ ok: false, reason: 'MENTIONS_BUSINESS' })
  })

  it('still lets a plain invitation mention the policy in general terms', () => {
    // The status guard must not make the category impossible: inviting a
    // conversation about "a apólice" without asserting any status is exactly
    // what these categories exist to do.
    expect(checkMessageVoice('Oi Ana, podemos conversar sobre sua apólice?', 'Ana', 'ANNUAL_REVIEW').ok).toBe(true)
  })

  it('does not reject a word that merely contains a status fragment', () => {
    // "iniciativa" contains "ativa" as a substring — the regression a
    // substring check would introduce. Matched on whole tokens, this passes.
    expect(checkMessageVoice('Oi Ana, tive uma iniciativa que pode ajudar. Podemos conversar?', 'Ana', 'LAPSE_RECOVERY').ok).toBe(true)
  })

  it('does not reject another ordinary word containing a status fragment', () => {
    // "relativo" contains "ativo" as a substring, same regression as above
    // from a different fragment.
    expect(checkMessageVoice('Oi Ana, isso é relativo à sua conversa com o agente. Podemos falar?', 'Ana', 'ANNUAL_REVIEW').ok).toBe(true)
  })

  it('still refuses a message that asserts the policy is active', () => {
    // Boundaries remove the false positives, but the claim itself is still
    // invented and still blocked.
    expect(checkMessageVoice('Oi Ana, sua apólice está ativa. Podemos conversar?', 'Ana', 'LAPSE_RECOVERY'))
      .toMatchObject({ ok: false, reason: 'MENTIONS_BUSINESS' })
  })
})
