import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildForesightTermClientTarget,
  FORESIGHT_TERM_FUNDING_MENU_ID,
  foresightTermReadbackError,
  resolveForesightTermDuration,
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
    expect(workflow.match(/await waitForCarrierIdle\(\)/g)).toHaveLength(3)
  })

  it('uses a valid duration returned by the carrier as an explicit fallback', () => {
    const snapshot = parseForesightTermIllustrationSnapshot({
      schemaVersion: 1,
      illustrationId: 'ill_term_readback',
      caseId: null,
      carrierCaseName: 'KEEPRONE-TERM-READBACK',
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
    })!
    const client = {
      firstName: 'Paulo',
      lastName: 'Loureiro Campos',
      dateOfBirth: '06/02/1988',
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'Standard_NT',
    }
    const funding = {
      designType: 'Specify Face Amount',
      faceAmount: '$1,000,000',
      premiumMode: 'Monthly',
      termDuration: '15-G',
    }

    expect(foresightTermReadbackError(snapshot, client, funding)).toBeNull()
    expect(resolveForesightTermDuration(snapshot, funding.termDuration)).toEqual({
      requestedTermDuration: '20-G',
      confirmedTermDuration: '15-G',
    })
    expect(foresightTermReadbackError(snapshot, client, {
      ...funding,
      termDuration: '25-G',
    })).toBe('FORESIGHT_TERM_DURATION_READBACK_MISMATCH')
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

  it('waits for the exact report selection to stabilize before reading it back', () => {
    const source = readFileSync(
      new URL('./foresight-term-executor.ts', import.meta.url),
      'utf8',
    )
    const workflow = source.slice(
      source.indexOf('async function verifyReports'),
      source.indexOf('async function saveCase'),
    )

    expect(workflow).toContain('await waitFor(() => {')
    expect(workflow).toContain('frameDocument(MAIN_FRAME_ID)')
    expect(workflow).toContain("'FORESIGHT_REPORT_SELECTION_MISMATCH'")
  })

  it('selects only optional report pages, not their nested settings', () => {
    expect(FORESIGHT_TERM_OPTIONAL_REPORT_SELECTOR).toBe(
      'input[type="checkbox"][id*="rptOptionalReports"][id$="_chkOptional"]',
    )
  })
})
