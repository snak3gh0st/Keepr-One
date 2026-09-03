import { describe, expect, it } from 'vitest'
import {
  parseAbortGridMessage,
  parseBeginGridMessage,
  parseBridgeMessage,
  parseExternalMessage,
  parseProbeAuthAck,
  parseProbeAuthMessage,
  parseBeginExportMessage,
  parseBeginDocumentMessage,
  parseCapturePolicyDetailAck,
  parseCapturePolicyDetailMessage,
  parseExecuteFlexLifeQuoteMessage,
  parseFlexLifeQuoteMainResult,
} from './messages'

const flexLifeQuoteSnapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_quote_1',
  request: {
    IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
    IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
    Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
    Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
  },
} as const

describe('message validation', () => {
  it('accepts exact external messages and rejects extra properties', () => {
    const valid = {
      type: 'PAIR_CONNECTOR',
      code: 'abcdefgh',
      label: 'Meu navegador',
      baseUrl: 'https://app.keeprone.com',
    }
    expect(parseExternalMessage(valid)).toEqual(valid)
    expect(parseExternalMessage({ ...valid, secret: 'unexpected' })).toBeNull()
    expect(parseExternalMessage({ type: 'START_NATIONAL_LIFE_SYNC' })).toEqual({
      type: 'START_NATIONAL_LIFE_SYNC',
    })
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_SYNC',
      forceRefresh: true,
    })).toEqual({ type: 'START_NATIONAL_LIFE_SYNC', forceRefresh: true })
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_SYNC',
      forceRefresh: false,
    })).toBeNull()
    expect(parseExternalMessage({ type: 'GET_CONNECTOR_STATUS' })).toEqual({
      type: 'GET_CONNECTOR_STATUS',
    })
    expect(parseExternalMessage({ type: 'UNPAIR_CONNECTOR' })).toEqual({
      type: 'UNPAIR_CONNECTOR',
    })
    expect(parseExternalMessage({
      type: 'FETCH_NATIONAL_LIFE_DOCUMENT',
      reportRowId: 'report_row-1',
    })).toEqual({ type: 'FETCH_NATIONAL_LIFE_DOCUMENT', reportRowId: 'report_row-1' })
    expect(parseExternalMessage({
      type: 'FETCH_NATIONAL_LIFE_DOCUMENT',
      reportRowId: '../other-agent-row',
    })).toBeNull()
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_COMMAND',
      commandId: 'cmd_policy_1',
    })).toEqual({ type: 'START_NATIONAL_LIFE_COMMAND', commandId: 'cmd_policy_1' })
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_COMMAND',
      commandId: '../cmd',
    })).toBeNull()
    expect(parseExternalMessage({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
      username: 'must-not-cross',
      password: 'must-not-cross',
    })).toBeNull()
    expect(parseBridgeMessage({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
      token: 't'.repeat(32),
      correlationId: 'c'.repeat(16),
      password: 'must-not-cross',
    })).toBeNull()
  })

  const rawChunk = {
    type: 'GRID_CHUNK',
    gridKey: 'NEW_BUSINESS',
    token: 'a'.repeat(64),
    correlationId: '12345678-1234-4123-8123-123456789012',
    sequence: 0,
    recordsTotal: 1,
    truncated: false,
    records: [{ PolicyNo: 'P-1', InsuredName: '<b>Ana</b>', Nested: { a: [1, 2] } }],
  }

  it('accepts raw carrier rows without normalizing them', () => {
    expect(parseBridgeMessage(rawChunk)).toEqual(rawChunk)
  })

  it('accepts a grid key it has never seen before', () => {
    const chunk = { ...rawChunk, gridKey: 'PAID_COMMISSIONS' }
    expect(parseBridgeMessage(chunk)).toEqual(chunk)
  })

  it('rejects a grid key outside the label charset', () => {
    expect(parseBridgeMessage({ ...rawChunk, gridKey: 'new-business' })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, gridKey: 'X'.repeat(65) })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, gridKey: '' })).toBeNull()
  })

  it('rejects rows that are not plain objects', () => {
    expect(parseBridgeMessage({ ...rawChunk, records: [['P-1']] })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, records: ['P-1'] })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, records: [null] })).toBeNull()
  })

  it('keeps the size limits on raw chunks', () => {
    const fatRow = { Blob: 'x'.repeat(17 * 1024) }
    expect(parseBridgeMessage({ ...rawChunk, records: [fatRow] })).toBeNull()
    const longKey = { ['k'.repeat(129)]: 'x' }
    expect(parseBridgeMessage({ ...rawChunk, records: [longKey] })).toBeNull()
    const tooMany = Array.from({ length: 201 }, () => ({ PolicyNo: 'P' }))
    expect(
      parseBridgeMessage({ ...rawChunk, records: tooMany, recordsTotal: 201 }),
    ).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, recordsTotal: 200_001 })).toBeNull()
  })

  it('rejects oversized and unknown bridge messages', () => {
    expect(
      parseBridgeMessage({
        type: 'GRID_DONE',
        gridKey: 'NEW_BUSINESS',
        token: 'short',
        correlationId: 'also-short',
      }),
    ).toBeNull()
    expect(parseBridgeMessage({ type: 'OTHER' })).toBeNull()
  })
})

describe('official correspondence document messages', () => {
  const identity = {
    transferId: 'transfer_1',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }
  const encryptedHandle = 'ZW5jcnlwdGVkLWNhcnJpZXItaGFuZGxlLTEyMw=='

  it('accepts the sealed carrier handle and bounded PDF transfer', () => {
    expect(parseBeginDocumentMessage({
      type: 'BEGIN_DOCUMENT',
      ...identity,
      encryptedHandle,
    })).not.toBeNull()
    expect(parseBridgeMessage({
      type: 'DOCUMENT_BEGIN',
      ...identity,
      contentType: 'application/pdf',
      expectedBytes: 5,
      expectedSha256: 'a'.repeat(64),
    })).not.toBeNull()
    expect(parseBridgeMessage({
      type: 'DOCUMENT_CHUNK',
      ...identity,
      sequence: 0,
      bytes: [37, 80, 68, 70, 45],
    })).not.toBeNull()
    expect(parseBridgeMessage({ type: 'DOCUMENT_DONE', ...identity })).not.toBeNull()
  })

  it('rejects loose handles, executable payloads and extra fields', () => {
    expect(parseBeginDocumentMessage({
      type: 'BEGIN_DOCUMENT',
      ...identity,
      encryptedHandle: '../document.pdf',
    })).toBeNull()
    expect(parseBeginDocumentMessage({
      type: 'BEGIN_DOCUMENT',
      ...identity,
      encryptedHandle: 'a'.repeat(2_052),
    })).toBeNull()
    expect(parseBridgeMessage({
      type: 'DOCUMENT_BEGIN',
      ...identity,
      contentType: 'application/octet-stream',
      expectedBytes: 5,
      expectedSha256: 'a'.repeat(64),
    })).toBeNull()
    expect(parseBridgeMessage({
      type: 'DOCUMENT_DONE',
      ...identity,
      downloadUrl: 'https://attacker.example/file',
    })).toBeNull()
  })
})

describe('grid control messages', () => {
  const base = {
    gridKey: 'NEW_BUSINESS',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }

  it('accepts a well-formed order to begin and to abort', () => {
    expect(parseBeginGridMessage({ type: 'BEGIN_GRID', ...base })).toEqual({
      type: 'BEGIN_GRID',
      ...base,
    })
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base })).toEqual({
      type: 'ABORT_GRID',
      ...base,
    })
  })

  it('never confuses one order for the other', () => {
    // O extrator arma a bandeira de parada com o que este parser aceitar. Se ele
    // aceitasse um BEGIN_GRID, mandar começar viraria mandar parar.
    expect(parseAbortGridMessage({ type: 'BEGIN_GRID', ...base })).toBeNull()
    expect(parseBeginGridMessage({ type: 'ABORT_GRID', ...base })).toBeNull()
  })

  it('rejects an abort order that cannot identify an extraction', () => {
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, extra: 1 })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, token: 'short' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, correlationId: 'tiny' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, gridKey: 'new business' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID' })).toBeNull()
    expect(parseAbortGridMessage(null)).toBeNull()
  })
})

describe('authentication probe messages', () => {
  const probe = {
    type: 'PROBE_AUTH',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }

  it('accepts only an exact probe and correlated result', () => {
    expect(parseProbeAuthMessage(probe)).toEqual(probe)
    expect(parseProbeAuthMessage({ ...probe, extra: true })).toBeNull()
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: probe.token,
      correlationId: probe.correlationId,
      authenticated: true,
    })).toMatchObject({ authenticated: true })
  })

  it('rejects an unbounded or ambiguous result', () => {
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: 'short',
      correlationId: probe.correlationId,
      authenticated: true,
    })).toBeNull()
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: probe.token,
      correlationId: probe.correlationId,
      authenticated: 'yes',
    })).toBeNull()
  })
})

describe('policy detail messages', () => {
  const navigatePath = `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`
  const identity = { token: 't'.repeat(32), correlationId: 'c'.repeat(16) }

  it('accepts only an exact, server-authorized policy detail capture', () => {
    const message = {
      type: 'CAPTURE_POLICY_DETAIL',
      expectedPolicyNumber: 'LS1473219',
      navigatePath,
      ...identity,
    }
    expect(parseCapturePolicyDetailMessage(message)).toEqual(message)
    expect(parseCapturePolicyDetailMessage({
      ...message, navigatePath: `${navigatePath}&next=/agent/x`,
    })).toBeNull()
    expect(parseCapturePolicyDetailMessage({ ...message, password: 'no' })).toBeNull()
  })

  it('accepts only approved fields in a bounded correlated response', () => {
    const detail = {
      navigatePath,
      expectedPolicyNumber: 'LS1473219',
      visiblePolicyNumber: 'LS1473219',
      observedAt: '2026-08-26T17:00:00.000Z',
      fields: [
        { section: 'COVERAGE', label: 'Base Face Amount', value: '$100,000.00' },
        { section: 'PAYMENTS', label: 'Anticipated Annual Premium', value: '$5,100.00' },
      ],
    }
    const response = { ok: true, type: 'POLICY_DETAIL_CAPTURED', ...identity, detail }
    expect(parseCapturePolicyDetailAck(response)).toEqual(response)
    expect(parseCapturePolicyDetailAck({
      ...response,
      detail: { ...detail, fields: [{ section: 'COVERAGE', label: 'Insured Name', value: 'Private' }] },
    })).toBeNull()
  })
})

describe('official export messages', () => {
  const identity = {
    gridKey: 'INFORCE_CLIENTS',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }

  it('accepts the sealed export order and bounded XLSX chunks', () => {
    expect(parseBeginExportMessage({
      type: 'BEGIN_EXPORT',
      sourceKey: 'INFORCE_CLIENTS',
      token: identity.token,
      correlationId: identity.correlationId,
    })).not.toBeNull()
    expect(parseBridgeMessage({
      type: 'EXPORT_BEGIN',
      ...identity,
      fileName: 'NLG_InforceClientInfo_08132026.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expectedBytes: 4,
      expectedSha256: 'a'.repeat(64),
    })).not.toBeNull()
    expect(parseBridgeMessage({ type: 'EXPORT_CHUNK', ...identity, sequence: 0, bytes: [80, 75, 3, 4] })).not.toBeNull()
    expect(parseBridgeMessage({ type: 'EXPORT_DONE', ...identity })).not.toBeNull()
  })

  it('refuses another source, oversized chunks, and executable content', () => {
    expect(parseBeginExportMessage({
      type: 'BEGIN_EXPORT', sourceKey: 'NEW_BUSINESS', token: identity.token,
      correlationId: identity.correlationId,
    })).toBeNull()
    expect(parseBridgeMessage({
      type: 'EXPORT_BEGIN', ...identity, fileName: 'payload.exe',
      contentType: 'application/octet-stream', expectedBytes: 4, expectedSha256: 'a'.repeat(64),
    })).toBeNull()
    expect(parseBridgeMessage({
      type: 'EXPORT_CHUNK', ...identity, sequence: 0,
      bytes: Array.from({ length: 1024 * 1024 + 1 }, () => 0),
    })).toBeNull()
  })
})

describe('FlexLife quote page messages', () => {
  const identity = {
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
    inputHash: 'a'.repeat(64),
  }

  it('accepts only an exact, hashed quote order', () => {
    const message = {
      type: 'EXECUTE_FLEXLIFE_QUOTE',
      ...identity,
      snapshot: flexLifeQuoteSnapshot,
    }
    expect(parseExecuteFlexLifeQuoteMessage(message)).toEqual(message)
    expect(parseExecuteFlexLifeQuoteMessage({ ...message, endpoint: 'https://evil.example' })).toBeNull()
    expect(parseExecuteFlexLifeQuoteMessage({ ...message, inputHash: 'short' })).toBeNull()
  })

  it('accepts bounded correlated carrier results and safe failures', () => {
    const response = { Success: true, AnnualPremium: 5100 }
    expect(parseFlexLifeQuoteMainResult({
      type: 'FLEXLIFE_QUOTE_DONE', ...identity, response,
    })).toEqual({ type: 'FLEXLIFE_QUOTE_DONE', ...identity, response })
    expect(parseFlexLifeQuoteMainResult({
      type: 'FLEXLIFE_QUOTE_ERROR', ...identity, code: 'PORTAL_REQUEST_FAILED',
    })).not.toBeNull()
    expect(parseFlexLifeQuoteMainResult({
      type: 'FLEXLIFE_QUOTE_DONE', ...identity, response: { blob: 'x'.repeat(17_000) },
    })).toBeNull()
    expect(parseFlexLifeQuoteMainResult({
      type: 'FLEXLIFE_QUOTE_ERROR', ...identity, code: 'RAW_NETWORK_ERROR',
    })).toBeNull()
  })
})
