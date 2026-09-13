import 'server-only'

/// Draws the one page the client receives.
///
/// Vector PDF straight from Skia via `@napi-rs/canvas`, which the server image
/// already carries for reading carrier PDFs. That is the whole reason this is a
/// canvas and not a print stylesheet: rendering HTML to PDF would mean putting
/// Chromium in the web image, and the alternative — asking the agent to hit
/// Cmd+P — is not something you can attach to a WhatsApp message.
///
/// This module only draws. Every value it receives has already been verified
/// against the carrier's official illustration by `buildClientSummary`; nothing
/// here computes, rounds into, or infers a number.

import path from 'node:path'
import { GlobalFonts, PDFDocument, Path2D } from '@napi-rs/canvas'
import { CLIENT_SUMMARY_DISCLAIMER } from './quote-disclaimer'
import type { ClientSummary, ClientSummaryPoint } from './client-summary'

type Ctx = ReturnType<PDFDocument['beginPage']>

// US Letter at 72dpi, the size a US client prints without thinking about it.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 46
const BAND_HEIGHT = 132

// Keepr One's palette, converted once from the oklch tokens in `globals.css`.
// Canvas has no oklch, so these are the sRGB values of those same tokens; if
// the brand colours move there, they move here.
const INK = '#0e1610'
const INK_MUTED = '#5a635b'
const TEAL = '#005526'
const TEAL_DEEP = '#003617'
const GOLD = '#be7200'
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
  for (const weight of ['400', '500', '700']) {
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
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })
const compact = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
})

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

function font(size: number, weight: 400 | 500 | 700 = 400): string {
  return `${weight} ${size}px ${BRAND}`
}

/// Lays text into a column, returning where the next line would start. Used for
/// the disclaimer, which is the only run long enough to wrap and the one run
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
  const textX = x + size + 9
  ctx.font = font(19, 700)
  ctx.fillStyle = ON_BAND
  ctx.fillText('keepr', textX, baseline)
  const keeprWidth = ctx.measureText('keepr').width
  ctx.font = font(19, 500)
  ctx.fillStyle = BRAND_GREEN
  ctx.fillText('one', textX + keeprWidth + 5, baseline)
}

/// The masthead: the brand, who this is for, and whose numbers these are.
///
/// A full-bleed dark band rather than a logo floating on white. On a page the
/// client will screenshot and forward, the first thing that has to survive
/// being seen at thumbnail size is who sent it.
function banner(ctx: Ctx, summary: ClientSummary): void {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, PAGE_WIDTH, BAND_HEIGHT)
  ctx.fillStyle = BRAND_GREEN
  ctx.fillRect(0, BAND_HEIGHT - 3, PAGE_WIDTH, 3)

  drawLogo(ctx, MARGIN, 46, 22)

  ctx.fillStyle = ON_BAND_MUTED
  ctx.font = font(9, 500)
  const issued = `ISSUED ${day.format(summary.issuedOn).toUpperCase()}`
  ctx.fillText(issued, PAGE_WIDTH - MARGIN - ctx.measureText(issued).width, 42)

  ctx.fillStyle = ON_BAND
  ctx.font = font(28, 700)
  ctx.fillText(summary.insuredName, MARGIN, 92)

  ctx.fillStyle = BRAND_GREEN
  ctx.font = font(10, 700)
  ctx.fillText(`${summary.productLabel.toUpperCase()}  ·  NATIONAL LIFE`, MARGIN, 112)
}

/// The three numbers the client is actually deciding on, given the whole width
/// of the page so they are read before anything else.
function headlineFigures(ctx: Ctx, summary: ClientSummary, top: number): number {
  const figures: Array<[string, string]> = [
    ['Your coverage', whole.format(summary.faceAmount)],
    ['Monthly payment', cents.format(summary.monthlyPremium)],
    ['Per year', cents.format(summary.annualPremium)],
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
    ctx.fillText(note, PAGE_WIDTH - MARGIN - ctx.measureText(note).width, baseline)
  }
}

function coverageChart(ctx: Ctx, points: ClientSummaryPoint[], top: number): number {
  const height = 200
  const width = PAGE_WIDTH - MARGIN * 2
  const plotLeft = MARGIN + 54
  const plotRight = MARGIN + width
  const plotTop = top + 34
  const plotBottom = top + height - 26

  // The qualifier sits on the chart, not in the footer. A clean rising curve is
  // exactly the thing a reader remembers as a promise, and the footer is
  // exactly the thing they do not read.
  sectionTitle(ctx, 'Coverage over time', top + 14, 'Not guaranteed · current assumptions')

  const cashPoints = points.filter(
    (point): point is ClientSummaryPoint & { cashSurrenderValue: number } =>
      point.cashSurrenderValue !== null)
  // The scale spans both series and starts at zero. A truncated axis would make
  // a flat death benefit look like a climbing one, which on a client-facing
  // page is not a styling choice.
  const ceiling = niceCeiling(Math.max(
    ...points.map((point) => point.netDeathBenefit),
    ...cashPoints.map((point) => point.cashSurrenderValue),
  ))
  const firstAge = points[0]!.age
  const lastAge = points[points.length - 1]!.age
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

  ctx.fillStyle = INK_MUTED
  ctx.font = font(8)
  const first = points[0]!
  const last = points[points.length - 1]!
  ctx.fillText(`Age ${first.age}`, xFor(first.age), plotBottom + 14)
  const lastLabel = `Age ${last.age}`
  ctx.fillText(lastLabel, xFor(last.age) - ctx.measureText(lastLabel).width, plotBottom + 14)

  let legendX = plotLeft
  for (const [colour, label] of [[TEAL, 'Death benefit'], [GOLD, 'Cash value']] as const) {
    if (colour === GOLD && cashPoints.length === 0) continue
    ctx.fillStyle = colour
    ctx.fillRect(legendX, plotBottom + 22, 14, 3)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(8, 500)
    ctx.fillText(label, legendX + 19, plotBottom + 26)
    legendX += 19 + ctx.measureText(label).width + 18
  }

  return top + height
}

function milestoneTable(ctx: Ctx, milestones: ClientSummaryPoint[], top: number): number {
  const width = PAGE_WIDTH - MARGIN * 2
  const columns = [MARGIN + 14, MARGIN + 130, MARGIN + 250, MARGIN + 400]
  const rowHeight = 28

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  const headings = ['POLICY YEAR', 'AGE', 'DEATH BENEFIT', 'CASH VALUE']
  headings.forEach((heading, index) => {
    ctx.fillText(heading, columns[index]!, top + 12)
  })
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, top + 20.5)
  ctx.lineTo(MARGIN + width, top + 20.5)
  ctx.stroke()

  milestones.forEach((milestone, index) => {
    const rowTop = top + 20 + index * rowHeight
    const baseline = rowTop + rowHeight - 9
    if (index % 2 === 0) {
      ctx.fillStyle = PANEL
      ctx.fillRect(MARGIN, rowTop + 1, width, rowHeight - 1)
    }
    ctx.fillStyle = INK
    ctx.font = font(11, 700)
    ctx.fillText(`Year ${milestone.policyYear}`, columns[0]!, baseline)
    ctx.fillStyle = INK_MUTED
    ctx.font = font(11)
    ctx.fillText(String(milestone.age), columns[1]!, baseline)
    ctx.fillStyle = INK
    ctx.font = font(11, 500)
    ctx.fillText(whole.format(milestone.netDeathBenefit), columns[2]!, baseline)
    // An em dash where the carrier gave nothing. Inventing a zero here would
    // read as "your policy is worth nothing in year 20".
    ctx.fillText(
      milestone.cashSurrenderValue === null ? '—' : whole.format(milestone.cashSurrenderValue),
      columns[3]!, baseline,
    )
  })

  return top + 20 + milestones.length * rowHeight
}

/// Term's whole middle. Four numbers came back from the carrier, and one of
/// them is a duration — so the page states the duration and stops. There is no
/// projection behind a Term result, and a drawn coverage bar would be this page
/// asserting an end date the carrier never sent.
function termPeriod(ctx: Ctx, durationLabel: string, top: number): number {
  const width = PAGE_WIDTH - MARGIN * 2
  const height = 98

  ctx.fillStyle = PANEL
  ctx.fillRect(MARGIN, top, width, height)
  ctx.fillStyle = TEAL
  ctx.fillRect(MARGIN, top, 4, height)

  ctx.fillStyle = INK_MUTED
  ctx.font = font(9, 700)
  ctx.fillText('YOUR PREMIUM', MARGIN + 26, top + 32)

  ctx.fillStyle = TEAL_DEEP
  ctx.font = font(17, 700)
  paragraph(ctx, durationLabel, MARGIN + 26, top + 62, width - 52, 23)

  return top + height
}

/// Closes the page under whatever content there was.
///
/// The projected summary fills the sheet, so its footer sits at the bottom
/// margin. Term produces four facts and stops, and pinning its footer to the
/// bottom left a hole in the middle of the page that read as a document that
/// failed to finish rendering. Letting the close follow the content instead
/// gives a short letter's shape — text, sign-off, then blank paper.
function footer(ctx: Ctx, summary: ClientSummary, contentBottom: number): void {
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
  const afterDisclaimer = paragraph(ctx, CLIENT_SUMMARY_DISCLAIMER, MARGIN, top, width, 10)

  ctx.fillStyle = INK
  ctx.font = font(7.6, 700)
  ctx.fillText(
    `Source: National Life illustration issued ${day.format(summary.issuedOn)}. ` +
      'Ask your agent for the full illustration.',
    MARGIN, afterDisclaimer + 4,
  )
}

export async function renderClientSummaryPdf(summary: ClientSummary): Promise<Uint8Array> {
  registerBrandFonts()
  const document = new PDFDocument({
    title: `${summary.insuredName} — proposal summary`,
    author: 'Keepr One',
    subject: `${summary.productLabel} · National Life`,
    creator: 'Keepr One',
  })
  const ctx = document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  banner(ctx, summary)

  let contentBottom: number
  if (summary.kind === 'PROJECTED') {
    const afterFigures = headlineFigures(ctx, summary, BAND_HEIGHT + 30)
    const afterChart = coverageChart(ctx, summary.coverage, afterFigures + 26)
    contentBottom = milestoneTable(ctx, summary.milestones, afterChart + 28)
  } else {
    const afterFigures = headlineFigures(ctx, summary, BAND_HEIGHT + 38)
    contentBottom = termPeriod(ctx, summary.durationLabel, afterFigures + 30)
  }

  footer(ctx, summary, contentBottom)

  document.endPage()
  return new Uint8Array(document.close())
}

/// What the agent sees in the share sheet before it goes out. The insured's own
/// name is what makes the right file easy to pick in a WhatsApp thread.
export function clientSummaryFilename(summary: ClientSummary): string {
  const who = summary.insuredName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${who || 'proposal'}-proposal-summary-${summary.issuedOn.toISOString().slice(0, 10)}.pdf`
}
