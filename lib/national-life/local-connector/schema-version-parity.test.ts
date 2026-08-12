import { describe, expect, it } from 'vitest'
import { CONNECTOR_SCHEMA_VERSION } from '../../../apps/keeprone-connect/lib/contract'
import {
  LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS,
  LOCAL_CONNECTOR_SCHEMA_VERSION,
  isAcceptedLocalConnectorSchemaVersion,
  localConnectorRawStageEnvelopeSchema,
} from './contracts'

const envelope = (schemaVersion: number) => ({
  schemaVersion,
  runId: 'run_1',
  gridKey: 'NEW_BUSINESS',
  sequence: 0,
  ...(schemaVersion >= 3 ? { sourceOffset: 0, nextOffset: 0 } : {}),
  observedAt: '2026-01-01T00:00:00.000Z',
  recordsTotal: 0,
  truncated: false,
  records: [],
})

describe('janela de versões de schema do conector', () => {
  it('aceita a versão que a extensão instalada realmente emite', () => {
    // O teste que importa. A extensão do agente não atualiza quando queremos:
    // Chrome checa a cada 5h e só instala com o worker ocioso. Se o servidor
    // deixar de aceitar o número que ela emite, a frota inteira para por dias.
    expect(isAcceptedLocalConnectorSchemaVersion(CONNECTOR_SCHEMA_VERSION)).toBe(true)
    expect(
      localConnectorRawStageEnvelopeSchema.safeParse(envelope(CONNECTOR_SCHEMA_VERSION)).success,
    ).toBe(true)
  })

  it('aceita todas as versões da janela, não só a corrente', () => {
    for (const version of LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS) {
      expect(localConnectorRawStageEnvelopeSchema.safeParse(envelope(version)).success).toBe(true)
    }
  })

  it('emite uma versão que está dentro da própria janela', () => {
    expect(isAcceptedLocalConnectorSchemaVersion(LOCAL_CONNECTOR_SCHEMA_VERSION)).toBe(true)
  })

  it('recusa o que está fora da janela', () => {
    expect(isAcceptedLocalConnectorSchemaVersion(1)).toBe(false)
    expect(localConnectorRawStageEnvelopeSchema.safeParse(envelope(1)).success).toBe(false)
    expect(localConnectorRawStageEnvelopeSchema.safeParse(envelope(99)).success).toBe(false)
  })

  it('a janela nunca é vazia', () => {
    expect(LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS.length).toBeGreaterThan(0)
  })
})
