import { describe, expect, it } from 'vitest'
import { checkBirthdayVoice, MAX_LENGTH } from './birthday-voice'

const ok = (text: string) => checkBirthdayVoice(text, 'Ana')

describe('checkBirthdayVoice', () => {
  it('accepts a warm greeting that is only a greeting', () => {
    expect(ok('Ana, feliz aniversário! Que o seu dia seja leve e cheio de gente querida por perto.'))
      .toEqual({ ok: true, text: 'Ana, feliz aniversário! Que o seu dia seja leve e cheio de gente querida por perto.' })
  })

  it('collapses the whitespace a model likes to add', () => {
    const checked = ok('  Ana,   feliz aniversário!\n\nAproveite muito o seu dia. ')
    expect(checked).toMatchObject({ ok: true })
    expect(checked.ok && checked.text).toBe('Ana, feliz aniversário! Aproveite muito o seu dia.')
  })

  it('refuses a greeting that forgot who it is for', () => {
    // Addressed to nobody reads like a broadcast, which is the one thing this
    // must not look like.
    expect(ok('Feliz aniversário! Um ótimo dia para você.')).toEqual({ ok: false, reason: 'NAME_MISSING' })
  })

  it('refuses any digit, because none of them are safe to invent', () => {
    // An age, a year, an amount — all wrong in different ways, all avoidable by
    // a greeting that needs no number at all.
    expect(ok('Ana, feliz 40 anos!')).toEqual({ ok: false, reason: 'CONTAINS_NUMBER' })
  })

  it('refuses anything about the business', () => {
    expect(ok('Ana, feliz aniversário! Aproveite para revisar sua apólice comigo.'))
      .toEqual({ ok: false, reason: 'MENTIONS_BUSINESS' })
    // Accent-insensitive, because the model will not be consistent about them.
    expect(ok('Ana, feliz aniversario! Falamos sobre o premio depois.'))
      .toEqual({ ok: false, reason: 'MENTIONS_BUSINESS' })
  })

  it('refuses links and leftover placeholders', () => {
    expect(ok('Ana, parabéns! Veja em https://exemplo.com')).toEqual({ ok: false, reason: 'CONTAINS_LINK' })
    expect(ok('Ana, parabéns! {{nome}}')).toEqual({ ok: false, reason: 'CONTAINS_PLACEHOLDER' })
  })

  it('refuses a greeting too long for a message bubble', () => {
    expect(ok(`Ana, ${'parabéns '.repeat(40)}`)).toEqual({ ok: false, reason: 'TOO_LONG' })
    expect(ok('Ana!')).toEqual({ ok: false, reason: 'TOO_SHORT' })
    expect(ok('   ')).toEqual({ ok: false, reason: 'EMPTY' })
  })

  it('matches the name whatever the model does to its accents or case', () => {
    expect(checkBirthdayVoice('joão, feliz aniversário! Tudo de bom para você hoje.', 'João'))
      .toMatchObject({ ok: true })
  })

  it('keeps the limit where a greeting still fits one bubble', () => {
    expect(MAX_LENGTH).toBeLessThanOrEqual(300)
  })
})
