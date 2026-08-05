import { describe, expect, it } from 'vitest'
import * as extension from '../../../apps/keeprone-connect/lib/failure'
import * as web from './connector-failure'

/// O texto do popup e o do cartão são escritos duas vezes de propósito —
/// superfícies diferentes, e o pacote da extensão não importa de `lib/`. O que
/// não pode divergir é a classificação: se um código conta como "reconectar" de
/// um lado e "tentar de novo" do outro, o agente recebe duas instruções
/// contraditórias para a mesma falha. Comentário recíproco não impede isso; este
/// teste impede.
describe('classificação de falha do conector', () => {
  const sets = [
    ['reconnect', web.RECONNECT_CODES, extension.RECONNECT_CODES],
    ['pairing', web.PAIRING_CODES, extension.PAIRING_CODES],
    ['update', web.OUTDATED_CODES, extension.OUTDATED_CODES],
    ['portal', web.PORTAL_CODES, extension.PORTAL_CODES],
  ] as const

  for (const [name, webCodes, extensionCodes] of sets) {
    it(`é idêntica nos dois mapas para a classe ${name}`, () => {
      expect([...webCodes].sort()).toEqual([...extensionCodes].sort())
    })
  }

  it('não classifica o mesmo código em duas classes', () => {
    const all = [
      ...web.RECONNECT_CODES,
      ...web.PAIRING_CODES,
      ...web.OUTDATED_CODES,
      ...web.PORTAL_CODES,
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('não promete reconexão a um computador que nunca conectou', () => {
    // "Reconnect" repetiria o passo que acabou de falhar, com o mesmo texto e o
    // mesmo botão. É a forma exata do laço, uma classe adiante.
    expect(web.connectorFailure('PAIRING_REJECTED').action).toBe('pairing')
    expect(web.connectorFailure('PAIRING_REJECTED').message).not.toMatch(/no longer connected/i)
    expect(web.RECONNECT_CODES).not.toContain('PAIRING_REJECTED')
  })

  it('só a revogação explícita destrói o material local', () => {
    expect(extension.revokesDevice('DEVICE_REVOKED')).toBe(true)
    // Um 401 genérico cobre relógio fora da janela e soluço de banco. Apagar a
    // chave por causa dele recria o laço: o desvio persiste depois de reparear.
    expect(extension.revokesDevice('DEVICE_REQUEST_REJECTED')).toBe(false)
    expect(extension.revokesDevice('DEVICE_KEY_UNAVAILABLE')).toBe(false)
  })

  it('concorda em qual ação cada código pede', () => {
    for (const code of [
      ...web.RECONNECT_CODES,
      ...web.PAIRING_CODES,
      ...web.OUTDATED_CODES,
      ...web.PORTAL_CODES,
    ]) {
      expect(web.connectorFailure(code).action).toBe(extension.connectorFailure(code).action)
    }
  })
})
