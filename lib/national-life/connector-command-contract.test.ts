import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_COMMAND_PROTOCOL_VERSION,
  connectorCapabilityRisk,
  parseConnectorCommand,
  parseConnectorCommandEvent,
  requiresExplicitConfirmation,
} from './connector-command-contract'

const issuedAt = '2026-08-10T20:00:00.000Z'
const expiresAt = '2026-08-10T20:30:00.000Z'

describe('National Life connector command contract', () => {
  it('accepts only the sealed official-export operation', () => {
    const base = {
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_export_1',
      runId: 'run_export_1',
      capability: 'READ_EXPORT',
      target: null,
      idempotencyKey: 'export:payable:1',
      issuedAt,
      expiresAt,
      requiresConfirmation: false,
    }
    expect(parseConnectorCommand({
      ...base,
      params: {
        sourceKey: 'PAYABLE_GROSS_COMMISSIONS',
        navigatePath: '/agent/compensation/commissions/projected-commissions/payable-gross-commissions',
        exportKey: 'DOWNLOAD_ALL',
      },
    })).toMatchObject({ capability: 'READ_EXPORT' })
    expect(parseConnectorCommand({
      ...base,
      params: {
        sourceKey: 'PAYABLE_GROSS_COMMISSIONS',
        navigatePath: '/agent/compensation/commissions/projected-commissions/payable-gross-commissions',
        exportKey: 'CLICK_SELECTOR',
      },
    })).toBeNull()
  })

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

  it('seals a FlexLife quote to its immutable input hash', () => {
    const command = {
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_quote_1',
      runId: 'run_quote_1',
      capability: 'FLEXLIFE_QUOTE',
      target: { kind: 'ILLUSTRATION', id: 'ill_1' },
      params: { illustrationId: 'ill_1', inputHash: 'b'.repeat(64) },
      idempotencyKey: 'ill_1:quote:hash',
      issuedAt,
      expiresAt,
      requiresConfirmation: true,
    }

    expect(parseConnectorCommand(command)).toEqual(command)
    expect(parseConnectorCommand({
      ...command,
      params: { illustrationId: 'ill_1' },
    })).toBeNull()
  })

  it('seals an iGO draft to the reviewed dossier hash', () => {
    const command = {
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_application_1',
      runId: 'run_application_1',
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash: 'c'.repeat(64) },
      idempotencyKey: 'application_1:draft:hash',
      issuedAt,
      expiresAt,
      requiresConfirmation: true,
    }

    expect(parseConnectorCommand(command)).toEqual(command)
    expect(parseConnectorCommand({
      ...command,
      params: { applicationId: 'application_1' },
    })).toBeNull()
  })

  it('seals policy detail reads to the exact carrier detail path', () => {
    const navigatePath = '/agent/book-of-business/inforce-book/all-clients/policy-details?id=a73f1af893a94906b965e68d11db807b'
    const base = {
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_policy_1',
      runId: 'run_policy_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      idempotencyKey: 'policy_1:detail:1',
      issuedAt,
      expiresAt,
      requiresConfirmation: false,
    }

    expect(parseConnectorCommand({
      ...base,
      params: { policyNumber: 'LS1473219', navigatePath },
    })).toMatchObject({
      capability: 'READ_POLICY_DETAIL',
      params: { policyNumber: 'LS1473219', navigatePath },
    })
    expect(parseConnectorCommand({
      ...base,
      params: { policyNumber: 'LS1473219', navigatePath: `${navigatePath}&next=/agent/x` },
    })).toBeNull()
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

  it('keeps navigation automatic but gates every carrier write', () => {
    expect(connectorCapabilityRisk('OPEN_APPLICATION')).toBe('NAVIGATION_ONLY')
    expect(requiresExplicitConfirmation('OPEN_APPLICATION')).toBe(false)

    expect(connectorCapabilityRisk('GENERATE_ILLUSTRATION')).toBe('GENERATES_CARRIER_ARTIFACT')
    expect(requiresExplicitConfirmation('GENERATE_ILLUSTRATION')).toBe(true)

    expect(connectorCapabilityRisk('PREPARE_APPLICATION_DRAFT')).toBe('WRITES_CARRIER_DRAFT')
    expect(requiresExplicitConfirmation('PREPARE_APPLICATION_DRAFT')).toBe(true)

    expect(connectorCapabilityRisk('SUBMIT_APPLICATION')).toBe('SUBMITS_TO_CARRIER')
    expect(requiresExplicitConfirmation('SUBMIT_APPLICATION')).toBe(true)
  })

  it('binds generated illustrations to the exact reviewed input hash', () => {
    const command = {
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_illustration_1',
      runId: 'run_illustration_1',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1', inputHash: 'a'.repeat(64) },
      idempotencyKey: 'illustration_1:generate:hash',
      issuedAt,
      expiresAt,
      requiresConfirmation: true,
    }
    expect(parseConnectorCommand(command)).toMatchObject({
      params: { illustrationId: 'illustration_1', inputHash: 'a'.repeat(64) },
    })
    expect(parseConnectorCommand({
      ...command,
      params: { illustrationId: 'illustration_1' },
    })).toBeNull()
  })

  it('accepts sealed open commands without accepting a URL from the server', () => {
    expect(parseConnectorCommand({
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_igo_1',
      runId: 'run_igo_1',
      capability: 'OPEN_EAPP',
      target: null,
      params: {},
      idempotencyKey: 'igo:open:1',
      issuedAt,
      expiresAt,
      requiresConfirmation: false,
    })).toMatchObject({ capability: 'OPEN_EAPP' })

    expect(parseConnectorCommand({
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_open_1',
      runId: 'run_open_1',
      capability: 'OPEN_POLICY',
      target: { kind: 'POLICY', id: 'policy_1' },
      params: { policyNumber: 'POLICY-1' },
      idempotencyKey: 'policy_1:open:1',
      issuedAt,
      expiresAt,
      requiresConfirmation: false,
    })).toMatchObject({ capability: 'OPEN_POLICY', params: { policyNumber: 'POLICY-1' } })

    expect(parseConnectorCommand({
      protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
      commandId: 'cmd_open_2',
      runId: 'run_open_2',
      capability: 'OPEN_POLICY',
      target: { kind: 'POLICY', id: 'policy_1' },
      params: { url: 'https://evil.example/' },
      idempotencyKey: 'policy_1:open:2',
      issuedAt,
      expiresAt,
      requiresConfirmation: false,
    })).toBeNull()
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
