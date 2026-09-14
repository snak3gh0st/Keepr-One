import { describe, expect, it, vi } from 'vitest'

/// Os testes de texto deste PDF passariam com o gráfico inteiro em branco: eles
/// extraem strings com pdfjs, e uma linha não é uma string. Foi exatamente por
/// isso que a série garantida pôde sumir sem nenhum teste reclamar.
///
/// Aqui o contexto de desenho é gravado. O que importa não é o pixel, é a
/// ordem: num benefício nivelado as duas séries são a mesma reta, e quem for
/// desenhado primeiro desaparece sob o traço sólido e mais largo do outro.
/// `points` separa série de enfeite: uma curva tem dezenas de vértices, e a
/// grade, os eixos e o marcador vertical de encerramento têm dois. Sem essa
/// distinção o teste media o marcador — que também é tracejado e também é
/// desenhado depois das séries — e passava com qualquer ordem.
type Stroke = { dashed: boolean; lastX: number; points: number }
const strokes: Stroke[] = []

vi.mock('@napi-rs/canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@napi-rs/canvas')>()
  class RecordingDocument extends actual.PDFDocument {
    beginPage(width: number, height: number) {
      const ctx = super.beginPage(width, height)
      let dash: number[] = []
      let lastX = Number.NaN
      let points = 0
      const proxy = new Proxy(ctx, {
        get(target, key, receiver) {
          if (key === 'setLineDash') {
            return (value: number[]) => { dash = value; return target.setLineDash(value) }
          }
          if (key === 'lineTo') {
            return (x: number, y: number) => { lastX = x; points += 1; return target.lineTo(x, y) }
          }
          if (key === 'moveTo') {
            return (x: number, y: number) => { lastX = x; points = 1; return target.moveTo(x, y) }
          }
          if (key === 'stroke') {
            return () => {
              // Só os traços de série têm caminho com pontos; grades e eixos
              // também passam por aqui, e são filtrados pelo dash/posição.
              if (Number.isFinite(lastX)) strokes.push({ dashed: dash.length > 0, lastX, points })
              lastX = Number.NaN
              points = 0
              return target.stroke()
            }
          }
          if (key === 'save') return () => target.save()
          if (key === 'restore') return () => { dash = []; return target.restore() }
          const value = Reflect.get(target, key, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
        set(target, key, value) {
          Reflect.set(target, key, value)
          return true
        },
      })
      return proxy as typeof ctx
    }
  }
  return { ...actual, PDFDocument: RecordingDocument }
})

const { renderClientSummaryPdf } = await import('./client-summary-pdf')

// A apólice do relato: benefício nivelado em 500k nos dois cenários, e o
// garantido terminando antes porque o ledger para no último ano publicado.
const leveled = {
  kind: 'PROJECTED' as const,
  insuredName: 'Ale Teste',
  productLabel: 'FlexLife',
  faceAmount: 500_000,
  monthlyPremium: 287.96,
  annualPremium: 3_455.52,
  issuedOn: new Date('2026-09-01T12:00:00Z'),
  advisorName: null,
  coverage: [], milestones: [], fullMilestones: [],
  outlook: null, lapseYear: null, mecYear: null,
  guaranteed: [], guaranteedLapse: null,
  scenarios: {
    deathBenefit: {
      guaranteed: Array.from({ length: 25 }, (unused, i) => ({ age: 37 + i, value: 500_000 })),
      current: Array.from({ length: 43 }, (unused, i) => ({ age: 37 + i, value: 500_000 })),
    },
    cashValue: { guaranteed: [], current: [] },
    rows: [],
    lapseAge: { guaranteed: 62, current: null },
    lapseYear: { guaranteed: 26, current: null },
  },
}

describe('o gráfico desenha as duas séries de forma visível', () => {
  it('põe a garantida por cima, e ela termina antes da atual', async () => {
    strokes.length = 0

    await renderClientSummaryPdf(leveled as never, { variant: 'FULL' })

    // Só curvas. Duas, e exatamente duas: a garantida e a atual.
    const curvas = strokes.filter((stroke) => stroke.points > 10)
    expect(curvas).toHaveLength(2)

    const garantida = curvas.find((curva) => curva.dashed)
    const atual = curvas.find((curva) => !curva.dashed)
    expect(garantida).toBeDefined()
    expect(atual).toBeDefined()

    // A garantida acaba antes — é o único fato que o desenho tem a dar.
    expect(garantida!.lastX).toBeLessThan(atual!.lastX)

    // E é desenhada depois da atual. Antes dela, some sob o traço sólido e mais
    // largo, e o desenho passa a contradizer a própria legenda.
    expect(curvas.indexOf(garantida!)).toBeGreaterThan(curvas.indexOf(atual!))
  })
})
