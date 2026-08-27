import { describe, expect, it } from 'vitest'
import {
  FORESIGHT_ILLUSTRATION_PRODUCTS,
  getForesightIllustrationProduct,
} from './foresight-product-catalog'

describe('Foresight illustration product catalog', () => {
  it('shows the carrier-observed IUL and Term choices without treating an unverified Term workflow as executable', () => {
    expect(FORESIGHT_ILLUSTRATION_PRODUCTS).toEqual([
      {
        key: 'FLEXLIFE_IUL',
        label: 'IUL',
        carrierName: 'FlexLife',
        description: 'FlexLife • Indexed Universal Life',
        availability: 'READY',
      },
      {
        key: 'NATIONAL_LIFE_TERM',
        label: 'Term',
        carrierName: 'NL Term',
        description: 'National Life Term',
        availability: 'CONTRACT_REQUIRED',
      },
    ])
    expect(getForesightIllustrationProduct('FLEXLIFE_IUL')?.availability).toBe('READY')
    expect(getForesightIllustrationProduct('NATIONAL_LIFE_TERM')?.availability).toBe('CONTRACT_REQUIRED')
  })
})
