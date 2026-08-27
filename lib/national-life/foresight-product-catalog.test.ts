import { describe, expect, it } from 'vitest'
import {
  FORESIGHT_ILLUSTRATION_PRODUCTS,
  getForesightIllustrationProduct,
} from './foresight-product-catalog'

describe('Foresight illustration product catalog', () => {
  it('exposes IUL and both carrier-specific Term contracts as executable products', () => {
    expect(FORESIGHT_ILLUSTRATION_PRODUCTS).toEqual([
      {
        key: 'FLEXLIFE_IUL',
        label: 'IUL',
        kind: 'IUL',
        carrierName: 'FlexLife',
        description: 'FlexLife • Indexed Universal Life',
        availability: 'READY',
      },
      {
        key: 'LSW_TERM',
        label: 'Term',
        kind: 'TERM',
        carrierName: 'LSW Term',
        description: 'Life Insurance Company of the Southwest • Term Life',
        availability: 'READY',
      },
      {
        key: 'NL_TERM',
        label: 'Term',
        kind: 'TERM',
        carrierName: 'NL Term',
        description: 'National Life Insurance Company • Term Life',
        availability: 'READY',
      },
    ])
    expect(getForesightIllustrationProduct('FLEXLIFE_IUL')?.availability).toBe('READY')
    expect(getForesightIllustrationProduct('LSW_TERM')?.carrierName).toBe('LSW Term')
    expect(getForesightIllustrationProduct('NL_TERM')?.carrierName).toBe('NL Term')
  })
})
