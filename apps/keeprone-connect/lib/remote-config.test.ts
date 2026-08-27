import { describe, expect, it } from 'vitest'
import { classifyFailedResponse } from './signed-client'
import {
  PERMISSIVE_REMOTE_CONFIG,
  isRemoteConfigStale,
  parseRemoteConfig,
} from './remote-config'

describe('configuração remota lida pela extensão', () => {
  it('só o booleano exato pausa', () => {
    // Uma resposta que não entendemos não é motivo para parar. Um proxy que
    // devolva HTML, um campo renomeado, um null — nada disso é "pausado".
    expect(parseRemoteConfig({ syncEnabled: false }).syncEnabled).toBe(false)
    expect(parseRemoteConfig({ syncEnabled: 'false' }).syncEnabled).toBe(true)
    expect(parseRemoteConfig({}).syncEnabled).toBe(true)
    expect(parseRemoteConfig(null).syncEnabled).toBe(true)
    expect(parseRemoteConfig('<html>').syncEnabled).toBe(true)
  })

  it('o padrão é permissivo', () => {
    // Servidor inalcançável não pode virar pausa: falha de rede pararia o
    // conector com a frase errada num momento em que ninguém pausou nada.
    expect(PERMISSIVE_REMOTE_CONFIG.syncEnabled).toBe(true)
    expect(parseRemoteConfig(undefined)).toEqual(PERMISSIVE_REMOTE_CONFIG)
  })

  it('filtra capacidades que não têm forma de capacidade', () => {
    expect(
      parseRemoteConfig({ disabledCapabilities: ['READ_GRID', 'a/b', 42, null] })
        .disabledCapabilities,
    ).toEqual(['READ_GRID'])
  })

  it('lê somente capabilities declaradas pelo catálogo', () => {
    expect(
      parseRemoteConfig({
        executableCapabilities: ['READ_GRID', 'FORESIGHT_INVENTORY', 'not-a-capability'],
      }).executableCapabilities,
    ).toEqual(['READ_GRID', 'FORESIGHT_INVENTORY'])
  })

  it('limita o intervalo do batimento', () => {
    expect(parseRemoteConfig({ heartbeatSeconds: 1 }).heartbeatSeconds).toBe(60)
    expect(parseRemoteConfig({ heartbeatSeconds: 1e9 }).heartbeatSeconds).toBe(3600)
    expect(parseRemoteConfig({ heartbeatSeconds: 'logo' }).heartbeatSeconds).toBe(300)
  })

  it('sabe quando o cache venceu', () => {
    const cached = { ...PERMISSIVE_REMOTE_CONFIG, heartbeatSeconds: 300, fetchedAt: 1_000_000 }
    expect(isRemoteConfigStale(undefined, 1_000_000)).toBe(true)
    expect(isRemoteConfigStale(cached, 1_000_000 + 299_999)).toBe(false)
    expect(isRemoteConfigStale(cached, 1_000_000 + 300_000)).toBe(true)
    // Relógio andando para trás: idade desconhecida, reconferir é o lado barato.
    expect(isRemoteConfigStale(cached, 1)).toBe(true)
  })
})

describe('classificação das recusas novas', () => {
  const headers = (value?: string) =>
    new Headers(value ? { 'x-fyntra-connector-state': value } : {})

  it('426 é versão velha, não falha de portal', () => {
    // Sem isto o 426 cairia em DEVICE_REQUEST_FAILED, que é classe "portal" e diz
    // "espere um minuto e tente de novo" — falso, e um laço: nenhuma tentativa
    // futura passa, só atualizar passa.
    expect(classifyFailedResponse(426, headers())).toBe('CLIENT_TOO_OLD')
  })

  it('503 pausado é distinguível de 503 qualquer', () => {
    expect(classifyFailedResponse(503, headers('PAUSED'))).toBe('CONNECTOR_PAUSED')
    // Um 503 sem a afirmação do servidor é servidor fora do ar, e isso é retry.
    expect(classifyFailedResponse(503, headers())).toBe('DEVICE_REQUEST_FAILED')
  })

  it('não mexe na distinção que autoriza apagar a chave', () => {
    expect(classifyFailedResponse(401, new Headers({ 'x-fyntra-device-error': 'DEVICE_REVOKED' })))
      .toBe('DEVICE_REVOKED')
    expect(classifyFailedResponse(401, new Headers({ 'x-fyntra-device-error': 'FOUNDER_ACCESS_REQUIRED' })))
      .toBe('FOUNDER_ACCESS_REQUIRED')
    expect(classifyFailedResponse(401, headers())).toBe('DEVICE_REQUEST_REJECTED')
    expect(classifyFailedResponse(500, headers())).toBe('DEVICE_REQUEST_FAILED')
  })

  it('429 pede espera em vez de fingir falha do portal', () => {
    expect(classifyFailedResponse(429, headers())).toBe('RUN_START_RATE_LIMITED')
  })
})
