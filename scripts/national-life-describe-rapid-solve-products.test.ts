import { describe, expect, it } from 'vitest'
import {
  optionLists,
  productCodes,
  productNames,
  renderedOptions,
} from './national-life-describe-rapid-solve-products'

describe('productCodes', () => {
  it('finds the code the carrier hardcodes', () => {
    expect(productCodes('data.ProductCode = "956";')).toEqual(['956'])
  })

  it('reads the code however the assignment is spelled', () => {
    expect(productCodes('{ "ProductCode": "956", ProductCode: 957 }')).toEqual(['956', '957'])
  })

  // The whole point of the probe: more than one code means Term may be
  // reachable and the screen shows two products rather than one.
  it('collects a list of codes', () => {
    expect(productCodes('var productCodes = ["956", "301", "302"];')).toEqual([
      '301',
      '302',
      '956',
    ])
  })

  it('finds nothing in a bundle that names no product', () => {
    expect(productCodes('function submit() { return true }')).toEqual([])
  })
})

describe('productNames', () => {
  // Deliberately generous: this is a probe, and a product missed is a product
  // the screen will not offer. A name that turns out not to be one is obvious
  // to a human reading the output; a missing one is invisible.
  it('picks up term, IUL and other life product names', () => {
    expect(productNames('["FlexLife IUL", "Term 20", "Peak Life"]')).toEqual([
      'FlexLife IUL',
      'Peak Life',
      'Term 20',
    ])
  })

  it('returns nothing when no product is named', () => {
    expect(productNames('var x = "hello";')).toEqual([])
  })
})

describe('optionLists', () => {
  it('reads the values the carrier accepts for a field', () => {
    expect(optionLists('RateClasses = ["Preferred", "Standard", "Tobacco"];')).toEqual({
      RateClass: ['Preferred', 'Standard', 'Tobacco'],
    })
  })

  it('omits a field the bundle never lists', () => {
    expect(optionLists('var unrelated = [1, 2, 3];')).toEqual({})
  })
})

describe('renderedOptions', () => {
  it('reads a plain select', () => {
    const html = '<select name="gender"><option>Male</option><option>Female</option></select>'
    expect(renderedOptions(html)).toEqual({ 'select:gender': ['Male', 'Female'] })
  })

  // This portal builds dropdowns out of buttons, so the options live in data
  // attributes and a select-only dump would report an empty form.
  it('reads the custom button dropdowns this portal uses', () => {
    const html = '<li data-value="Preferred"></li><li data-value="Standard"></li>'
    expect(renderedOptions(html)).toEqual({
      'data-attributes': ['Preferred', 'Standard'],
    })
  })
})
