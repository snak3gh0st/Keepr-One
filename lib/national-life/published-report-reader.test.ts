import { expect, it, vi } from 'vitest'
import { readNationalLifeReports } from './published-report-reader'

it('combines verified local rows and legacy history without reading local landing rows', async () => {
  const published = vi.fn().mockResolvedValue([{ id: 'verified' }])
  const legacy = vi.fn().mockResolvedValue([{ id: 'legacy' }])
  const where = { agentId: 'owner', gridKey: 'COMMISSIONS_EARNING_REPORT' }
  const rows = await readNationalLifeReports({
    nationalLifePublishedReportRow: { findMany: published },
    nationalLifeReportRow: { findMany: legacy },
  } as never, where)
  expect(rows.map((row) => row.id)).toEqual(['verified', 'legacy'])
  expect(published.mock.calls[0][0].where).toEqual({
    AND: [where, { deploymentScope: 'LOCAL_CONNECTOR' }],
  })
  expect(legacy.mock.calls[0][0].where).toEqual({
    AND: [where, { deploymentScope: { not: 'LOCAL_CONNECTOR' } }],
  })
})
