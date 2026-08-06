import { describe, expect, it } from 'vitest'
import { authorizeJanitorRequest } from './janitor-auth'

const SECRET = 'x'.repeat(48)

describe('janitor route authorization', () => {
  it('reports the route as unconfigured when no secret is set', () => {
    expect(authorizeJanitorRequest(`Bearer ${SECRET}`, undefined)).toBe('NOT_CONFIGURED')
    expect(authorizeJanitorRequest(`Bearer ${SECRET}`, '   ')).toBe('NOT_CONFIGURED')
  })

  it('refuses a secret too short to be worth guarding', () => {
    // Um segredo curto configurado por engano abriria um DELETE de produção com
    // a aparência de estar protegido.
    expect(authorizeJanitorRequest('Bearer short', 'short')).toBe('NOT_CONFIGURED')
  })

  it('accepts the configured secret', () => {
    expect(authorizeJanitorRequest(`Bearer ${SECRET}`, SECRET)).toBe('OK')
  })

  it('denies a wrong secret, a missing header and a wrong scheme', () => {
    expect(authorizeJanitorRequest(`Bearer ${'y'.repeat(48)}`, SECRET)).toBe('DENIED')
    expect(authorizeJanitorRequest(null, SECRET)).toBe('DENIED')
    expect(authorizeJanitorRequest(SECRET, SECRET)).toBe('DENIED')
    expect(authorizeJanitorRequest('Bearer ', SECRET)).toBe('DENIED')
  })

  it('denies a presented secret of a different length without throwing', () => {
    // `timingSafeEqual` lança em tamanhos diferentes; comparar digests é o que
    // impede esse lançamento de virar um oráculo do tamanho do segredo.
    expect(() => authorizeJanitorRequest('Bearer a', SECRET)).not.toThrow()
    expect(authorizeJanitorRequest('Bearer a', SECRET)).toBe('DENIED')
  })
})
