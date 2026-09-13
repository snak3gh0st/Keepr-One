import { describe, expect, it } from 'vitest'
import { renderClientSummaryPdf, clientSummaryFilename, niceCeiling } from './client-summary-pdf'
import type { ClientSummary } from './client-summary'

function point(policyYear: number) {
  return {
    policyYear,
    age: 39 + policyYear,
    netDeathBenefit: 500_000 + policyYear * 1_000,
    cashSurrenderValue: policyYear * 10_000,
    premiumOutlay: 3_600,
    accumulatedValue: policyYear * 12_000,
  }
}

const summary: ClientSummary = {
  kind: 'PROJECTED',
  insuredName: 'Maria Silva',
  productLabel: 'FlexLife',
  faceAmount: 500_000,
  monthlyPremium: 300,
  annualPremium: 3_600,
  issuedOn: new Date('2026-09-01T12:00:00Z'),
  advisorName: 'Ana Corretora',
  coverage: [1, 5, 10, 20, 30].map(point),
  milestones: [5, 10, 20, 30].map(point),
  fullMilestones: [1, 5, 10, 20, 30].map(point),
  outlook: { age: 65, policyYear: 26, totalContributions: 93_600, accumulatedValue: 130_000, growth: 36_400 },
  lapseYear: null,
  mecYear: null,
  guaranteed: [],
  guaranteedLapse: null,
}

/// The same policy with the guaranteed half of its illustration read in: the
/// carrier's values fall away and the policy lapses in year 25.
const withGuarantee: ClientSummary = {
  ...summary,
  guaranteed: Array.from({ length: 24 }, (unused, index) => ({
    policyYear: index + 1,
    age: 40 + index,
    netDeathBenefit: 500_000 - index * 4_000,
    cashSurrenderValue: Math.max(0, 40_000 - index * 2_000),
    premiumOutlay: 3_600,
    accumulatedValue: Math.max(0, 40_000 - index * 2_000),
  })),
  guaranteedLapse: { policyYear: 25, age: 63 },
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const canvas = await import('@napi-rs/canvas')
  const runtime = globalThis as unknown as Record<string, unknown>
  runtime.DOMMatrix ??= canvas.DOMMatrix
  runtime.Path2D ??= canvas.Path2D
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  runtime.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise
  const page = await document.getPage(1)
  const content = await page.getTextContent()
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
}

describe('client summary PDF', () => {
  it('renders a single-page PDF', async () => {
    const bytes = await renderClientSummaryPdf(summary)
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(1024)
  })

  it('prints the three numbers the client is being asked to decide on', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    expect(text).toContain('$500,000')
    expect(text).toContain('$300.00')
    expect(text).toContain('$3,600.00')
  })

  it('names the insured, the product and the carrier', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    expect(text).toContain('Maria Silva')
    expect(text).toContain('FLEXLIFE')
    expect(text).toContain('NATIONAL LIFE')
  })

  it('carries the client-facing disclaimer, not the broker-internal one', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    expect(text).toContain('non-guaranteed interest rates')
    expect(text).toContain('only authoritative document')
    expect(text).not.toContain('must not be shown')
  })

  it('qualifies the chart itself, not only the footer', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    expect(text).toContain('Not guaranteed')
  })

  it('prints each milestone year with its coverage', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    for (const milestone of summary.milestones) {
      expect(text).toContain(`Year ${milestone.policyYear}`)
    }
    expect(text).toContain('$530,000')
  })

  it('survives a projection the carrier left cash values out of', async () => {
    const text = await extractText(await renderClientSummaryPdf({
      ...summary,
      coverage: summary.coverage.map((point) => ({ ...point, cashSurrenderValue: null })),
      milestones: summary.milestones.map((point) => ({ ...point, cashSurrenderValue: null })),
    }))
    expect(text).toContain('$500,000')
    expect(text).toContain('—')
  })

  // A page that draws only the current curve, marked "not guaranteed", is the
  // shape the regulation on illustrations exists to prevent. With both halves
  // drawn, the qualifier changes to say which is which.
  it('names both scenarios on the chart once the guaranteed half is drawn', async () => {
    const text = await extractText(await renderClientSummaryPdf(withGuarantee))
    expect(text).toContain('Current vs. guaranteed assumptions')
    expect(text).toContain('Guaranteed')
    expect(text).not.toContain('Not guaranteed · current assumptions')
  })

  // The marker on the chart is three words in eight-point type. The sentence is
  // the thing a client actually reads, and it is the one fact a current-values
  // page could never tell them.
  it('says in words that the policy ends on guaranteed assumptions', async () => {
    const text = await extractText(await renderClientSummaryPdf(withGuarantee))
    expect(text).toContain('Ends at 63')
    expect(text).toContain('would end in year 25, at age 63')
    expect(text).toContain('unless a higher premium is paid')
  })

  it('keeps the one-pager clear of the footer when the lapse sentence is on it', async () => {
    const bytes = await renderClientSummaryPdf(withGuarantee)
    const text = await extractText(bytes)
    // Both the last thing above the footer and the first thing in it survive,
    // which they would not if the two had been drawn over each other.
    expect(text).toContain('unless a higher premium is paid')
    expect(text).toContain('Prepared by Keepr One')
    expect(text).toContain('Source: National Life illustration')
  })

  it('draws no guaranteed curve when the PDF could not be read', async () => {
    const text = await extractText(await renderClientSummaryPdf(summary))
    expect(text).toContain('Not guaranteed · current assumptions')
    expect(text).not.toContain('would end in year')
  })

  it('names the file after the insured and the day it was issued', () => {
    expect(clientSummaryFilename(summary)).toBe('Maria-Silva-proposal-summary-2026-09-01.pdf')
  })
})

describe('coverage chart axis', () => {
  it('leaves the top data point on the gridline when it is already a round number', () => {
    expect(niceCeiling(1_000_000)).toBe(1_000_000)
    expect(niceCeiling(500_000)).toBe(500_000)
  })

  it('steps to the next readable number rather than doubling the axis', () => {
    expect(niceCeiling(1_050_000)).toBe(1_500_000)
    expect(niceCeiling(1_568_000)).toBe(2_000_000)
    expect(niceCeiling(268_000)).toBe(300_000)
  })

  it('never returns a zero ceiling to divide the plot by', () => {
    expect(niceCeiling(0)).toBe(1)
    expect(niceCeiling(-5)).toBe(1)
    expect(niceCeiling(Number.NaN)).toBe(1)
  })
})

describe('Term summary PDF', () => {
  const term: ClientSummary = {
    kind: 'LEVEL_TERM',
    insuredName: 'Ale Teste',
    productLabel: 'NL Term',
    faceAmount: 500_000,
    monthlyPremium: 62.92,
    annualPremium: 755.04,
    issuedOn: new Date('2026-09-01T12:00:00Z'),
    advisorName: null,
    termDuration: '20-G', schedule: null,
  }

  it('states the confirmed numbers and how long the premium holds', async () => {
    const text = await extractText(await renderClientSummaryPdf(term))
    expect(text).toContain('$500,000')
    expect(text).toContain('$62.92')
    expect(text).toContain('$755.04')
    expect(text).toContain('Level premium guaranteed for 20 years')
    expect(text).toContain('NL TERM')
  })

  // Term carries no projection, so the page must not grow one — no chart
  // heading, no milestone table, and above all no qualifier implying there is
  // a forecast here to qualify.
  it('draws no projection it does not have', async () => {
    const text = await extractText(await renderClientSummaryPdf(term))
    expect(text).not.toContain('Coverage over time')
    expect(text).not.toContain('POLICY YEAR')
    expect(text).not.toContain('Cash value')
    expect(text).not.toContain('Not guaranteed')
  })

  // A term policy credits no interest, so the permanent-policy condition would
  // describe an assumption the contract does not contain — and would invite the
  // client to discount contractual maximums as speculation.
  it('carries the term condition, not the one about interest rates', async () => {
    const text = await extractText(await renderClientSummaryPdf(term))
    expect(text).not.toContain('non-guaranteed interest rates')
    expect(text).toContain('credits no interest')
    expect(text).toContain('guaranteed maximums set by the contract')
    // What underwriting can still move, and the parts both conditions share.
    expect(text).toContain('rate class')
    expect(text).toContain('only authoritative document')
    expect(text).toContain('National Life illustration issued September 1, 2026')
  })

  // The document used to state the guarantee and stop, which is accurate for
  // twenty years and silent about the twenty-first, where the contractual
  // premium is eight times larger. The carrier's own Ledger says so.
  it('prints what the premium becomes after the guarantee ends', async () => {
    const text = await extractText(await renderClientSummaryPdf({
      ...term,
      schedule: {
        levelPeriodYears: 20,
        levelAnnualPremium: 755.04,
        levelMonthlyPremium: 62.92,
        deathBenefit: 500_000,
        finalPolicyYear: 58,
        finalAge: 95,
        firstIncrease: { policyYear: 21, age: 57, annualPremium: 6_262.08, monthlyPremium: 521.84 },
        rows: [
          { policyYear: 1, age: 37, guaranteedAnnualPremium: 755.04, guaranteedDeathBenefit: 500_000 },
          { policyYear: 20, age: 56, guaranteedAnnualPremium: 755.04, guaranteedDeathBenefit: 500_000 },
          { policyYear: 21, age: 57, guaranteedAnnualPremium: 6_262.08, guaranteedDeathBenefit: 500_000 },
        ],
      },
    }))
    expect(text).toContain('$6,262.08')
    expect(text).toContain('$521.84')
    expect(text).toContain('THROUGH YEAR 20 — AGE 56')
    expect(text).toContain('FROM YEAR 21 — AGE 57')
    // Guaranteed figures, so the page must not borrow the projection's hedge.
    expect(text).toContain('GUARANTEED BY CONTRACT')
    expect(text).not.toContain('Not guaranteed')
  })

  // Three page shapes now feed one footer that follows its content: Term bare,
  // Term with the schedule, and the projected one-pager with a lapse sentence.
  // The schedule is the tallest of them, and both times this page grew, the
  // footer landed on top of the content. The check that generalizes is that the
  // last thing above the footer and the first thing in it both survive.
  it('keeps the Term schedule clear of the footer', async () => {
    const text = await extractText(await renderClientSummaryPdf({
      ...term,
      schedule: {
        levelPeriodYears: 20,
        levelAnnualPremium: 755.04,
        levelMonthlyPremium: 62.92,
        deathBenefit: 500_000,
        finalPolicyYear: 58,
        finalAge: 95,
        firstIncrease: { policyYear: 21, age: 57, annualPremium: 6_262.08, monthlyPremium: 521.84 },
        rows: Array.from({ length: 6 }, (unused, index) => ({
          policyYear: index + 1,
          age: 37 + index,
          guaranteedAnnualPremium: 755.04 + index,
          guaranteedDeathBenefit: 500_000,
        })),
      },
    }))
    expect(text).toContain('The death benefit stays at $500,000')
    expect(text).toContain('Prepared by Keepr One')
    expect(text).toContain('Source: National Life illustration')
  })

  it('says plainly when the premium is the kind that rises', async () => {
    const text = await extractText(await renderClientSummaryPdf({ ...term, termDuration: 'ART' }))
    expect(text).toContain('the premium increases each year')
  })
})

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const canvas = await import('@napi-rs/canvas')
  const runtime = globalThis as unknown as Record<string, unknown>
  runtime.DOMMatrix ??= canvas.DOMMatrix
  runtime.Path2D ??= canvas.Path2D
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  runtime.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise
  const pages: string[] = []
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '))
  }
  return pages
}

describe('the full presentation', () => {
  // The normal FlexLife row carries all three: a current-assumptions lapse
  // year, a MEC year, and now a guaranteed lapse year. Three stacked notes on
  // the outlook page is the one combination that can push the document to a
  // fifth page, and it is the combination production data produces.
  it('stays four pages with every note the carrier can issue at once', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(
      { ...withGuarantee, lapseYear: 47, mecYear: 12 },
      { variant: 'FULL' },
    ))
    expect(pages).toHaveLength(4)
    const outlook = pages[3]!
    expect(outlook).toContain('would lapse in year 47')
    expect(outlook).toContain('Modified Endowment Contract in year 12')
    expect(outlook).toContain('would end in year 25, at age 63')
    // The last note and the first line of the footer both survive, which they
    // would not if the two had been drawn over each other.
    expect(outlook).toContain('Prepared by Keepr One')
  })

  it('runs to four pages: cover, plan with the curve, table, outlook', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(summary, { variant: 'FULL' }))
    expect(pages).toHaveLength(4)
    expect(pages[0]).toContain('PERSONAL PLAN')
    expect(pages[1]).toContain('YOUR PLAN')
    expect(pages[1]).toContain('Coverage over time')
    expect(pages[2]).toContain('YEAR BY YEAR')
    expect(pages[3]).toContain('Next step')
  })

  it('shows what was paid in against what it became', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(summary, { variant: 'FULL' }))
    expect(pages[3]).toContain('$93,600')
    expect(pages[3]).toContain('$130,000')
    expect(pages[3]).toContain('$36,400')
    expect(pages[3]).toContain('ACCUMULATED VALUE AT AGE 65')
  })

  it('qualifies the outlook figures too, not only the chart', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(summary, { variant: 'FULL' }))
    expect(pages[3]).toContain('Not guaranteed')
  })

  it('omits the outlook block when the projection could not be honestly totalled', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(
      { ...summary, outlook: null }, { variant: 'FULL' }))
    expect(pages[3]).not.toContain('Total paid in')
    expect(pages[3]).toContain('Next step')
  })

  it('passes the carrier’s lapse and MEC warnings through to the client', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(
      { ...summary, lapseYear: 41, mecYear: 7 }, { variant: 'FULL' }))
    expect(pages[3]).toContain('lapse in year 41')
    expect(pages[3]).toContain('Modified Endowment Contract in year 7')
  })

  it('names the advisor on the cover and at the close', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf(summary, { variant: 'FULL' }))
    expect(pages[0]).toContain('ANA CORRETORA')
    expect(pages[3]).toContain('Ana Corretora')
  })

  // Term carries four numbers and a duration. Five pages of that would be
  // padding, so the full variant falls back to the one-pager rather than
  // inventing pages to fill.
  it('falls back to one page for Term, which has no projection', async () => {
    const pages = await pageTexts(await renderClientSummaryPdf({
      kind: 'LEVEL_TERM', insuredName: 'Ale Teste', productLabel: 'NL Term',
      faceAmount: 500_000, monthlyPremium: 62.92, annualPremium: 755.04,
      issuedOn: new Date('2026-09-01T12:00:00Z'), advisorName: null, termDuration: '20-G', schedule: null,
    }, { variant: 'FULL' }))
    expect(pages).toHaveLength(1)
  })

  it('names the file so the agent can tell the two apart', () => {
    expect(clientSummaryFilename(summary, 'FULL'))
      .toBe('Maria-Silva-proposal-presentation-2026-09-01.pdf')
  })
})

describe('language', () => {
  it('prints the whole page in Portuguese when asked', async () => {
    const text = (await pageTexts(await renderClientSummaryPdf(summary, { language: 'PT' })))[0]!
    expect(text).toContain('SUA COBERTURA')
    expect(text).toContain('PAGAMENTO MENSAL')
    expect(text).toContain('Cobertura ao longo do tempo')
    expect(text).toContain('Não garantido')
    expect(text).toContain('Benefício por morte')
    expect(text).toContain('Ano 5')
    expect(text).not.toContain('Your coverage')
  })

  it('states a Portuguese Term duration in Portuguese', async () => {
    const text = (await pageTexts(await renderClientSummaryPdf({
      kind: 'LEVEL_TERM', insuredName: 'Ale Teste', productLabel: 'NL Term',
      faceAmount: 500_000, monthlyPremium: 62.92, annualPremium: 755.04,
      issuedOn: new Date('2026-09-01T12:00:00Z'), advisorName: null, termDuration: 'ART', schedule: null,
    }, { language: 'PT' })))[0]!
    expect(text).toContain('o prêmio aumenta a cada ano')
  })

  // Transcribed US insurance compliance language. `quote-disclaimer.ts` states
  // it may not be translated, so a Portuguese page carries it in English.
  it('keeps the regulated disclaimer in English on a Portuguese page', async () => {
    const text = (await pageTexts(await renderClientSummaryPdf(summary, { language: 'PT' })))[0]!
    expect(text).toContain('only authoritative document')
    expect(text).toContain('Fonte: ilustração da National Life')
  })
})
