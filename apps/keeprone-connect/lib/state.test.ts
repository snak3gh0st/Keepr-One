import { describe, expect, it } from 'vitest'
import { parseCommandState } from './state'

describe('parseCommandState', () => {
  it('keeps valid durable coordination metadata across extension restarts', () => {
    expect(parseCommandState({
      status: 'RUNNING', commandId: 'command_1', runId: 'run_1', carrierTabId: 12,
      nextEventSequence: 3, phase: 'VERIFYING_VALUES', updatedAt: '2026-08-31T20:00:00.000Z',
    })).toEqual({
      status: 'RUNNING', commandId: 'command_1', runId: 'run_1', carrierTabId: 12,
      nextEventSequence: 3, phase: 'VERIFYING_VALUES', updatedAt: '2026-08-31T20:00:00.000Z',
    })
  })

  it('degrades an unknown stored shape to idle instead of executing it', () => {
    expect(parseCommandState({ status: 'STEAL_PASSWORD', carrierTabId: 12 })).toEqual({ status: 'IDLE' })
    expect(parseCommandState('RUNNING')).toEqual({ status: 'IDLE' })
  })

  it('drops malformed optional fields without discarding a valid status', () => {
    expect(parseCommandState({
      status: 'AUTH_REQUIRED', commandId: '', runId: 'run_1', carrierTabId: -1,
      nextEventSequence: -2, phase: 'UNKNOWN_PHASE', errorCode: '<html>', updatedAt: 'yesterday',
    })).toEqual({ status: 'AUTH_REQUIRED', runId: 'run_1' })
  })
})
