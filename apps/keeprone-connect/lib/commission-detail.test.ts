import { describe, expect, it } from 'vitest'
import {
  isSafeCommissionDetailPath,
  parseCommissionDetailResume,
  parseCommissionDetailTargets,
} from './commission-detail'

const path =
  '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=statementa'

describe('KeeproneConnect commission detail targets', () => {
  it('accepts only the carrier earning-detail route', () => {
    expect(isSafeCommissionDetailPath(path)).toBe(true)
    expect(isSafeCommissionDetailPath('https://evil.example/x?id=statement-a')).toBe(false)
    expect(isSafeCommissionDetailPath(`${path}&next=1`)).toBe(false)
  })

  it('validates and deduplicates the signed link response', () => {
    expect(
      parseCommissionDetailTargets({
        parentRows: 2,
        links: [
          { path, statementId: 'statementa' },
          { path, statementId: 'statementa' },
        ],
      }),
    ).toEqual([{ path, statementId: 'statementa' }])
  })

  it('rejects a link whose id does not match its path', () => {
    expect(() => parseCommissionDetailTargets({
      links: [{ path, statementId: 'statementb' }],
    })).toThrow('INVALID_COMMISSION_DETAIL_LINKS')
  })

  it('accepts only a server cursor that belongs to one returned statement', () => {
    const response = {
      links: [{ path, statementId: 'statementa' }],
      resume: {
        statementId: 'statementa',
        statementOffset: 664,
        baseOffset: 1609,
        sequence: 13,
        receivedRecordCount: 2273,
      },
    }

    expect(parseCommissionDetailResume(response, parseCommissionDetailTargets(response))).toEqual(
      response.resume,
    )
    expect(() => parseCommissionDetailResume({
      ...response,
      resume: { ...response.resume, statementId: 'unknown' },
    }, parseCommissionDetailTargets(response))).toThrow('INVALID_COMMISSION_DETAIL_RESUME')
  })
})
