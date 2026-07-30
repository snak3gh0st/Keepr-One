import { describe, expect, it } from 'vitest'
import { carrierPolicyNumberVariants, normalizeCarrierPolicyNumber } from './policy-number'

describe('normalizeCarrierPolicyNumber', () => {
  // The two shapes correspondence actually returns. Sixty-three of the
  // sixty-four rows join once the padding is gone.
  it('drops the padding correspondence adds to an LS number', () => {
    expect(normalizeCarrierPolicyNumber('00LS1556727')).toBe('LS1556727')
  })

  it('drops the padding on a numeric policy', () => {
    expect(normalizeCarrierPolicyNumber('00744323700')).toBe('744323700')
  })

  it('leaves a number that was never padded alone', () => {
    expect(normalizeCarrierPolicyNumber('766815100')).toBe('766815100')
    expect(normalizeCarrierPolicyNumber('LS0648595')).toBe('LS0648595')
  })

  // The X and the LS tell policies apart; stripping them would join contracts
  // that are not the same contract.
  it('keeps the suffix our own numbers carry', () => {
    expect(normalizeCarrierPolicyNumber('1512428X')).toBe('1512428X')
  })

  it('reports an absent number as absent', () => {
    expect(normalizeCarrierPolicyNumber('   ')).toBeNull()
    expect(normalizeCarrierPolicyNumber(null)).toBeNull()
    expect(normalizeCarrierPolicyNumber(undefined)).toBeNull()
  })
})

describe('carrierPolicyNumberVariants', () => {
  it('looks for the padded spelling as well as our own', () => {
    expect(carrierPolicyNumberVariants('LS1556727')).toEqual(['LS1556727', '00LS1556727'])
  })

  it('does not repeat a spelling', () => {
    expect(carrierPolicyNumberVariants('00744323700')).toEqual([
      '00744323700',
      '0000744323700',
    ])
  })

  it('has nothing to look for when there is no number', () => {
    expect(carrierPolicyNumberVariants('  ')).toEqual([])
  })
})
