import { describe, expect, it } from 'vitest'
import { renderClientSummaryPdf, clientSummaryFilename, niceCeiling } from './client-summary-pdf'
import type { ClientSummary } from './client-summary'

const summary: ClientSummary = {
  kind: 'PROJECTED',
  insuredName: 'Maria Silva',
  productLabel: 'FlexLife',
  faceAmount: 500_000,
  monthlyPremium: 300,
  annualPremium: 3_600,
  issuedOn: new Date('2026-09-01T12:00:00Z'),
  coverage: [1, 5, 10, 20, 30].map((policyYear) => ({
    policyYear,
    age: 39 + policyYear,
    netDeathBenefit: 500_000 + policyYear * 1_000,
    cashSurrenderValue: policyYear * 10_000,
  })),
  milestones: [5, 10, 20, 30].map((policyYear) => ({
    policyYear,
    age: 39 + policyYear,
    netDeathBenefit: 500_000 + policyYear * 1_000,
    cashSurrenderValue: policyYear * 10_000,
  })),
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
    durationLabel: 'Level premium guaranteed for 20 years',
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

  it('says plainly when the premium is the kind that rises', async () => {
    const text = await extractText(await renderClientSummaryPdf({
      ...term, durationLabel: 'Annually renewable — the premium increases each year',
    }))
    expect(text).toContain('the premium increases each year')
  })
})
