import { describe, expect, it, vi } from 'vitest'
import { listNationalLifeCommissionEarningLinks } from './commission-detail-service'

const link =
  "<a href='/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=aaa1'>NLD</a>"

function db() {
  return {
    nationalLifeSyncRun: {
      findFirst: vi.fn().mockResolvedValue({
        plannedGridKeys: ['PAID_COMMISSIONS', 'COMMISSIONS_EARNING_REPORT'],
        currentGridKey: 'COMMISSIONS_EARNING_REPORT',
        stageCompletions: [{ gridKey: 'PAID_COMMISSIONS' }],
      }),
    },
    nationalLifeRawGridPage: {
      findMany: vi.fn().mockResolvedValue([
        { records: [{ NLDCommEarningAmt: link }] },
        { records: [{ ESICommEarningAmt: link }] },
      ]),
    },
  }
}

describe('local connector commission detail link service', () => {
  it('returns deduplicated links only while the detail stage is current', async () => {
    const database = db()
    await expect(listNationalLifeCommissionEarningLinks(database as never, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
    })).resolves.toEqual({
      parentRows: 2,
      links: [{
        path:
          '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=aaa1',
        statementId: 'aaa1',
      }],
    })
    expect(database.nationalLifeRawGridPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: 'run-1', gridKey: 'PAID_COMMISSIONS' }),
    }))
  })

  it('refuses a run that is not currently on the detail stage', async () => {
    const database = db()
    database.nationalLifeSyncRun.findFirst.mockResolvedValue({
      plannedGridKeys: ['PAID_COMMISSIONS', 'COMMISSIONS_EARNING_REPORT'],
      currentGridKey: 'PAID_COMMISSIONS',
      stageCompletions: [],
    })
    await expect(listNationalLifeCommissionEarningLinks(database as never, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
    })).rejects.toThrow('GRID_NOT_PLANNED')
  })

  it('returns the durable statement cursor instead of trusting extension storage after a retry', async () => {
    const database = db()
    database.nationalLifeRawGridPage.findMany.mockImplementation(async (input) => {
      if (input.where.gridKey === 'PAID_COMMISSIONS') {
        return [{
          records: [
            { NLDCommEarningAmt: link },
            {
              NLDCommEarningAmt:
                "<a href='/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=bbb2'>NLD</a>",
            },
          ],
        }]
      }
      return [
        { sequence: 0, records: [{ CommissionStatementId: 'aaa1' }] },
        {
          sequence: 1,
          records: [
            { CommissionStatementId: 'bbb2' },
            { CommissionStatementId: 'bbb2' },
          ],
        },
      ]
    })

    await expect(listNationalLifeCommissionEarningLinks(database as never, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
    })).resolves.toMatchObject({
      resume: {
        statementId: 'bbb2',
        statementOffset: 2,
        baseOffset: 1,
        sequence: 2,
        receivedRecordCount: 3,
      },
    })
  })
})
