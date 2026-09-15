import 'server-only'

/// Draws what the client receives: a one-page summary, or a four-page
/// presentation of the same verified facts.
///
/// Vector PDF straight from Skia via `@napi-rs/canvas`, which the server image
/// already carries for reading carrier PDFs. That is the whole reason this is a
/// canvas and not a print stylesheet: rendering HTML to PDF would mean putting
/// Chromium in the web image, and the alternative — asking the agent to hit
/// Cmd+P — is not something you can attach to a WhatsApp message.
///
/// This module only draws. Every value it receives has already been verified
/// against the carrier's official illustration by `buildClientSummary`; nothing
/// here computes, rounds into, or infers a number. Every word it prints comes
/// from `client-summary-copy.ts`.

import path from 'node:path'
import { GlobalFonts, PDFDocument, Path2D } from '@napi-rs/canvas'
import { CLIENT_SUMMARY_DISCLAIMER, CLIENT_SUMMARY_TERM_DISCLAIMER } from './quote-disclaimer'
import { clientSummaryCopy, type ClientSummaryLanguage } from './client-summary-copy'
import type { ClientSummary, ClientSummaryPoint, ClientSummaryScenarios, ClientSummaryTermSchedule } from './client-summary'
import { analyzeClientPolicy, type ClientPolicyInsights } from './client-summary-insights'
import type { ClientSummaryInterpretation } from './client-summary-ai'
import type { ForesightTermLedgerRow } from './foresight-term-ledger'

type Ctx = ReturnType<PDFDocument['beginPage']>
type Copy = ReturnType<typeof clientSummaryCopy>

export type ClientSummaryVariant = 'QUICK' | 'FULL'

export type ClientSummaryOptions = {
  variant?: ClientSummaryVariant
  language?: ClientSummaryLanguage
  interpretation?: ClientSummaryInterpretation
}

// US Letter at 72dpi, the size a US client prints without thinking about it.
// Portrait rather than the landscape of a deck: this is opened on a phone in a
// WhatsApp thread, where portrait fills the screen and landscape does not.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 46
const BAND_HEIGHT = 132
const REPORT_WIDTH = 792
const REPORT_HEIGHT = 612
const REPORT_MARGIN = 42

// Keepr One's palette, converted once from the oklch tokens in `globals.css`.
// Canvas has no oklch, so these are the sRGB values of those same tokens; if
// the brand colours move there, they move here.
const INK = '#0e1610'
const INK_MUTED = '#5a635b'
const TEAL = '#005526'
const TEAL_DEEP = '#003617'
const GOLD = '#be7200'
/// Reserved for the one thing on the page the client must not skim past: the
/// year the carrier says a guaranteed-assumptions policy ends. Nothing else
/// uses it, so its appearance means exactly that.
const ALERT = '#a33a1f'
const BORDER = '#d6ddd6'
const PANEL = '#f7f7f1'
const PAPER = '#fdfcf9'
// The logo's own green and the tints that carry it onto the dark band. These
// come from `public/brand/keepr-one-logo.svg` and `components/Logo.tsx`, not
// from the interface palette — the mark keeps its colour wherever it appears.
const BRAND_GREEN = '#42c77d'
const ON_BAND = '#ffffff'
const ON_BAND_MUTED = 'rgba(255, 255, 255, 0.58)'

const BRAND = 'Satoshi'

/// The three strokes of the Keepr One mark, lifted verbatim from
/// `public/brand/keepr-one-logo.svg` so the PDF carries the same vector the
/// interface does rather than a screenshot of it. The SVG's viewBox origin is
/// (8, 6) and its extent 84 × 86; `drawLogoMark` undoes that offset.
const LOGO_PATHS = [
  { d: 'M13 13.5C13 11.01 15.01 9 17.5 9H44L13 58V13.5Z', fill: BRAND_GREEN },
  { d: 'M13 64.5L60.5 9H88L13 86V64.5Z', fill: BRAND_GREEN },
  { d: 'M47.5 66L61.5 52L89 88H61L47.5 66Z', fill: ON_BAND },
] as const
const LOGO_VIEWBOX = { x: 8, y: 6, size: 86 }

/// Skia falls back to a system font when the requested family is missing, and
/// the Alpine server image has none. Worse than missing glyphs: a measured
/// fallback rendered its spaces as U+0001, so the text extracted back out of
/// the PDF read `Coverageovertime` — a file that looks right and cannot be
/// searched, copied, or read by a screen reader. Registering the brand face is
/// therefore not styling, it is correctness, and every `font` call names it.
let fontsReady = false
function registerBrandFonts(): void {
  if (fontsReady) return
  for (const weight of ['300', '400', '500', '700']) {
    GlobalFonts.registerFromPath(
      path.join(process.cwd(), 'public', 'fonts', `satoshi-${weight}.woff2`),
      BRAND,
    )
  }
  fontsReady = true
}

const whole = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})
const cents = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const compact = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

// Amounts stay in US dollars in both languages — the policy is a US contract
// and the carrier's own document states them that way. Only the date follows
// the reader's language.
function dayFor(language: ClientSummaryLanguage) {
  return new Intl.DateTimeFormat(language === 'PT' ? 'pt-BR' : 'en-US', {
    dateStyle: 'long', timeZone: 'UTC',
  })
}

/// Rounds an axis up to a number a person would have chosen. Scaling the axis
/// to the tallest data point put `$1,568,000` on the gridline — a number that
/// belongs to no one and makes the reader do arithmetic to place the curve.
///
/// The steps are finer than the usual 1/2/5 because the jump matters here: a
/// projection topping out just over a million would round to two million and
/// squash the whole curve into the lower half of the plot, which reads as a
/// policy that does less than it does.
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
  const step = steps.find((candidate) => value <= candidate * magnitude) ?? 10
  return step * magnitude
}

function font(size: number, weight: 300 | 400 | 500 | 700 = 400): string {
  return `${weight} ${size}px ${BRAND}`
}

/// Lays text into a column, returning where the next line would start. Used for
/// the disclaimer and body copy — the runs long enough to wrap, and the ones
/// that must never be silently clipped.
function paragraph(
  ctx: Ctx, text: string, x: number, y: number, width: number, lineHeight: number,
): number {
  let line = ''
  let cursor = y
  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (ctx.measureText(candidate).width > width && line !== '') {
      ctx.fillText(line, x, cursor)
      cursor += lineHeight
      line = word
    } else {
      line = candidate
    }
  }
  if (line !== '') {
    ctx.fillText(line, x, cursor)
    cursor += lineHeight
  }
  return cursor
}

function right(ctx: Ctx, text: string, rightEdge: number, y: number): void {
  ctx.fillText(text, rightEdge - ctx.measureText(text).width, y)
}

function drawLogoMark(ctx: Ctx, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / LOGO_VIEWBOX.size, size / LOGO_VIEWBOX.size)
  ctx.translate(-LOGO_VIEWBOX.x, -LOGO_VIEWBOX.y)
  for (const stroke of LOGO_PATHS) {
    ctx.fillStyle = stroke.fill
    ctx.fill(new Path2D(stroke.d))
  }
  ctx.restore()
}

/// Mark plus wordmark, set the way `components/Logo.tsx` sets it: `keepr` bold
/// and `one` in the brand green, tight together on one baseline.
function drawLogo(ctx: Ctx, x: number, baseline: number, size: number): void {
  drawLogoMark(ctx, x, baseline - size + 2, size)
  const textX = x + size + size * 0.41
  const type = size * 0.86
  ctx.font = font(type, 700)
  ctx.fillStyle = ON_BAND
  ctx.fillText('keepr', textX, baseline)
  const keeprWidth = ctx.measureText('keepr').width
  ctx.font = font(type, 500)
  ctx.fillStyle = BRAND_GREEN
  ctx.fillText('one', textX + keeprWidth + type * 0.26, baseline)
}

/// The masthead of the one-page summary: the brand, who this is for, and whose
/// numbers these are.
///
/// A full-bleed dark band rather than a logo floating on white. On a page the
/// client will screenshot and forward, the first thing that has to survive
/// being seen at thumbnail size is who sent it.
function banner(ctx: Ctx, summary: ClientSummary, copy: Copy, language: ClientSummaryLanguage): void {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, PAGE_WIDTH, BAND_HEIGHT)
  ctx.fillStyle = BRAND_GREEN
  ctx.fillRect(0, BAND_HEIGHT - 3, PAGE_WIDTH, 3)

  drawLogo(ctx, MARGIN, 46, 22)

  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(9, 500)
  right(ctx, `${copy.issued} ${dayFor(language).format(summary.issuedOn).toUpperCase()}`,
    PAGE_WIDTH - MARGIN, 42)

  ctx.fillStyle = ON_BAND
  ctx.font = font(28, 700)
  ctx.fillText(summary.insuredName, MARGIN, 92)

  ctx.fillStyle = BRAND_GREEN
  ctx.font = font(10, 700)
  ctx.fillText(`${summary.productLabel.toUpperCase()}  ·  NATIONAL LIFE`, MARGIN, 112)
}

/// The full presentation's cover: one dark page carrying only the name.
function cover(ctx: Ctx, summary: ClientSummary, copy: Copy, language: ClientSummaryLanguage): void {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  drawLogo(ctx, MARGIN, 62, 26)

  const centre = PAGE_WIDTH / 2
  ctx.textAlign = 'center'

  ctx.fillStyle = BRAND_GREEN
  ctx.font = font(10, 700)
  ctx.fillText(copy.planLabel, centre, 300)

  ctx.fillStyle = ON_BAND
  ctx.font = font(42, 700)
  ctx.fillText(summary.insuredName, centre, 362)

  ctx.fillStyle = BRAND_GREEN
  ctx.fillRect(centre - 30, 388, 60, 2)

  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(13, 500)
  ctx.fillText(`${summary.productLabel} · National Life`, centre, 420)

  ctx.font = font(9, 500)
  ctx.fillText(`${copy.issued} ${dayFor(language).format(summary.issuedOn).toUpperCase()}`,
    centre, PAGE_HEIGHT - 128)
  if (summary.advisorName) {
    ctx.fillStyle = ON_BAND
    ctx.font = font(9, 700)
    ctx.fillText(`${copy.advisor}: ${summary.advisorName.toUpperCase()}`, centre, PAGE_HEIGHT - 110)
  }
  if (summary.kind === 'PROJECTED') {
    ctx.fillStyle = ON_BAND_MUTED
    ctx.font = font(8, 500)
    ctx.fillText(copy.currentValuesOnly, centre, PAGE_HEIGHT - 76)
  }

  ctx.textAlign = 'left'
}

/// The running header and footer on every page of the full presentation. Quiet
/// on purpose: the cover already introduced the document.
function pageChrome(
  ctx: Ctx, summary: ClientSummary, title: string, pageNumber: number, pageNote?: string,
): void {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  ctx.fillStyle = GOLD
  ctx.font = font(9, 700)
  ctx.fillText(title.toUpperCase(), MARGIN, MARGIN + 10)

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 500)
  right(ctx, summary.insuredName.toUpperCase(), PAGE_WIDTH - MARGIN, MARGIN + 10)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, MARGIN + 22.5)
  ctx.lineTo(PAGE_WIDTH - MARGIN, MARGIN + 22.5)
  ctx.stroke()

  ctx.fillStyle = INK_MUTED
  ctx.font = font(8, 500)
  ctx.fillText(`${summary.productLabel} · National Life`, MARGIN, PAGE_HEIGHT - MARGIN)
  if (pageNote) {
    ctx.textAlign = 'center'
    ctx.fillText(pageNote, PAGE_WIDTH / 2, PAGE_HEIGHT - MARGIN)
    ctx.textAlign = 'left'
  }
  right(ctx, String(pageNumber).padStart(2, '0'), PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN)
}

/// The three numbers the client is actually deciding on, given the whole width
/// of the page so they are read before anything else.
function headlineFigures(ctx: Ctx, summary: ClientSummary, copy: Copy, top: number): number {
  const figures: Array<[string, string]> = [
    [copy.yourCoverage, whole.format(summary.faceAmount)],
    [copy.monthlyPayment, cents.format(summary.monthlyPremium)],
    [copy.perYear, cents.format(summary.annualPremium)],
  ]
  const height = 84
  const gap = 11
  const width = (PAGE_WIDTH - MARGIN * 2 - gap * 2) / 3

  figures.forEach(([label, value], index) => {
    const x = MARGIN + index * (width + gap)
    // The face amount is the promise; the two premiums are its price. Giving
    // the first card the solid brand fill says that without a word of copy.
    const lead = index === 0
    ctx.fillStyle = lead ? TEAL : PANEL
    ctx.fillRect(x, top, width, height)
    if (!lead) {
      ctx.strokeStyle = BORDER
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, top + 0.5, width - 1, height - 1)
    }

    ctx.fillStyle = lead ? 'rgba(255, 255, 255, 0.74)' : INK_MUTED
    ctx.font = font(9, 700)
    ctx.fillText(label.toUpperCase(), x + 15, top + 26)

    ctx.fillStyle = lead ? PAPER : INK
    ctx.font = font(lead ? 26 : 22, 700)
    ctx.fillText(value, x + 15, top + 62)
  })
  return top + height
}

function sectionTitle(ctx: Ctx, title: string, baseline: number, note?: string): void {
  ctx.fillStyle = INK
  ctx.font = font(13, 700)
  ctx.fillText(title, MARGIN, baseline)
  if (note) {
    ctx.fillStyle = GOLD
    ctx.font = font(9, 700)
    right(ctx, note, PAGE_WIDTH - MARGIN, baseline)
  }
}

function coverageChart(
  ctx: Ctx, points: ClientSummaryPoint[], copy: Copy, top: number, height: number,
  guaranteed: ClientSummaryPoint[] = [],
  guaranteedLapse: { policyYear: number; age: number } | null = null,
): number {
  const width = PAGE_WIDTH - MARGIN * 2
  const plotLeft = MARGIN + 54
  const plotRight = MARGIN + width
  const plotTop = top + 34
  const plotBottom = top + height - 26

  // The qualifier sits on the chart, not in the footer. A clean rising curve is
  // exactly the thing a reader remembers as a promise, and the footer is
  // exactly the thing they do not read.
  // With both halves drawn, "not guaranteed" is no longer the whole truth
  // about the chart — one of the two curves is exactly the guaranteed one.
  sectionTitle(ctx, copy.coverageOverTime, top + 14,
    guaranteed.length > 0 ? copy.currentAndGuaranteed : copy.notGuaranteed)

  const cashPoints = points.filter(
    (point): point is ClientSummaryPoint & { cashSurrenderValue: number } =>
      point.cashSurrenderValue !== null)
  // The scale spans both series and starts at zero. A truncated axis would make
  // a flat death benefit look like a climbing one, which on a client-facing
  // page is not a styling choice.
  const ceiling = niceCeiling(Math.max(
    ...points.map((point) => point.netDeathBenefit),
    ...cashPoints.map((point) => point.cashSurrenderValue),
    ...guaranteed.map((point) => point.netDeathBenefit),
  ))
  // The axis spans both halves. Clipping the guaranteed curve at the current
  // one's last age would hide the years where the two differ most.
  const allAges = [
    ...points.map((point) => point.age),
    ...guaranteed.map((point) => point.age),
    ...(guaranteedLapse ? [guaranteedLapse.age] : []),
  ]
  const firstAge = Math.min(...allAges)
  const lastAge = Math.max(...allAges)
  const ageSpan = Math.max(lastAge - firstAge, 1)
  const xFor = (age: number) => plotLeft + ((age - firstAge) / ageSpan) * (plotRight - plotLeft)
  const yFor = (value: number) => plotBottom - (value / ceiling) * (plotBottom - plotTop)

  ctx.lineWidth = 1
  ctx.font = font(8)
  for (const fraction of [0, 0.5, 1]) {
    const y = plotBottom - fraction * (plotBottom - plotTop)
    ctx.strokeStyle = BORDER
    ctx.beginPath()
    ctx.moveTo(plotLeft, y + 0.5)
    ctx.lineTo(plotRight, y + 0.5)
    ctx.stroke()
    ctx.fillStyle = INK_MUTED
    ctx.fillText(fraction === 0 ? '$0' : compact.format(ceiling * fraction), MARGIN, y + 3)
  }

  // A wash under the death benefit, so the covered area reads as area rather
  // than as a line with empty space beneath it.
  const wash = ctx.createLinearGradient(0, plotTop, 0, plotBottom)
  wash.addColorStop(0, 'rgba(0, 85, 38, 0.17)')
  wash.addColorStop(1, 'rgba(0, 85, 38, 0.015)')
  ctx.fillStyle = wash
  ctx.beginPath()
  ctx.moveTo(xFor(firstAge), plotBottom)
  for (const point of points) ctx.lineTo(xFor(point.age), yFor(point.netDeathBenefit))
  ctx.lineTo(xFor(lastAge), plotBottom)
  ctx.closePath()
  ctx.fill()

  if (cashPoints.length > 0) {
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 1.8
    ctx.beginPath()
    cashPoints.forEach((point, index) => {
      const x = xFor(point.age)
      const y = yFor(point.cashSurrenderValue)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  // Dashed, thinner and behind the current curve: the same policy under the
  // carrier's worst permitted case. Drawn before the solid line so that where
  // the two coincide, the promise is what stays legible.
  if (guaranteed.length > 0) {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = TEAL_DEEP
    ctx.lineWidth = 1.7
    ctx.beginPath()
    guaranteed.forEach((point, index) => {
      const x = xFor(point.age)
      const y = yFor(point.netDeathBenefit)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.restore()
  }

  ctx.strokeStyle = TEAL
  ctx.lineWidth = 2.6
  ctx.beginPath()
  points.forEach((point, index) => {
    const x = xFor(point.age)
    const y = yFor(point.netDeathBenefit)
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Where the guaranteed policy ends. A curve that simply stops reads as a
  // chart that ran out of data; this says the carrier means it stops.
  if (guaranteedLapse) {
    const x = xFor(guaranteedLapse.age)
    ctx.save()
    ctx.setLineDash([2, 3])
    ctx.strokeStyle = ALERT
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + 0.5, plotTop)
    ctx.lineTo(x + 0.5, plotBottom)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = ALERT
    ctx.font = font(8, 700)
    const label = copy.lapsesAt(guaranteedLapse.age)
    const labelWidth = ctx.measureText(label).width
    // Flips to the inside of the plot when the marker sits near the right edge.
    const labelX = x + 4 + labelWidth > plotRight ? x - 4 - labelWidth : x + 4
    ctx.fillText(label, labelX, plotTop + 9)
  }

  ctx.fillStyle = INK_MUTED
  ctx.font = font(8)
  const first = points[0]!
  const last = points[points.length - 1]!
  ctx.fillText(copy.age(first.age), xFor(first.age), plotBottom + 14)
  right(ctx, copy.age(last.age), xFor(last.age), plotBottom + 14)

  let legendX = plotLeft
  const legend: Array<[string, string, boolean]> = [
    [TEAL, copy.deathBenefit, false],
    [GOLD, copy.cashValue, cashPoints.length === 0],
    [TEAL_DEEP, copy.guaranteedDeathBenefit, guaranteed.length === 0],
  ]
  for (const [colour, label, skip] of legend) {
    if (skip) continue
    ctx.fillStyle = colour
    // The guaranteed swatch is dashed, because the line it stands for is.
    if (colour === TEAL_DEEP) {
      for (const offset of [0, 6, 12]) ctx.fillRect(legendX + offset, plotBottom + 22, 4, 3)
    } else {
      ctx.fillRect(legendX, plotBottom + 22, 14, 3)
    }
    ctx.fillStyle = INK_MUTED
    ctx.font = font(8, 500)
    ctx.fillText(label, legendX + 19, plotBottom + 26)
    legendX += 19 + ctx.measureText(label).width + 18
  }

  return top + height
}

type Column = { x: number; heading: string; value: (point: ClientSummaryPoint) => string }

function projectionTable(
  ctx: Ctx, rows: ClientSummaryPoint[], columns: Column[], top: number, rowHeight: number,
): number {
  const width = PAGE_WIDTH - MARGIN * 2

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  for (const column of columns) ctx.fillText(column.heading, column.x, top + 12)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, top + 20.5)
  ctx.lineTo(MARGIN + width, top + 20.5)
  ctx.stroke()

  rows.forEach((point, index) => {
    const rowTop = top + 20 + index * rowHeight
    const baseline = rowTop + rowHeight - 9
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(MARGIN, rowTop + 1, width, rowHeight - 1)
    }
    columns.forEach((column, columnIndex) => {
      ctx.fillStyle = columnIndex === 1 ? INK_MUTED : INK
      ctx.font = font(11, columnIndex === 0 ? 700 : columnIndex === 1 ? 400 : 500)
      ctx.fillText(column.value(point), column.x, baseline)
    })
  })

  return top + 20 + rows.length * rowHeight
}

/// An em dash where the carrier gave nothing. Inventing a zero here would read
/// as "your policy is worth nothing in year 20".
function amount(value: number | null): string {
  return value === null ? '—' : whole.format(value)
}

/// Term's whole middle. Four numbers came back from the carrier, and one of
/// them is a duration — so the page states the duration and stops. There is no
/// projection behind a Term result, and a drawn coverage bar would be this page
/// asserting an end date the carrier never sent.
function termPeriod(ctx: Ctx, label: string, copy: Copy, top: number): number {
  const width = PAGE_WIDTH - MARGIN * 2
  const height = 98

  ctx.fillStyle = PANEL
  ctx.fillRect(MARGIN, top, width, height)
  ctx.fillStyle = TEAL
  ctx.fillRect(MARGIN, top, 4, height)

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  ctx.fillText(copy.yourPremium.toUpperCase(), MARGIN + 26, top + 32)

  ctx.fillStyle = TEAL_DEEP
  ctx.font = font(17, 700)
  paragraph(ctx, label, MARGIN + 26, top + 62, width - 52, 23)

  return top + height
}

/// The Term premium schedule, straight out of the carrier's Ledger.
///
/// This is the part the document used to leave out. Stating the guarantee and
/// stopping is accurate for as long as the guarantee lasts and silent about the
/// year after it, where the contractual premium can be several times larger.
/// The two cards put those two numbers side by side, because the comparison
/// between them is the decision the client is actually making; the table under
/// them shows the climb continuing, so the second card reads as the start of a
/// trend rather than as a one-off step.
///
/// Every figure here is guaranteed — a contractual maximum the carrier has
/// committed to — which is why it carries none of the hedging the projected
/// summary needs.
function termSchedule(
  ctx: Ctx, schedule: ClientSummaryTermSchedule, durationLabel: string,
  copy: Copy, top: number,
): number {
  sectionTitle(ctx, copy.premiumSchedule, top, copy.guaranteed.toUpperCase())
  // The duration used to have a panel of its own. Beside the two cards below —
  // which name the same two periods and price them — that panel was the page
  // saying the same thing twice and taking a sixth of the sheet to do it.
  ctx.fillStyle = INK_MUTED
  ctx.font = font(11)
  ctx.fillText(durationLabel, MARGIN, top + 18)

  const gap = 11
  const width = (PAGE_WIDTH - MARGIN * 2 - gap) / 2
  const height = 86
  const cardsTop = top + 30
  const cards: Array<{ label: string; annual: number; monthly: number; lead: boolean }> = [
    {
      label: copy.levelThrough(schedule.levelPeriodYears,
        schedule.rows[0]!.age + schedule.levelPeriodYears - 1),
      annual: schedule.levelAnnualPremium,
      monthly: schedule.levelMonthlyPremium,
      lead: true,
    },
  ]
  if (schedule.firstIncrease) {
    cards.push({
      label: copy.afterLevel(schedule.firstIncrease.policyYear, schedule.firstIncrease.age),
      annual: schedule.firstIncrease.annualPremium,
      monthly: schedule.firstIncrease.monthlyPremium,
      lead: false,
    })
  }

  cards.forEach((card, index) => {
    const x = MARGIN + index * (width + gap)
    const full = cards.length === 1 ? PAGE_WIDTH - MARGIN * 2 : width
    ctx.fillStyle = card.lead ? PANEL : PAPER
    ctx.fillRect(x, cardsTop, full, height)
    ctx.strokeStyle = card.lead ? BORDER : GOLD
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, cardsTop + 0.5, full - 1, height - 1)
    ctx.fillStyle = card.lead ? TEAL : GOLD
    ctx.fillRect(x, cardsTop, 4, height)

    ctx.fillStyle = INK_MUTED
    ctx.font = font(9, 700)
    ctx.fillText(card.label.toUpperCase(), x + 18, cardsTop + 26)

    ctx.fillStyle = card.lead ? TEAL_DEEP : INK
    ctx.font = font(22, 700)
    ctx.fillText(cents.format(card.monthly), x + 18, cardsTop + 56)

    ctx.fillStyle = INK_MUTED
    ctx.font = font(10)
    ctx.fillText(`${copy.perMonth} · ${cents.format(card.annual)} ${copy.perYear.toLowerCase()}`,
      x + 18, cardsTop + 74)
  })

  const tableTop = cardsTop + height + 16
  const tableWidth = PAGE_WIDTH - MARGIN * 2
  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  ctx.fillText(copy.policyYearColumn, MARGIN + 14, tableTop + 12)
  ctx.fillText(copy.ageColumn, MARGIN + 150, tableTop + 12)
  ctx.fillText(copy.premiumColumn, MARGIN + 250, tableTop + 12)
  ctx.fillText(copy.deathBenefitColumn, MARGIN + 400, tableTop + 12)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, tableTop + 20.5)
  ctx.lineTo(MARGIN + tableWidth, tableTop + 20.5)
  ctx.stroke()

  const rowHeight = 26
  schedule.rows.forEach((row, index) => {
    const rowTop = tableTop + 20 + index * rowHeight
    const baseline = rowTop + rowHeight - 8
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(MARGIN, rowTop + 1, tableWidth, rowHeight - 1)
    }
    // The year the premium first moves is the one the client came for, so it
    // is the one the eye should land on without being told where to look.
    const isIncrease = schedule.firstIncrease !== null &&
      row.policyYear === schedule.firstIncrease.policyYear
    ctx.fillStyle = INK
    ctx.font = font(11, 700)
    ctx.fillText(copy.year(row.policyYear), MARGIN + 14, baseline)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(11)
    ctx.fillText(String(row.age), MARGIN + 150, baseline)
    ctx.fillStyle = isIncrease ? GOLD : INK
    ctx.font = font(11, 700)
    ctx.fillText(cents.format(row.guaranteedAnnualPremium), MARGIN + 250, baseline)
    ctx.fillStyle = INK
    ctx.font = font(11, 500)
    ctx.fillText(whole.format(row.guaranteedDeathBenefit), MARGIN + 400, baseline)
  })

  const afterTable = tableTop + 20 + schedule.rows.length * rowHeight
  ctx.fillStyle = INK_MUTED
  ctx.font = font(10)
  return paragraph(
    ctx,
    copy.scheduleNote(whole.format(schedule.deathBenefit), schedule.finalAge),
    MARGIN, afterTable + 16, tableWidth, 14,
  )
}

/// Um gráfico por página, com espaço suficiente para ler eixo, cenário e ponto.
/// Cada vértice é um registro publicado; não há spline, média ou extrapolação.
function policyMetricChart(
  ctx: Ctx,
  copy: Copy,
  values: ClientSummaryScenarios['deathBenefit'],
  labelYears: number[],
  top: number,
  currentLapse: { year: number | null; age: number | null },
  insight: { label: string; value: string } | null = null,
): number {
  const drawn = values.current
  const firstYear = Math.min(...drawn.map((point) => point.policyYear))
  const lastYear = Math.max(...drawn.map((point) => point.policyYear))
  const yearSpan = Math.max(lastYear - firstYear, 1)
  const ceiling = niceCeiling(Math.max(...drawn.map((point) => point.value)))
  const plotLeft = MARGIN + 62
  const plotRight = PAGE_WIDTH - MARGIN
  const plotTop = top + 92
  const plotBottom = top + 430
  const xFor = (year: number) => plotLeft + ((year - firstYear) / yearSpan) * (plotRight - plotLeft)
  const yFor = (value: number) => plotBottom - (value / ceiling) * (plotBottom - plotTop)

  // The customer-facing story follows the current illustration. Guaranteed
  // assumptions remain in the disclosure, but they no longer compete with the
  // question this page answers.
  ctx.fillStyle = GOLD
  ctx.fillRect(MARGIN, top + 16, 24, 3)
  ctx.fillStyle = INK
  ctx.font = font(10, 700)
  ctx.fillText(copy.currentValuesOnly.toUpperCase(), MARGIN + 34, top + 21)
  ctx.fillStyle = INK_MUTED
  ctx.font = font(9)
  ctx.fillText(copy.scenarioCurrentBody, MARGIN + 34, top + 37)

  ctx.font = font(8)
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - fraction * (plotBottom - plotTop)
    ctx.strokeStyle = fraction === 0 ? INK_MUTED : BORDER
    ctx.lineWidth = fraction === 0 ? 1.2 : 0.8
    ctx.beginPath()
    ctx.moveTo(plotLeft, y + 0.5)
    ctx.lineTo(plotRight, y + 0.5)
    ctx.stroke()
    ctx.fillStyle = INK_MUTED
    right(ctx, fraction === 0 ? '$0' : compact.format(ceiling * fraction), plotLeft - 10, y + 3)
  }

  const ageForYear = (year: number) =>
    drawn.find((point) => point.policyYear === year)?.age ?? null
  const axisYears = [...new Set([
    firstYear,
    ...labelYears,
    lastYear,
  ])].filter((year) => year >= firstYear && year <= lastYear).sort((a, b) => a - b)

  axisYears.forEach((year) => {
    const x = xFor(year)
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(x + 0.5, plotBottom)
    ctx.lineTo(x + 0.5, plotBottom + 6)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.font = font(8, 700)
    const yearLabel = String(year)
    ctx.fillText(yearLabel, x - ctx.measureText(yearLabel).width / 2, plotBottom + 19)
    const age = ageForYear(year)
    if (age !== null) {
      ctx.fillStyle = INK_MUTED
      ctx.font = font(7.5)
      const ageLabel = copy.age(age)
      ctx.fillText(ageLabel, x - ctx.measureText(ageLabel).width / 2, plotBottom + 32)
    }
  })

  const series = (
    points: ClientSummaryScenarios['deathBenefit']['current'],
    colour: string,
    dashed: boolean,
  ) => {
    ctx.save()
    if (dashed) ctx.setLineDash([7, 5])
    ctx.strokeStyle = colour
    ctx.lineWidth = dashed ? 2.2 : 3
    ctx.lineJoin = 'round'
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = xFor(point.policyYear)
      const y = yFor(point.value)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.restore()

    points.forEach((point) => {
      ctx.fillStyle = PAPER
      ctx.strokeStyle = colour
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(xFor(point.policyYear), yFor(point.value), 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
  }

  series(values.current, GOLD, false)

  ctx.fillStyle = INK_MUTED
  ctx.font = font(8)
  ctx.fillText(copy.chartAxisNote, plotLeft, plotBottom + 54)
  ctx.font = font(9)
  const afterNote = paragraph(
    ctx, copy.publishedPointsNote, MARGIN, plotBottom + 78, PAGE_WIDTH - MARGIN * 2, 13)

  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(MARGIN, afterNote + 18.5)
  ctx.lineTo(PAGE_WIDTH - MARGIN, afterNote + 18.5)
  ctx.stroke()
  ctx.fillStyle = INK_MUTED
  ctx.font = font(8, 700)
  ctx.fillText(copy.chartCurrentEnding.toUpperCase(), MARGIN, afterNote + 38)
  ctx.fillStyle = currentLapse.year === null ? INK : ALERT
  ctx.font = font(10, 700)
  ctx.fillText(
    currentLapse.year === null || currentLapse.age === null
      ? copy.neverEnds
      : copy.endsInYear(currentLapse.year, currentLapse.age),
    MARGIN, afterNote + 55,
  )
  if (insight) {
    const x = MARGIN + 270
    ctx.fillStyle = INK_MUTED
    ctx.font = font(8, 700)
    ctx.fillText(insight.label.toUpperCase(), x, afterNote + 38)
    ctx.fillStyle = TEAL_DEEP
    ctx.font = font(10, 700)
    ctx.fillText(insight.value, x, afterNote + 55)
  }
  return afterNote + 55
}

function surrenderAnalysis(
  ctx: Ctx, insights: ClientPolicyInsights | null, copy: Copy, top: number,
): number {
  sectionTitle(ctx, copy.firstBreakEven, top, copy.currentValuesOnly)
  ctx.fillStyle = insights?.breakEven ? TEAL_DEEP : INK_MUTED
  ctx.font = font(insights?.breakEven ? 24 : 11, insights?.breakEven ? 700 : 500)
  const finding = insights?.breakEvenWindow
    ? copy.breakEvenWindow(insights.breakEvenWindow.afterYear, insights.breakEvenWindow.byYear)
    : insights?.breakEven
      ? copy.breakEvenAt(insights.breakEven.policyYear, insights.breakEven.age)
      : insights && insights.contributionBasis !== 'UNAVAILABLE'
        ? copy.noBreakEven : copy.breakEvenUnavailable
  const afterFinding = paragraph(
    ctx, finding, MARGIN, top + 32, PAGE_WIDTH - MARGIN * 2, insights?.breakEven ? 28 : 16)

  const rows = insights?.checkpoints ?? []
  const tableTop = afterFinding + 38
  const columns = [MARGIN + 12, MARGIN + 105, MARGIN + 170, MARGIN + 285, MARGIN + 405]
  const headings = [
    copy.policyYearColumn, copy.ageColumn, copy.totalPaidColumn,
    copy.cashValueColumnShort, copy.differenceColumn,
  ]
  ctx.fillStyle = INK_MUTED
  ctx.font = font(8, 700)
  headings.forEach((heading, index) => ctx.fillText(heading, columns[index]!, tableTop + 12))
  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(MARGIN, tableTop + 20.5)
  ctx.lineTo(PAGE_WIDTH - MARGIN, tableTop + 20.5)
  ctx.stroke()

  rows.forEach((row, index) => {
    const rowTop = tableTop + 21 + index * 42
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(MARGIN, rowTop, PAGE_WIDTH - MARGIN * 2, 41)
    }
    const baseline = rowTop + 26
    ctx.fillStyle = INK
    ctx.font = font(10, 700)
    ctx.fillText(copy.year(row.policyYear), columns[0]!, baseline)
    ctx.font = font(10)
    ctx.fillText(String(row.age), columns[1]!, baseline)
    ctx.fillText(row.totalPaid === null ? '—' : whole.format(row.totalPaid), columns[2]!, baseline)
    ctx.font = font(10, 700)
    ctx.fillText(whole.format(row.cashSurrenderValue), columns[3]!, baseline)
    const difference = row.surrenderDifference
    ctx.fillStyle = difference !== null && difference >= 0 ? TEAL_DEEP : INK_MUTED
    ctx.fillText(difference === null ? '—' : `${difference >= 0 ? '+' : '−'}${whole.format(Math.abs(difference))}`,
      columns[4]!, baseline)
  })

  const afterTable = tableTop + 21 + rows.length * 42
  ctx.fillStyle = INK_MUTED
  ctx.font = font(9.5)
  return paragraph(ctx, copy.notSurrenderAdvice, MARGIN, afterTable + 28,
    PAGE_WIDTH - MARGIN * 2, 14)
}

/// Closes the page under whatever content there was.
///
/// The projected summary fills the sheet, so its footer sits at the bottom
/// margin. Term produces four facts and stops, and pinning its footer to the
/// bottom left a hole in the middle of the page that read as a document that
/// failed to finish rendering. Letting the close follow the content instead
/// gives a short letter's shape — text, sign-off, then blank paper.
function footer(
  ctx: Ctx, summary: ClientSummary, copy: Copy, language: ClientSummaryLanguage,
  contentBottom: number,
): void {
  const width = PAGE_WIDTH - MARGIN * 2
  const top = Math.min(Math.max(contentBottom + 46, 0), PAGE_HEIGHT - MARGIN - 74)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, top - 14.5)
  ctx.lineTo(MARGIN + width, top - 14.5)
  ctx.stroke()

  ctx.fillStyle = INK_MUTED
  ctx.font = font(7.6)
  // Term credits no interest, so the permanent-policy condition would describe
  // an assumption its contract does not contain.
  const disclaimer = summary.kind === 'LEVEL_TERM'
    ? CLIENT_SUMMARY_TERM_DISCLAIMER
    : CLIENT_SUMMARY_DISCLAIMER
  const afterDisclaimer = paragraph(ctx, disclaimer, MARGIN, top, width, 10)

  ctx.fillStyle = INK
  ctx.font = font(7.6, 700)
  ctx.fillText(copy.sourceLine(dayFor(language).format(summary.issuedOn)), MARGIN, afterDisclaimer + 4)
}

function quickPage(
  document: PDFDocument, summary: ClientSummary, copy: Copy, language: ClientSummaryLanguage,
): void {
  const ctx = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  banner(ctx, summary, copy, language)

  let contentBottom: number
  if (summary.kind === 'PROJECTED') {
    const afterFigures = headlineFigures(ctx, summary, copy, BAND_HEIGHT + 30)
    if (summary.scenarios) {
      sectionTitle(ctx, copy.yearByYear, afterFigures + 34, copy.currentValuesOnly)
      const points = summary.scenarios.rows.map((row) => ({
        policyYear: row.policyYear, age: row.age,
        netDeathBenefit: row.current.netDeathBenefit,
        cashSurrenderValue: row.current.cashSurrenderValue,
        premiumOutlay: null, accumulatedValue: null,
      }))
      const afterTable = projectionTable(ctx, points, [
        { x: MARGIN + 14, heading: copy.policyYearColumn, value: (p) => copy.year(p.policyYear) },
        { x: MARGIN + 150, heading: copy.ageColumn, value: (p) => String(p.age) },
        { x: MARGIN + 250, heading: copy.deathBenefitColumn, value: (p) => amount(p.netDeathBenefit) },
        { x: MARGIN + 400, heading: copy.cashValueColumn, value: (p) => amount(p.cashSurrenderValue) },
      ], afterFigures + 55, 29)
      ctx.fillStyle = INK_MUTED
      ctx.font = font(8.5)
      const afterNote = paragraph(
        ctx, copy.scenarioCurrentBody, MARGIN, afterTable + 14, PAGE_WIDTH - MARGIN * 2, 12)
      const currentEnd = summary.scenarios.lapseYear.current !== null &&
        summary.scenarios.lapseAge.current !== null
        ? copy.endsInYear(summary.scenarios.lapseYear.current, summary.scenarios.lapseAge.current)
        : null
      if (currentEnd) {
        ctx.fillStyle = ALERT
        ctx.font = font(9, 700)
        ctx.fillText(currentEnd, MARGIN, afterNote + 18)
      }
      contentBottom = currentEnd ? afterNote + 18 : afterNote
      footer(ctx, summary, copy, language, contentBottom)
      document.endPage()
      return
    }
    // The chart gives up height when there is a lapse sentence to fit under the
    // table. A curve twenty points shorter still reads; a sentence pushed into
    // the footer does not.
    const chartHeight = summary.guaranteedLapse === null ? 200 : 168
    const afterChart = coverageChart(ctx, summary.coverage, copy, afterFigures + 26, chartHeight,
      summary.guaranteed, summary.guaranteedLapse)
    // A tabela é de premissas atuais, e a frase sobre o encerramento logo
    // abaixo é das garantidas. Sem dizer isso, o cliente lê um valor de resgate
    // aos 90 anos ao lado de uma apólice que se encerra aos 79 e não tem como
    // reconciliar os dois — a mesma razão pela qual o gráfico carrega a
    // ressalva em cima, e não no rodapé.
    ctx.fillStyle = GOLD
    ctx.font = font(9, 700)
    right(ctx, copy.notGuaranteed, PAGE_WIDTH - MARGIN, afterChart + 20)
    contentBottom = projectionTable(ctx, summary.milestones, [
      { x: MARGIN + 14, heading: copy.policyYearColumn, value: (p) => copy.year(p.policyYear) },
      { x: MARGIN + 150, heading: copy.ageColumn, value: (p) => String(p.age) },
      { x: MARGIN + 250, heading: copy.deathBenefitColumn, value: (p) => amount(p.netDeathBenefit) },
      { x: MARGIN + 400, heading: copy.cashValueColumn, value: (p) => amount(p.cashSurrenderValue) },
    ], afterChart + 30, 26)
    // The marker on the chart is three words in eight-point type. Left alone it
    // is a red mark a client can read as decoration; this is the sentence that
    // says what it means. The full presentation states it on the outlook page —
    // the one-pager has no later page to defer to, so it says it here.
    if (summary.guaranteedLapse !== null) {
      ctx.fillStyle = ALERT
      ctx.font = font(10, 500)
      contentBottom = paragraph(
        ctx,
        copy.guaranteedLapseNote(summary.guaranteedLapse.policyYear, summary.guaranteedLapse.age),
        MARGIN, contentBottom + 20, PAGE_WIDTH - MARGIN * 2, 13)
    }
  } else {
    const afterFigures = headlineFigures(ctx, summary, copy, BAND_HEIGHT + 38)
    contentBottom = summary.schedule
      ? termSchedule(ctx, summary.schedule, copy.termDuration[summary.termDuration],
        copy, afterFigures + 30)
      : termPeriod(ctx, copy.termDuration[summary.termDuration], copy, afterFigures + 30)
  }

  footer(ctx, summary, copy, language, contentBottom)
  document.endPage()
}

function outlookPage(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  language: ClientSummaryLanguage, pageNumber = 4,
): void {
  pageChrome(ctx, summary, summary.outlook ? copy.whatYouPutIn : copy.importantInformation, pageNumber)
  let bottom = MARGIN + 46

  if (summary.outlook) {
    const figures: Array<[string, string, boolean]> = [
      [copy.totalContributions, whole.format(summary.outlook.totalContributions), false],
      [copy.accumulatedAt(summary.outlook.age), whole.format(summary.outlook.accumulatedValue), true],
      [copy.growth, whole.format(summary.outlook.growth), false],
    ]
    figures.forEach(([label, value, lead], index) => {
      const top = bottom + index * 92
      ctx.fillStyle = lead ? TEAL : PANEL
      ctx.fillRect(MARGIN, top, PAGE_WIDTH - MARGIN * 2, 78)
      ctx.fillStyle = lead ? 'rgba(255, 255, 255, 0.74)' : INK_MUTED
      ctx.font = font(9, 700)
      ctx.fillText(label.toUpperCase(), MARGIN + 20, top + 27)
      ctx.fillStyle = lead ? PAPER : INK
      ctx.font = font(28, 700)
      ctx.fillText(value, MARGIN + 20, top + 62)
    })
    bottom += figures.length * 92 - 14
    ctx.fillStyle = GOLD
    ctx.font = font(9, 700)
    ctx.fillText(copy.notGuaranteed, MARGIN, bottom + 6)
    bottom += 6
  } else {
    sectionTitle(ctx, copy.currentValuesOnly, bottom + 14)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(10.5)
    bottom = paragraph(ctx, copy.scenarioCurrentBody, MARGIN, bottom + 42,
      PAGE_WIDTH - MARGIN * 2, 16)
    ctx.strokeStyle = BORDER
    ctx.beginPath()
    ctx.moveTo(MARGIN, bottom + 28.5)
    ctx.lineTo(PAGE_WIDTH - MARGIN, bottom + 28.5)
    ctx.stroke()
    sectionTitle(ctx, copy.scenarioGuaranteed, bottom + 64)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(10.5)
    bottom = paragraph(ctx, copy.scenarioGuaranteedBody, MARGIN, bottom + 92,
      PAGE_WIDTH - MARGIN * 2, 16)
  }

  // The carrier's own warnings, when it issued any. They belong on the page
  // that talks about the money, not buried beside the disclaimer.
  const notes: Array<[string, string]> = [
    summary.lapseYear !== null ? [INK, copy.lapseNote(summary.lapseYear)] : null,
    summary.mecYear !== null ? [INK, copy.mecNote(summary.mecYear)] : null,
    // Stated in words as well as drawn. The marker on the chart is a label a
    // reader can pass over; this is the sentence that says what it means, and
    // it is the one thing a current-values-only page could never tell them.
    // In the same colour it carries on the one-pager, so a client holding both
    // does not meet the same sentence twice with two different weights.
    summary.guaranteedLapse !== null
      ? [ALERT, copy.guaranteedLapseNote(
        summary.guaranteedLapse.policyYear, summary.guaranteedLapse.age)]
      : null,
  ].filter((note): note is [string, string] => note !== null)
  for (const [colour, note] of notes) {
    ctx.fillStyle = colour
    ctx.font = font(10, 500)
    bottom = paragraph(ctx, note, MARGIN, bottom + 26, PAGE_WIDTH - MARGIN * 2, 15)
  }

  ctx.fillStyle = INK
  ctx.font = font(13, 700)
  ctx.fillText(copy.nextStep, MARGIN, bottom + 40)
  ctx.fillStyle = INK_MUTED
  ctx.font = font(10)
  bottom = paragraph(ctx, copy.nextStepBody, MARGIN, bottom + 62, PAGE_WIDTH - MARGIN * 2, 15)
  if (summary.advisorName) {
    ctx.fillStyle = INK
    ctx.font = font(10, 700)
    ctx.fillText(`${copy.advisor}: ${summary.advisorName}`, MARGIN, bottom + 14)
    bottom += 14
  }

  footer(ctx, summary, copy, language, bottom)
}

/// A tabela ano a ano do Term, no molde da `projectionTable` do lado projetado.
///
/// Não reusa aquela função porque as linhas são de outro tipo: um degrau de
/// Term é prêmio garantido e benefício por morte garantido, não valor
/// acumulado e valor de resgate. Forçar os dois no mesmo tipo pediria campos
/// opcionais que cada lado teria de ignorar, e um `—` num deles seria a página
/// dizendo que o dado falta quando ele nunca existiu.
function termYearTable(
  ctx: Ctx, rows: ForesightTermLedgerRow[], firstIncreaseYear: number | null,
  copy: Copy, top: number, rowHeight: number,
): number {
  const width = PAGE_WIDTH - MARGIN * 2
  const columns: Array<[string, number]> = [
    [copy.policyYearColumn, MARGIN + 14],
    [copy.ageColumn, MARGIN + 150],
    [copy.premiumColumn, MARGIN + 250],
    [copy.deathBenefitColumn, MARGIN + 400],
  ]

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  for (const [heading, x] of columns) ctx.fillText(heading, x, top + 12)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, top + 20.5)
  ctx.lineTo(MARGIN + width, top + 20.5)
  ctx.stroke()

  rows.forEach((row, index) => {
    const rowTop = top + 20 + index * rowHeight
    const baseline = rowTop + rowHeight - 9
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(MARGIN, rowTop + 1, width, rowHeight - 1)
    }
    // O mesmo destaque da folha única: o ano em que o prêmio se mexe é o que o
    // cliente veio ver, e continua sendo o que o olho deve achar sozinho.
    const isIncrease = firstIncreaseYear !== null && row.policyYear === firstIncreaseYear
    ctx.fillStyle = INK
    ctx.font = font(11, 700)
    ctx.fillText(copy.year(row.policyYear), MARGIN + 14, baseline)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(11)
    ctx.fillText(String(row.age), MARGIN + 150, baseline)
    ctx.fillStyle = isIncrease ? GOLD : INK
    ctx.font = font(11, 700)
    ctx.fillText(cents.format(row.guaranteedAnnualPremium), MARGIN + 250, baseline)
    ctx.fillStyle = INK
    ctx.font = font(11, 500)
    ctx.fillText(whole.format(row.guaranteedDeathBenefit), MARGIN + 400, baseline)
  })

  return top + 20 + rows.length * rowHeight
}

/// A apresentação de várias páginas do Term.
///
/// Três páginas, não quatro: não há página de perspectiva porque não há
/// projeção — todo número aqui é um máximo contratual que a seguradora já
/// assumiu. Inventar a quarta folha seria o preenchimento que este documento
/// justamente não pode fazer, e foi por isso que o Term não tinha apresentação
/// nenhuma até agora. O que ele tem, e que a folha única espreme, é o ledger:
/// a página inteira da tabela é a razão desta variante existir.
function termFullPages(
  document: PDFDocument, summary: ClientSummary & { kind: 'LEVEL_TERM' },
  schedule: ClientSummaryTermSchedule, copy: Copy, language: ClientSummaryLanguage,
): void {
  cover(document.beginPage(PAGE_WIDTH, PAGE_HEIGHT), summary, copy, language)
  document.endPage()

  const plan = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  pageChrome(plan, summary, copy.yourPlan, 2)
  const afterFigures = headlineFigures(plan, summary, copy, MARGIN + 60)
  termSchedule(plan, schedule, copy.termDuration[summary.termDuration], copy, afterFigures + 36)
  document.endPage()

  const table = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  pageChrome(table, summary, copy.yearByYear, 3)
  const afterTable = termYearTable(
    table, schedule.fullRows, schedule.firstIncrease?.policyYear ?? null,
    copy, MARGIN + 66, 30,
  )
  table.fillStyle = INK_MUTED
  table.font = font(10)
  paragraph(
    table,
    copy.scheduleNote(whole.format(schedule.deathBenefit), schedule.finalAge),
    MARGIN, afterTable + 18, PAGE_WIDTH - MARGIN * 2, 14,
  )
  document.endPage()
}

function reportChrome(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  section: string, pageNumber: number,
): void {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, REPORT_WIDTH, REPORT_HEIGHT)
  ctx.strokeStyle = '#c9a33a'
  ctx.lineWidth = 0.7
  ctx.strokeRect(24.5, 24.5, REPORT_WIDTH - 49, REPORT_HEIGHT - 49)
  ctx.fillStyle = GOLD
  ctx.font = font(8, 700)
  ctx.fillText(section.toUpperCase(), REPORT_MARGIN, REPORT_MARGIN + 4)
  ctx.fillStyle = INK_MUTED
  ctx.font = font(7.5, 500)
  ctx.fillText(`${summary.insuredName.toUpperCase()} · ${summary.productLabel.toUpperCase()}`,
    REPORT_MARGIN, REPORT_HEIGHT - 36)
  ctx.textAlign = 'center'
  ctx.fillText(copy.currentValuesOnly, REPORT_WIDTH / 2, REPORT_HEIGHT - 36)
  ctx.textAlign = 'right'
  ctx.fillText(String(pageNumber).padStart(2, '0'), REPORT_WIDTH - REPORT_MARGIN, REPORT_HEIGHT - 36)
  ctx.textAlign = 'left'
}

function reportCover(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  language: ClientSummaryLanguage,
): void {
  ctx.fillStyle = '#08130d'
  ctx.fillRect(0, 0, REPORT_WIDTH, REPORT_HEIGHT)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 0.8
  ctx.strokeRect(24.5, 24.5, REPORT_WIDTH - 49, REPORT_HEIGHT - 49)
  drawLogoMark(ctx, REPORT_MARGIN, REPORT_MARGIN, 31)
  ctx.fillStyle = ON_BAND
  ctx.font = font(18, 700)
  ctx.fillText('keepr', REPORT_MARGIN + 40, REPORT_MARGIN + 23)
  ctx.fillStyle = BRAND_GREEN
  ctx.fillText('one', REPORT_MARGIN + 90, REPORT_MARGIN + 23)

  ctx.fillStyle = BRAND_GREEN
  ctx.font = font(9, 700)
  ctx.textAlign = 'center'
  ctx.fillText(copy.reportTitle.toUpperCase(), REPORT_WIDTH / 2, 216)
  ctx.fillStyle = ON_BAND
  ctx.font = font(43, 300)
  ctx.fillText(summary.insuredName, REPORT_WIDTH / 2, 274)
  ctx.strokeStyle = BRAND_GREEN
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(REPORT_WIDTH / 2 - 42, 302)
  ctx.lineTo(REPORT_WIDTH / 2 + 42, 302)
  ctx.stroke()
  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(14, 400)
  paragraph(ctx, copy.reportSubtitle, REPORT_WIDTH / 2, 337, 500, 20)

  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(8, 500)
  ctx.fillText(`${copy.issued} ${dayFor(language).format(summary.issuedOn).toUpperCase()}`,
    REPORT_WIDTH / 2, REPORT_HEIGHT - 106)
  if (summary.advisorName) {
    ctx.fillStyle = ON_BAND
    ctx.font = font(8, 700)
    ctx.fillText(`${copy.advisor}: ${summary.advisorName.toUpperCase()}`,
      REPORT_WIDTH / 2, REPORT_HEIGHT - 86)
  }
  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(7.5, 500)
  ctx.fillText(copy.currentValuesOnly, REPORT_WIDTH / 2, REPORT_HEIGHT - 55)
  ctx.textAlign = 'left'
}

function reportExecutivePage(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
): void {
  reportChrome(ctx, summary, copy, copy.reportTitle, 2)
  ctx.fillStyle = INK
  ctx.font = font(34, 300)
  paragraph(ctx, copy.executiveReading, REPORT_MARGIN, 92, 420, 38)
  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(REPORT_MARGIN, 150.5)
  ctx.lineTo(REPORT_WIDTH - REPORT_MARGIN, 150.5)
  ctx.stroke()

  const facts: Array<[string, string]> = [
    [copy.yourCoverage, whole.format(summary.faceAmount)],
    [copy.monthlyPayment, cents.format(summary.monthlyPremium)],
    [copy.perYear, cents.format(summary.annualPremium)],
  ]
  facts.forEach(([label, value], index) => {
    const y = 202 + index * 82
    ctx.fillStyle = INK_MUTED
    ctx.font = font(8, 700)
    ctx.fillText(label.toUpperCase(), REPORT_MARGIN, y)
    ctx.fillStyle = index === 0 ? TEAL_DEEP : INK
    ctx.font = font(index === 0 ? 26 : 22, 700)
    ctx.fillText(value, REPORT_MARGIN, y + 31)
  })

  const panelX = 460
  ctx.fillStyle = '#08130d'
  ctx.fillRect(panelX, 174, 290, 310)
  ctx.fillStyle = BRAND_GREEN
  ctx.font = font(8, 700)
  paragraph(ctx, copy.verifiedSource.toUpperCase(), panelX + 24, 207, 240, 11)
  const questions = [copy.protectionQuestion, copy.cashQuestion, copy.surrenderQuestion]
  questions.forEach((question, index) => {
    const y = 246 + index * 72
    ctx.fillStyle = index === 0 ? GOLD : BRAND_GREEN
    ctx.font = font(18, 700)
    ctx.fillText(String(index + 1).padStart(2, '0'), panelX + 24, y)
    ctx.fillStyle = ON_BAND
    ctx.font = font(11, 500)
    paragraph(ctx, question, panelX + 64, y - 3, 198, 15)
  })
}

function reportMetricPage(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  pageNumber: number, title: string, question: string,
  points: ClientSummaryScenarios['deathBenefit']['current'],
  highlightYears: number[],
): void {
  reportChrome(ctx, summary, copy, title, pageNumber)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = font(31, 300)
  paragraph(ctx, question, REPORT_MARGIN, 88, 650, 35)
  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(REPORT_MARGIN, 151.5)
  ctx.lineTo(REPORT_WIDTH - REPORT_MARGIN, 151.5)
  ctx.stroke()

  const plotLeft = REPORT_MARGIN + 58
  const plotRight = 530
  const plotTop = 190
  const plotBottom = 468
  const firstYear = Math.min(...points.map((point) => point.policyYear))
  const lastYear = Math.max(...points.map((point) => point.policyYear))
  const ceiling = niceCeiling(Math.max(...points.map((point) => point.value)))
  const xFor = (year: number) => plotLeft + ((year - firstYear) / Math.max(lastYear - firstYear, 1)) * (plotRight - plotLeft)
  const yFor = (value: number) => plotBottom - (value / ceiling) * (plotBottom - plotTop)
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - fraction * (plotBottom - plotTop)
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(plotLeft, y + 0.5)
    ctx.lineTo(plotRight, y + 0.5)
    ctx.stroke()
    ctx.fillStyle = INK_MUTED
    ctx.font = font(7.5)
    right(ctx, fraction === 0 ? '$0' : compact.format(ceiling * fraction), plotLeft - 10, y + 3)
  }
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(xFor(point.policyYear), yFor(point.value))
    else ctx.lineTo(xFor(point.policyYear), yFor(point.value))
  })
  ctx.stroke()
  points.forEach((point) => {
    ctx.fillStyle = PAPER
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 1.7
    ctx.beginPath()
    ctx.arc(xFor(point.policyYear), yFor(point.value), 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })

  const labeled = [...new Set([firstYear, ...highlightYears, lastYear])]
    .filter((year) => points.some((point) => point.policyYear === year))
    .sort((a, b) => a - b)
  labeled.forEach((year) => {
    const point = points.find((candidate) => candidate.policyYear === year)!
    const x = xFor(year)
    ctx.fillStyle = INK
    ctx.font = font(8, 700)
    ctx.textAlign = 'center'
    ctx.fillText(String(year), x, plotBottom + 18)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(7)
    ctx.fillText(copy.age(point.age), x, plotBottom + 31)
  })
  ctx.textAlign = 'left'

  const sideX = 575
  ctx.fillStyle = INK
  ctx.font = font(15, 700)
  ctx.fillText(copy.selectedMilestones, sideX, 190)
  const milestones = labeled.slice(-4)
  milestones.forEach((year, index) => {
    const point = points.find((candidate) => candidate.policyYear === year)!
    const y = 229 + index * 66
    ctx.strokeStyle = BORDER
    ctx.beginPath()
    ctx.moveTo(sideX, y - 15.5)
    ctx.lineTo(REPORT_WIDTH - REPORT_MARGIN, y - 15.5)
    ctx.stroke()
    ctx.fillStyle = INK_MUTED
    ctx.font = font(8, 700)
    ctx.fillText(`${copy.year(year)} · ${copy.age(point.age)}`.toUpperCase(), sideX, y)
    ctx.fillStyle = index === milestones.length - 1 ? TEAL_DEEP : INK
    ctx.font = font(16, 700)
    ctx.fillText(whole.format(point.value), sideX, y + 24)
  })
  ctx.fillStyle = INK_MUTED
  ctx.font = font(8)
  paragraph(ctx, copy.publishedPointsNote, sideX, 500, REPORT_WIDTH - REPORT_MARGIN - sideX, 11)
}

function reportSurrenderPage(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  insights: ClientPolicyInsights | null,
): void {
  reportChrome(ctx, summary, copy, copy.surrenderTiming, 5)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = font(31, 300)
  paragraph(ctx, copy.surrenderQuestion, REPORT_MARGIN, 88, 650, 35)
  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(REPORT_MARGIN, 151.5)
  ctx.lineTo(REPORT_WIDTH - REPORT_MARGIN, 151.5)
  ctx.stroke()

  const finding = insights?.breakEvenWindow
    ? copy.breakEvenWindow(insights.breakEvenWindow.afterYear, insights.breakEvenWindow.byYear)
    : insights?.breakEven
      ? copy.breakEvenAt(insights.breakEven.policyYear, insights.breakEven.age)
      : insights && insights.contributionBasis !== 'UNAVAILABLE'
        ? copy.noBreakEven : copy.breakEvenUnavailable
  const hasBreakEvenFinding = Boolean(insights?.breakEven || insights?.breakEvenWindow)
  ctx.fillStyle = hasBreakEvenFinding ? TEAL_DEEP : INK_MUTED
  ctx.font = font(hasBreakEvenFinding ? 17 : 11, hasBreakEvenFinding ? 700 : 500)
  paragraph(ctx, finding, REPORT_MARGIN, 188, 690, hasBreakEvenFinding ? 21 : 16)

  const rows = insights?.checkpoints.slice(0, 6) ?? []
  const top = 270
  const columns = [REPORT_MARGIN + 10, 120, 154, 246, 350, 470, 610]
  const columnWidths = [58, 28, 82, 94, 108, 128, 136]
  const headings = [copy.policyYearColumn, copy.ageColumn, copy.premiumColumn,
    copy.totalPaidColumn, copy.cashValueColumnShort, copy.differenceColumn,
    copy.deathBenefitColumnShort]
  ctx.fillStyle = INK_MUTED
  ctx.font = font(6.8, 700)
  headings.forEach((heading, index) => {
    paragraph(ctx, heading, columns[index]!, top, columnWidths[index]!, 8)
  })
  rows.forEach((row, index) => {
    const y = top + 34 + index * 39
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(REPORT_MARGIN, y - 18, REPORT_WIDTH - REPORT_MARGIN * 2, 34)
    }
    const values = [copy.year(row.policyYear), String(row.age),
      row.premiumOutlay === null ? '—' : whole.format(row.premiumOutlay),
      row.totalPaid === null ? '—' : whole.format(row.totalPaid),
      whole.format(row.cashSurrenderValue),
      row.surrenderDifference === null ? '—' : `${row.surrenderDifference >= 0 ? '+' : '−'}${whole.format(Math.abs(row.surrenderDifference))}`,
      whole.format(row.netDeathBenefit)]
    values.forEach((value, cell) => {
      ctx.fillStyle = cell === 4 ? TEAL_DEEP : INK
      ctx.font = font(8.5, cell === 0 || cell === 4 ? 700 : 500)
      ctx.fillText(value, columns[cell]!, y)
    })
  })
  ctx.fillStyle = INK_MUTED
  ctx.font = font(8.5)
  paragraph(ctx, copy.notSurrenderAdvice, REPORT_MARGIN, 510,
    REPORT_WIDTH - REPORT_MARGIN * 2, 12)
}

function reportDetailsPage(
  ctx: Ctx, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  language: ClientSummaryLanguage,
): void {
  reportChrome(ctx, summary, copy, copy.reportTitle, 6)
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = font(31, 300)
  ctx.fillText(copy.importantInformation, REPORT_MARGIN, 110)
  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(REPORT_MARGIN, 136.5)
  ctx.lineTo(REPORT_WIDTH - REPORT_MARGIN, 136.5)
  ctx.stroke()

  const sections: Array<[string, string]> = [
    [copy.currentValuesOnly, copy.scenarioCurrentBody],
    [copy.scenarioGuaranteed, copy.scenarioGuaranteedBody],
    [copy.nextStep, copy.reportClose],
  ]
  sections.forEach(([title, body], index) => {
    const y = 180 + index * 96
    ctx.fillStyle = index === 0 ? GOLD : INK
    ctx.font = font(13, 700)
    ctx.fillText(title, REPORT_MARGIN, y)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(10)
    paragraph(ctx, body, REPORT_MARGIN, y + 25, 520, 15)
  })
  const currentEnding = summary.scenarios === null ? null : {
    year: summary.scenarios.lapseYear.current,
    age: summary.scenarios.lapseAge.current,
  }
  if (currentEnding !== null && currentEnding.year !== null && currentEnding.age !== null) {
    ctx.fillStyle = INK_MUTED
    ctx.font = font(7.5, 700)
    ctx.fillText(copy.chartCurrentEnding.toUpperCase(), REPORT_MARGIN, 458)
    ctx.fillStyle = ALERT
    ctx.font = font(10, 700)
    ctx.fillText(copy.endsInYear(currentEnding.year, currentEnding.age), REPORT_MARGIN, 478)
  } else if (summary.lapseYear !== null) {
    ctx.fillStyle = ALERT
    ctx.font = font(10, 700)
    ctx.fillText(copy.lapseNote(summary.lapseYear), REPORT_MARGIN, 478)
  }
  if (summary.advisorName) {
    ctx.fillStyle = '#08130d'
    ctx.fillRect(585, 174, 165, 206)
    ctx.fillStyle = BRAND_GREEN
    ctx.font = font(8, 700)
    ctx.fillText(copy.advisor.toUpperCase(), 605, 207)
    ctx.fillStyle = ON_BAND
    ctx.font = font(16, 700)
    paragraph(ctx, summary.advisorName, 605, 238, 125, 20)
  }
  ctx.fillStyle = INK_MUTED
  ctx.font = font(6.8)
  paragraph(ctx, CLIENT_SUMMARY_DISCLAIMER, REPORT_MARGIN, 508,
    REPORT_WIDTH - REPORT_MARGIN * 2, 9)
  ctx.fillStyle = INK
  ctx.font = font(7, 700)
  ctx.fillText(copy.sourceLine(dayFor(language).format(summary.issuedOn)), REPORT_MARGIN, 560)
}

function clientReportPages(
  document: PDFDocument, summary: ClientSummary & { kind: 'PROJECTED'; scenarios: ClientSummaryScenarios },
  copy: Copy, language: ClientSummaryLanguage, interpretation?: ClientSummaryInterpretation,
): void {
  const highlights = interpretation?.highlightYears.length
    ? interpretation.highlightYears
    : summary.scenarios.rows.map((row) => row.policyYear)
  const insights = analyzeClientPolicy(summary)

  reportCover(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy, language)
  document.endPage()
  reportExecutivePage(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy)
  document.endPage()
  reportMetricPage(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy, 3,
    copy.protectionOverTime, copy.protectionQuestion, summary.scenarios.deathBenefit.current, highlights)
  document.endPage()
  reportMetricPage(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy, 4,
    copy.cashAvailableOverTime, copy.cashQuestion, summary.scenarios.cashValue.current, highlights)
  document.endPage()
  reportSurrenderPage(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy, insights)
  document.endPage()
  reportDetailsPage(document.beginPage(REPORT_WIDTH, REPORT_HEIGHT), summary, copy, language)
  document.endPage()
}

function fullPages(
  document: PDFDocument, summary: ClientSummary & { kind: 'PROJECTED' }, copy: Copy,
  language: ClientSummaryLanguage, interpretation?: ClientSummaryInterpretation,
): void {
  cover(document.beginPage(PAGE_WIDTH, PAGE_HEIGHT), summary, copy, language)
  document.endPage()

  const plan = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  pageChrome(plan, summary, copy.yourPlan, 2,
    summary.scenarios ? copy.currentValuesOnly : undefined)
  const afterFigures = headlineFigures(plan, summary, copy, MARGIN + 60)
  if (summary.scenarios) {
    sectionTitle(plan, copy.decisionGuide, afterFigures + 44, copy.currentValuesOnly)
    plan.fillStyle = INK
    plan.font = font(12)
    const afterGuide = paragraph(
      plan, copy.decisionGuideBody, MARGIN, afterFigures + 70, PAGE_WIDTH - MARGIN * 2, 18)
    plan.strokeStyle = BORDER
    plan.beginPath()
    plan.moveTo(MARGIN, afterGuide + 28.5)
    plan.lineTo(PAGE_WIDTH - MARGIN, afterGuide + 28.5)
    plan.stroke()
    sectionTitle(plan, copy.protectionOverTime, afterGuide + 64)
    plan.fillStyle = INK
    plan.font = font(11)
    const afterProtection = paragraph(
      plan, copy.deathBenefit, MARGIN, afterGuide + 90, PAGE_WIDTH - MARGIN * 2, 16)
    sectionTitle(plan, copy.cashAvailableOverTime, afterProtection + 40)
    plan.fillStyle = INK
    plan.font = font(11)
    const afterCash = paragraph(
      plan, copy.cashValue, MARGIN, afterProtection + 66, PAGE_WIDTH - MARGIN * 2, 16)
    sectionTitle(plan, copy.surrenderTiming, afterCash + 40)
    plan.fillStyle = INK_MUTED
    plan.font = font(10)
    paragraph(plan, copy.surrenderTimingSubtitle, MARGIN, afterCash + 66,
      PAGE_WIDTH - MARGIN * 2, 15)
  } else {
    coverageChart(plan, summary.coverage, copy, afterFigures + 40, 380,
      summary.guaranteed, summary.guaranteedLapse)
  }
  document.endPage()

  if (summary.scenarios) {
    const insights = analyzeClientPolicy(summary)
    const highlightYears = interpretation?.highlightYears.length
      ? interpretation.highlightYears
      : insights?.checkpoints.map((point) => point.policyYear) ?? []
    const currentLapse = {
      year: summary.scenarios.lapseYear.current,
      age: summary.scenarios.lapseAge.current,
    }
    const death = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
    pageChrome(death, summary, copy.protectionOverTime, 3, copy.currentValuesOnly)
    policyMetricChart(death, copy, summary.scenarios.deathBenefit,
      highlightYears, MARGIN + 54, currentLapse)
    document.endPage()

    const cash = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
    pageChrome(cash, summary, copy.cashAvailableOverTime, 4, copy.currentValuesOnly)
    policyMetricChart(cash, copy, summary.scenarios.cashValue,
      highlightYears, MARGIN + 54, currentLapse,
      insights?.breakEven ? {
        label: copy.firstBreakEven,
        value: copy.breakEvenAt(insights.breakEven.policyYear, insights.breakEven.age),
      } : null)
    document.endPage()

    const table = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
    pageChrome(table, summary, copy.surrenderTiming, 5, copy.currentValuesOnly)
    surrenderAnalysis(table, insights, copy, MARGIN + 76)
    document.endPage()

    outlookPage(document.beginPage(PAGE_WIDTH, PAGE_HEIGHT), summary, copy, language, 6)
    document.endPage()
    return
  }

  const table = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  pageChrome(table, summary, copy.yearByYear, 3)
  const hasAccumulatedValue = summary.fullMilestones.some((point) => point.accumulatedValue !== null)
  const columns: Column[] = hasAccumulatedValue
    ? [
        { x: MARGIN + 12, heading: copy.policyYearColumn, value: (p) => copy.year(p.policyYear) },
        { x: MARGIN + 110, heading: copy.ageColumn, value: (p) => String(p.age) },
        { x: MARGIN + 160, heading: copy.outlayColumn, value: (p) => amount(p.premiumOutlay) },
        { x: MARGIN + 250, heading: copy.deathBenefitColumn, value: (p) => amount(p.netDeathBenefit) },
        { x: MARGIN + 390, heading: copy.accumulatedColumn, value: (p) => amount(p.accumulatedValue) },
        { x: MARGIN + 465, heading: copy.cashValueColumn, value: (p) => amount(p.cashSurrenderValue) },
      ]
    : [
        { x: MARGIN + 12, heading: copy.policyYearColumn, value: (p) => copy.year(p.policyYear) },
        { x: MARGIN + 120, heading: copy.ageColumn, value: (p) => String(p.age) },
        { x: MARGIN + 185, heading: copy.outlayColumn, value: (p) => amount(p.premiumOutlay) },
        { x: MARGIN + 290, heading: copy.deathBenefitColumn, value: (p) => amount(p.netDeathBenefit) },
        { x: MARGIN + 430, heading: copy.cashValueColumn, value: (p) => amount(p.cashSurrenderValue) },
      ]
  projectionTable(table, summary.fullMilestones, columns, MARGIN + 66, 30)
  document.endPage()

  outlookPage(document.beginPage(PAGE_WIDTH, PAGE_HEIGHT), summary, copy, language)
  document.endPage()
}

export async function renderClientSummaryPdf(
  summary: ClientSummary, options: ClientSummaryOptions = {},
): Promise<Uint8Array> {
  registerBrandFonts()
  const language = options.language ?? 'EN'
  const copy = clientSummaryCopy(language)
  const document = new PDFDocument({
    title: `${summary.insuredName} — ${summary.productLabel}`,
    author: 'Keepr One',
    subject: `${summary.productLabel} · National Life`,
    creator: 'Keepr One',
  })

  // O Term não tem projeção, e por isso não tem a página de perspectiva. Tem
  // ledger, que é o que a folha única espreme em seis degraus — e uma página
  // inteira de tabela é material honesto, não preenchimento. Sem ledger não há
  // apresentação: sobram a duração e três números, que já são a folha única.
  if (options.variant === 'FULL' && summary.kind === 'PROJECTED' && summary.scenarios) {
    clientReportPages(document, { ...summary, scenarios: summary.scenarios }, copy, language,
      options.interpretation)
  } else if (options.variant === 'FULL' && summary.kind === 'PROJECTED') {
    fullPages(document, summary, copy, language, options.interpretation)
  } else if (options.variant === 'FULL' && summary.kind === 'LEVEL_TERM' && summary.schedule) {
    termFullPages(document, summary, summary.schedule, copy, language)
  } else {
    quickPage(document, summary, copy, language)
  }

  return new Uint8Array(document.close())
}

/// What the agent sees in the share sheet before it goes out. The insured's own
/// name is what makes the right file easy to pick in a WhatsApp thread.
export function clientSummaryFilename(
  summary: ClientSummary, variant: ClientSummaryVariant = 'QUICK',
): string {
  const who = summary.insuredName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const kind = variant === 'FULL' ? 'proposal-presentation' : 'proposal-summary'
  return `${who || 'proposal'}-${kind}-${summary.issuedOn.toISOString().slice(0, 10)}.pdf`
}
