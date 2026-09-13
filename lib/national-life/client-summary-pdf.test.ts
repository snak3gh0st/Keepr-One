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

  it('still carries the client-facing disclaimer and the carrier attribution', async () => {
    const text = await extractText(await renderClientSummaryPdf(term))
    expect(text).toContain('non-guaranteed interest rates')
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
