import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildForesightTermClientTarget,
  FORESIGHT_TERM_FUNDING_MENU_ID,
} from './foresight-term-executor'
import { parseForesightTermIllustrationSnapshot } from './foresight-term-contract'
import {
  FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR,
  isForesightTermNaicReportGroup,
} from './foresight-term-reports'

describe('Foresight Term client target', () => {
  it('opens Death Benefit and Funding through the Term Ledger menu', () => {
    expect(FORESIGHT_TERM_FUNDING_MENU_ID)
      .toBe('ctl00_mobilityPH_verticalMenu_Ledger_0')
  })

  it('writes the birth date in the US format required by the Term form', () => {
    const snapshot = parseForesightTermIllustrationSnapshot({
      schemaVersion: 1,
      illustrationId: 'ill_term_1',
      caseId: null,
      carrierCaseName: 'KEEPRONE-TERM-1',
      product: { carrierName: 'LSW Term', kind: 'TERM' },
      insured: {
        firstName: 'Paulo',
        lastName: 'Loureiro Campos',
        dateOfBirth: '1988-06-02',
        issueState: 'FL',
      },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      faceAmount: 1_000_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
      reports: ['NAIC_ILLUSTRATION'],
    })

    expect(snapshot).not.toBeNull()
    expect(buildForesightTermClientTarget(snapshot!)).toEqual({
      firstName: 'Paulo',
      lastName: 'Loureiro Campos',
      birthDate: '06/02/1988',
    })
  })

  it('uses the Term 2022 component methods for funding updates', () => {
    const source = readFileSync(
      new URL('../entrypoints/foresight-main.content.ts', import.meta.url),
      'utf8',
    )
    const workflow = source.slice(
      source.indexOf('const applyTermFunding'),
      source.indexOf('const applyTermReports'),
    )

    expect(workflow).toContain("'updateDeathBenefit'")
    expect(workflow).toContain("'updatePremium'")
    expect(workflow).toContain("'updateTermProduct'")
    expect(workflow).not.toContain("'updateDeathBenefitSchedule'")
  })

  it('matches the Term duration from the report section around the NAIC checkbox', () => {
    const checkbox = {
      closest: (selector: string) => selector === 'div[id$="_divReports"]'
        ? { parentElement: { textContent: 'Term 20-G Options NAIC Illustration' } }
        : null,
    }

    expect(isForesightTermNaicReportGroup(
      checkbox as unknown as HTMLInputElement,
      '20-G',
    )).toBe(true)
  })

  it('selects only optional report pages, not their nested settings', () => {
    expect(FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR).toBe(
      'input[type="checkbox"][id*="rptOptionalReports"][id$="_chkOptional"]',
    )
  })
})
