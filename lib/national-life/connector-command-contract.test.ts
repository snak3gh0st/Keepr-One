import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_COMMAND_PROTOCOL_VERSION,
  parseConnectorCommand,
  parseConnectorCommandEvent,
} from './connector-command-contract'

const issuedAt = '2026-08-10T20:00:00.000Z'
const expiresAt = '2026-08-10T20:30:00.000Z'

describe('National Life connector command contract', () => {
  it('accepts a closed, safe Foresight read command', () => {
    expect(
      parseConnectorCommand({
        protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
        commandId: 'cmd_1',
        runId: 'run_1',
        capability: 'FORESIGHT_CASE_DETAIL',
        target: { kind: 'CASE', id: 'case_1', carrierExternalId: 'carrier_1' },
        params: { caseKey: 'RP-SMITH-QQ-081026' },
        idempotencyKey: 'case_1:detail:1',
        issuedAt,
        expiresAt,
        requiresConfirmation: false,
      }),
    ).toMatchObject({ capability: 'FORESIGHT_CASE_DETAIL', params: { caseKey: 'RP-SMITH-QQ-081026' } })
  })

  it('refuses an application submission that tries to bypass confirmation', () => {
    expect(
      parseConnectorCommand({
        protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
        commandId: 'cmd_2',
        runId: 'run_2',
        capability: 'SUBMIT_APPLICATION',
        target: { kind: 'APPLICATION', id: 'application_1' },
        params: { applicationId: 'application_1', payloadHash: 'a'.repeat(64) },
        idempotencyKey: 'application_1:submit:1',
        issuedAt,
        expiresAt,
        requiresConfirmation: false,
      }),
    ).toBeNull()
  })

  it('accepts only sequenced events with safe errors', () => {
    expect(
      parseConnectorCommandEvent({
        protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
        eventId: 'event_1',
        commandId: 'cmd_1',
        runId: 'run_1',
        sequence: 1,
        type: 'COMMAND_FAILED',
        emittedAt: issuedAt,
        payload: null,
        error: { code: 'AUTH_REQUIRED', safeMessage: 'Sign in to National Life to continue.' },
      }),
    ).toMatchObject({ type: 'COMMAND_FAILED', sequence: 1 })
  })
})
