import { describe, expect, it } from 'vitest'
import { planApplicationDraftCommand, planApplicationSubmitCommand } from './command-plan'

const reviewed = {
  id: 'app_1',
  automationState: 'READY_TO_PREPARE',
  dossierHash: 'a'.repeat(64),
  reviewedAt: new Date('2026-08-30T12:00:00.000Z'),
  externalId: null,
  carrierReceipt: null,
}

describe('Application command plan', () => {
  it('binds draft preparation to the reviewed dossier hash', () => {
    expect(planApplicationDraftCommand(reviewed, {
      agentId: 'agent_1', entitled: true,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toEqual(expect.objectContaining({
      agentId: 'agent_1',
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'app_1' },
      params: { applicationId: 'app_1', payloadHash: 'a'.repeat(64) },
      idempotencyKey: `igo:draft:app_1:${'a'.repeat(64)}`,
    }))
  })

  it('denies draft preparation without entitlement, review, or matching state', () => {
    expect(() => planApplicationDraftCommand(reviewed, {
      agentId: 'agent_1', entitled: false,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toThrow('K_BOT_APPLICATION_ADDON_REQUIRED')
    expect(() => planApplicationDraftCommand({ ...reviewed, dossierHash: null }, {
      agentId: 'agent_1', entitled: true,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toThrow('APPLICATION_NOT_REVIEWED')
    expect(() => planApplicationDraftCommand({ ...reviewed, automationState: 'COLLECTING' }, {
      agentId: 'agent_1', entitled: true,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toThrow('APPLICATION_NOT_READY')
  })

  it('requires a carrier draft and a second payload hash for submission', () => {
    const draftReady = {
      ...reviewed,
      automationState: 'READY_TO_SUBMIT',
      externalId: 'IGO-123',
      carrierReceipt: { draftReadBackHash: 'b'.repeat(64) },
    }
    expect(planApplicationSubmitCommand(draftReady, {
      agentId: 'agent_1', entitled: true,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toMatchObject({
      capability: 'SUBMIT_APPLICATION',
      params: { applicationId: 'app_1', payloadHash: 'b'.repeat(64) },
      idempotencyKey: `igo:submit:app_1:${'b'.repeat(64)}`,
    })
  })

  it('never submits from a draft receipt without a verified read-back hash', () => {
    expect(() => planApplicationSubmitCommand({
      ...reviewed,
      automationState: 'READY_TO_SUBMIT',
      externalId: 'IGO-123',
      carrierReceipt: {},
    }, {
      agentId: 'agent_1', entitled: true,
      expiresAt: new Date('2026-08-30T13:00:00.000Z'),
    })).toThrow('APPLICATION_CARRIER_READBACK_REQUIRED')
  })
})
