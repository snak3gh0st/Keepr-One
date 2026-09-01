import { describe, expect, it } from 'vitest'
import { parseForesightTermPremiumText } from './foresight-term-pdf'

const officialTermText = `
  Narrative Summary
  KBot Illustration Term Test Face Amount: $500,000
  Male 37 Standard Non-Tobacco Initial Premium: $62.92 Monthly (EFT)

  Premium Payment Options
  Number of Amount of Total Amount you will pay
  Premium Frequency payments per year each premium payment premium per year
  Annual 1 $715.00 $715.00 $0.00
  Semi-Annual 2 $364.65 $729.30 $14.30
  Quarterly 4 $185.90 $743.60 $28.60
  Monthly (EFT/Group Bill) 12 $62.92 $755.04 $40.04

  Narrative Summary
  Initial Premium: $62.92 Monthly (EFT)
`

describe('Foresight Term official PDF premium extraction', () => {
  it('reads the selected monthly premium and its first-year total from carrier text', () => {
    expect(parseForesightTermPremiumText(officialTermText)).toEqual({
      monthlyPremium: 62.92,
      annualPremium: 755.04,
    })
  })

  it('accepts harmless Foresight whitespace and Group Bill label variations', () => {
    expect(parseForesightTermPremiumText(`
      Initial Premium: $ 62.92 Monthly ( EFT / Group Bill )
      Monthly ( EFT / Group Bill ) 12 $ 62.92 $ 755.04
    `)).toEqual({
      monthlyPremium: 62.92,
      annualPremium: 755.04,
    })
  })

  it('rejects a payment table that disagrees with the carrier summary', () => {
    expect(() => parseForesightTermPremiumText(
      officialTermText.replace('12 $62.92 $755.04', '12 $63.92 $767.04'),
    )).toThrow('FORESIGHT_TERM_PREMIUM_MISMATCH')
  })

  it('rejects text without both official premium sources', () => {
    expect(() => parseForesightTermPremiumText(
      'Initial Premium: $62.92 Monthly (EFT)',
    )).toThrow('FORESIGHT_TERM_PREMIUM_MISSING')
  })
})
