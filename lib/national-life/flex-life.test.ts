import { describe, expect, it } from 'vitest'
import {
  FLEX_LIFE_PRODUCT_CODE,
  FLEX_LIFE_PRODUCT_LABEL,
  flexLifeProductLabel,
} from './flex-life'
import { RAPID_SOLVE_PRODUCT_CODE } from './rapid-solve'

describe('flexLifeProductLabel', () => {
  it('names the Rapid Solve default code as FlexLife', () => {
    expect(FLEX_LIFE_PRODUCT_CODE).toBe(RAPID_SOLVE_PRODUCT_CODE)
    expect(flexLifeProductLabel(FLEX_LIFE_PRODUCT_CODE)).toBe(FLEX_LIFE_PRODUCT_LABEL)
    expect(flexLifeProductLabel('956')).toBe('FlexLife')
  })

  it('treats an already-labeled FlexLife value as FlexLife', () => {
    expect(flexLifeProductLabel('FlexLife')).toBe('FlexLife')
  })

  it('defaults missing codes to FlexLife for this quote surface', () => {
    expect(flexLifeProductLabel(null)).toBe('FlexLife')
    expect(flexLifeProductLabel(undefined)).toBe('FlexLife')
  })

  it('does not relabel an unknown product code', () => {
    expect(flexLifeProductLabel('Term20')).toBe('Term20')
  })
})
