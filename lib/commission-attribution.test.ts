import { describe, expect, it } from 'vitest'
import { buildCommissionAgentBreakdown } from './commission-attribution'

describe('buildCommissionAgentBreakdown', () => {
  it('separates direct and override values for each National Life producer', () => {
    const result = buildCommissionAgentBreakdown([
      { agentName: 'Ana Souza', agentNumber: 'A-101', type: 'DIRECT', amount: 100 },
      { agentName: 'Ana Souza', agentNumber: 'A101', type: 'OVERRIDE', amount: 25 },
      { agentName: 'Bruno Lima', agentNumber: 'B-202', type: 'OVERRIDE', amount: 300 },
    ])

    expect(result).toEqual([
      {
        key: 'number:B202', agentName: 'Bruno Lima', agentNumber: 'B202',
        directAmount: 0, directCount: 0, overrideAmount: 300, overrideCount: 1, totalAmount: 300,
      },
      {
        key: 'number:A101', agentName: 'Ana Souza', agentNumber: 'A101',
        directAmount: 100, directCount: 1, overrideAmount: 25, overrideCount: 1, totalAmount: 125,
      },
    ])
  })

  it('does not merge two producer numbers that happen to share a name', () => {
    const result = buildCommissionAgentBreakdown([
      { agentName: 'Agente Um', agentNumber: '100', type: 'DIRECT', amount: 10 },
      { agentName: 'Agente Um', agentNumber: '200', type: 'DIRECT', amount: 20 },
    ])

    expect(result.map((row) => row.key)).toEqual(['number:200', 'number:100'])
  })

  it('keeps negative adjustments in the matching classification', () => {
    const [result] = buildCommissionAgentBreakdown([
      { agentName: 'Agent', agentNumber: '10', type: 'DIRECT', amount: 100 },
      { agentName: 'Agent', agentNumber: '10', type: 'DIRECT', amount: -25 },
    ])

    expect(result).toMatchObject({ directAmount: 75, directCount: 2, totalAmount: 75 })
  })
})
