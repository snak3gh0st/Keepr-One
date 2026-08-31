import { describe, expect, it } from 'vitest'
import { commandExecutorFor } from './command-executor'

describe('commandExecutorFor', () => {
  it('routes only capabilities with a real browser executor', () => {
    expect(commandExecutorFor('READ_POLICY_DETAIL')).toBe('POLICY_DETAIL')
    expect(commandExecutorFor('FLEXLIFE_QUOTE')).toBe('FLEXLIFE_QUOTE')
    expect(commandExecutorFor('GENERATE_ILLUSTRATION')).toBe('FORESIGHT')
    expect(commandExecutorFor('PREPARE_APPLICATION_DRAFT')).toBe('IGO_APPLICATION_DRAFT')
  })

  it('keeps document upload and final submission disabled', () => {
    expect(() => commandExecutorFor('UPLOAD_APPLICATION_DOCUMENT'))
      .toThrow('CAPABILITY_NOT_IMPLEMENTED')
    expect(() => commandExecutorFor('SUBMIT_APPLICATION'))
      .toThrow('CAPABILITY_NOT_IMPLEMENTED')
  })

  it('never treats an unknown capability as policy detail', () => {
    expect(() => commandExecutorFor('UNKNOWN')).toThrow('CAPABILITY_NOT_IMPLEMENTED')
  })
})
