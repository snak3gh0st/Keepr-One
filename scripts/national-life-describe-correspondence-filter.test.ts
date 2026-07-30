import { describe, expect, it } from 'vitest'
import { filterLikeKeys } from './national-life-describe-correspondence-filter'

describe('filterLikeKeys', () => {
  it('finds a date range nested in the grid request', () => {
    expect(
      filterLikeKeys({ objJsonModel: { start: 0, fromDate: '07/01/2026', toDate: '07/30/2026' } }),
    ).toEqual([
      'objJsonModel.fromDate = "07/01/2026"',
      'objJsonModel.toDate = "07/30/2026"',
    ])
  })

  it('reports nothing when the request narrows nothing', () => {
    expect(filterLikeKeys({ objJsonModel: { start: 0, length: 100, draw: 1 } })).toEqual([])
  })

  it('does not fall over on a body that is not an object', () => {
    expect(filterLikeKeys('draw=1&start=0')).toEqual([])
    expect(filterLikeKeys(null)).toEqual([])
  })
})
