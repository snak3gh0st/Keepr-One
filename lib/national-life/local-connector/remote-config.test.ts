import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_CONNECTOR_STATE_HEADER,
  LOCAL_CONNECTOR_VERSION_HEADER,
  compareConnectorVersions,
  enforceLocalConnectorClientFloor,
  getLocalConnectorRemoteConfig,
  isCapabilityDisabled,
  parseConnectorVersion,
  readReportedClientVersion,
  refuseLocalConnectorRequest,
} from './remote-config'

const ENV_KEYS = [
  'NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED',
  'NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES',
  'NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION',
  'NATIONAL_LIFE_LOCAL_CONNECTOR_HEARTBEAT_SECONDS',
] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

const headers = (version?: string) =>
  new Headers(version ? { [LOCAL_CONNECTOR_VERSION_HEADER]: version } : {})

describe('versão reportada pelo cliente', () => {
  it('lê a versão do cabeçalho quando ela tem forma de versão', () => {
    expect(readReportedClientVersion(headers('0.1.0'))).toBe('0.1.0')
    expect(readReportedClientVersion(headers('1.2.3.4'))).toBe('1.2.3.4')
  })

  it('trata como ausente qualquer coisa que não seja versão', () => {
    // Auto-declarada e não confiável: nada que venha daqui pode virar caminho,
    // chave de storage ou consulta. Ou é versão, ou é nada.
    expect(readReportedClientVersion(headers('0.1.0-beta'))).toBeNull()
    expect(readReportedClientVersion(headers('../../etc'))).toBeNull()
    expect(readReportedClientVersion(headers('a'.repeat(64)))).toBeNull()
    expect(readReportedClientVersion(headers())).toBeNull()
  })

  it('compara campo a campo, não como texto', () => {
    expect(compareConnectorVersions(parseConnectorVersion('0.10.0')!, parseConnectorVersion('0.9.0')!)).toBe(1)
    expect(compareConnectorVersions(parseConnectorVersion('1.0')!, parseConnectorVersion('1.0.0.0')!)).toBe(0)
    expect(compareConnectorVersions(parseConnectorVersion('0.1.0')!, parseConnectorVersion('0.1.1')!)).toBe(-1)
  })
})

describe('piso de versão', () => {
  it('não recusa nada quando não há piso configurado', () => {
    // O piloto atual é unpacked e não carimba versão. Piso é opt-in.
    expect(enforceLocalConnectorClientFloor(headers())).toBeNull()
    expect(enforceLocalConnectorClientFloor(headers('0.0.1'))).toBeNull()
  })

  it('recusa abaixo do piso com 426 e diz qual é o piso', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '0.2.0'
    const response = enforceLocalConnectorClientFloor(headers('0.1.9'))
    expect(response?.status).toBe(426)
    expect(await response!.json()).toEqual({ error: 'CLIENT_TOO_OLD', minVersion: '0.2.0' })
    expect(response!.headers.get('Cache-Control')).toBe('no-store')
  })

  it('recusa quem não se identifica quando há piso', () => {
    // Velho demais para dizer a própria versão é exatamente o caso que o piso existe
    // para barrar. Aceitar por omissão daria a qualquer cliente uma saída trivial.
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '0.2.0'
    expect(enforceLocalConnectorClientFloor(headers())?.status).toBe(426)
    expect(enforceLocalConnectorClientFloor(headers('lixo'))?.status).toBe(426)
  })

  it('aceita no piso e acima dele', () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '0.2.0'
    expect(enforceLocalConnectorClientFloor(headers('0.2.0'))).toBeNull()
    expect(enforceLocalConnectorClientFloor(headers('0.10.0'))).toBeNull()
  })

  it('falha alto se o piso configurado não for uma versão', () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = 'ontem'
    expect(() => getLocalConnectorRemoteConfig()).toThrow(/MIN_VERSION/)
  })
})

describe('kill switch', () => {
  it('está ligado por padrão', () => {
    expect(getLocalConnectorRemoteConfig().syncEnabled).toBe(true)
  })

  it('pausa o conector inteiro com 503 e um estado distinguível', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED = 'true'
    const response = refuseLocalConnectorRequest(headers('9.9.9'))
    expect(response?.status).toBe(503)
    expect(response!.headers.get(LOCAL_CONNECTOR_STATE_HEADER)).toBe('PAUSED')
    expect(await response!.json()).toEqual({ error: 'CONNECTOR_PAUSED' })
  })

  it('só a string exata pausa', () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED = 'TRUE'
    expect(getLocalConnectorRemoteConfig().syncEnabled).toBe(true)
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED = ''
    expect(getLocalConnectorRemoteConfig().syncEnabled).toBe(true)
  })

  it('pausa ganha do piso', () => {
    // Atualizar não desbloqueia um conector pausado. Dizer "atualize" mandaria o
    // agente fazer um trabalho que não muda nada.
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED = 'true'
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '9.0.0'
    expect(refuseLocalConnectorRequest(headers('0.1.0'))?.status).toBe(503)
  })

  it('desliga uma capacidade sem derrubar o conector', () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES = 'read_grid'
    expect(isCapabilityDisabled('READ_GRID')).toBe(true)
    expect(getLocalConnectorRemoteConfig().syncEnabled).toBe(true)
  })

  it('ignora nomes de capacidade que não existem', () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES = 'READ_GRID, FOO'
    expect(getLocalConnectorRemoteConfig().disabledCapabilities).toEqual(['READ_GRID'])
  })
})

describe('heartbeat', () => {
  it('tem padrão e limites', () => {
    expect(getLocalConnectorRemoteConfig().heartbeatSeconds).toBe(300)
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_HEARTBEAT_SECONDS = '1'
    expect(getLocalConnectorRemoteConfig().heartbeatSeconds).toBe(60)
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_HEARTBEAT_SECONDS = '999999'
    expect(getLocalConnectorRemoteConfig().heartbeatSeconds).toBe(3600)
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_HEARTBEAT_SECONDS = 'nunca'
    expect(getLocalConnectorRemoteConfig().heartbeatSeconds).toBe(300)
  })
})

describe('quem fica de fora da recusa', () => {
  const read = (relative: string) =>
    readFileSync(
      resolve(__dirname, '../../../app/api/agent/integrations/national-life/local-connector', relative),
      'utf8',
    )

  it('as rotas de trabalho recusam', () => {
    expect(read('runs/route.ts')).toContain('refuseLocalConnectorCapability')
    expect(read('runs/[runId]/stages/[gridKey]/route.ts')).toContain(
      'refuseLocalConnectorCapability',
    )
  })

  it('encerrar um run aberto e revogar um dispositivo nunca são recusados', () => {
    // Um cliente abaixo do piso ainda precisa conseguir fechar o run dele. Recusar
    // aqui trocaria uma falha rápida por um run RUNNING pendurado até o TTL — e a
    // pausa faria o mesmo com a frota inteira de uma vez. Revogação, idem: desligar
    // o conector não pode impedir um agente de desconectar um computador.
    expect(read('runs/[runId]/fail/route.ts')).not.toContain('refuseLocalConnector')
    expect(read('devices/[deviceId]/revoke/route.ts')).not.toContain('refuseLocalConnector')
  })
})
