import { describe, expect, it } from 'vitest'
import { buildClientSummary } from './client-summary'

function projectionRow(overrides: Partial<Record<string, number | null>> & { policyYear: number; age: number }) {
  return {
    premiumOutlay: 3600,
    weightedAverageInterestRate: 6.1,
    loan: null,
    annualIncome: null,
    accumulatedValue: 10_000,
    cashSurrenderValue: 8_000,
    netDeathBenefit: 500_000,
    ...overrides,
  }
}

const quickReview = {
  summary: {
    initialFaceAmount: 500_000,
    lapseYear: null,
    mecYear: null,
    modalPremium: 300,
    minimumPremium: null,
    deathBenefitProtectionPremium: null,
    targetPremium: 4_200,
    mecPremium: null,
    guidelineLevelPremium: null,
    guidelineSinglePremium: null,
  },
  annualProjection: [1, 5, 10, 20, 30].map((policyYear) =>
    projectionRow({
      policyYear,
      age: 39 + policyYear,
      accumulatedValue: policyYear * 12_000,
      cashSurrenderValue: policyYear * 10_000,
      netDeathBenefit: 500_000 + policyYear * 1_000,
    })),
}

const verifiedIllustration = {
  insuredName: 'Maria Silva',
  productName: '956',
  documentFetchedAt: new Date('2026-09-01T12:00:00Z'),
  documentMimeType: 'application/pdf',
  rawPayload: {
    foresightResult: {
      solveBasis: 'PREMIUM',
      requestedAmount: 300,
      confirmedFaceAmount: 500_000,
      confirmedMonthlyPremium: 300,
      confirmedAnnualPremium: 3_600,
      quickReview,
    },
  },
}

describe('client summary eligibility', () => {
  it('builds from an illustration whose PDF arrived and whose result is verified', () => {
    const summary = buildClientSummary(verifiedIllustration)
    expect(summary).not.toBeNull()
    expect(summary).toMatchObject({
      kind: 'PROJECTED',
      insuredName: 'Maria Silva',
      productLabel: 'FlexLife',
      faceAmount: 500_000,
      monthlyPremium: 300,
      annualPremium: 3_600,
    })
  })

  it('refuses an illustration whose official PDF has not arrived', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, documentFetchedAt: null,
    })).toBeNull()
  })

  it('refuses a stored document that is not the carrier PDF', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, documentMimeType: 'text/html',
    })).toBeNull()
  })

  it('refuses an illustration with no verified carrier result', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, rawPayload: { foresightRequest: { faceAmount: 500_000 } },
    })).toBeNull()
  })


  it('refuses a projection too short to draw a curve from', () => {
    expect(buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: { ...quickReview, annualProjection: [projectionRow({ policyYear: 1, age: 40 })] },
        },
      },
    })).toBeNull()
  })
})

describe('client summary contents', () => {
  it('charts only the years the carrier gave a death benefit for', () => {
    const summary = buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: {
            ...quickReview,
            annualProjection: [
              ...quickReview.annualProjection,
              projectionRow({ policyYear: 40, age: 79, netDeathBenefit: null }),
            ],
          },
        },
      },
    })
    expect(summary?.kind === 'PROJECTED' && summary.coverage.map((point) => point.policyYear))
      .toEqual([1, 5, 10, 20, 30])
  })

  it('picks years 5, 10 and 20 plus the last projected year as the milestones', () => {
    const summary = buildClientSummary(verifiedIllustration)
    expect(summary?.kind === 'PROJECTED' && summary.milestones).toEqual([
      { policyYear: 5, age: 44, netDeathBenefit: 505_000, cashSurrenderValue: 50_000, premiumOutlay: 3_600, accumulatedValue: 60_000 },
      { policyYear: 10, age: 49, netDeathBenefit: 510_000, cashSurrenderValue: 100_000, premiumOutlay: 3_600, accumulatedValue: 120_000 },
      { policyYear: 20, age: 59, netDeathBenefit: 520_000, cashSurrenderValue: 200_000, premiumOutlay: 3_600, accumulatedValue: 240_000 },
      { policyYear: 30, age: 69, netDeathBenefit: 530_000, cashSurrenderValue: 300_000, premiumOutlay: 3_600, accumulatedValue: 360_000 },
    ])
  })

  it('never repeats a milestone when the last projected year is already one', () => {
    const summary = buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: {
            ...quickReview,
            annualProjection: quickReview.annualProjection.filter((row) => row.policyYear <= 20),
          },
        },
      },
    })
    expect(summary?.kind === 'PROJECTED' && summary.milestones.map((m) => m.policyYear))
      .toEqual([5, 10, 20])
  })

  it('falls back to a neutral name rather than printing an empty line to the client', () => {
    expect(buildClientSummary({ ...verifiedIllustration, insuredName: null })?.insuredName)
      .toBe('Prepared for you')
  })
})

// The Quick View returns only current values. The guaranteed half — the lowest
// rate National Life credits and the highest charges it may take — lives in the
// official PDF, and without it the client document could only ever show the
// optimistic scenario.
describe('the guaranteed half of a permanent illustration', () => {
  const guaranteedLedger = {
    rows: Array.from({ length: 24 }, (unused, index) => ({
      policyYear: index + 1,
      age: 40 + index,
      premiumOutlay: 3_600,
      accumulatedValue: Math.max(0, 40_000 - index * 2_000),
      cashSurrenderValue: Math.max(0, 40_000 - index * 2_000),
      netDeathBenefit: 500_000 - index * 4_000,
    })),
    lapse: { policyYear: 25, age: 63 },
  }

  it('carries the guaranteed curve and the year the carrier says it ends', () => {
    const summary = buildClientSummary({ ...verifiedIllustration, guaranteedLedger })
    expect(summary?.kind === 'PROJECTED' && summary.guaranteed).toHaveLength(24)
    expect(summary?.kind === 'PROJECTED' && summary.guaranteedLapse)
      .toEqual({ policyYear: 25, age: 63 })
  })

  // The document that shipped before this existed must still be producible:
  // current values alone, marked as not guaranteed.
  it('produces the same summary as before when the PDF could not be read', () => {
    const summary = buildClientSummary(verifiedIllustration)
    expect(summary?.kind === 'PROJECTED' && summary.guaranteed).toEqual([])
    expect(summary?.kind === 'PROJECTED' && summary.guaranteedLapse).toBeNull()
  })
})

// Enquanto a projeção era obrigatória, uma apólice com PDF verificado no banco
// não produzia documento nenhum para o cliente se a tela do Foresight não
// tivesse sido capturada — e metade das gerações não capturava.
describe('a peça nascida só do PDF oficial', () => {
  const summaryOfValues = {
    rows: [
      { policyYear: 5, age: 42,
        guaranteed: { annualCashFlow: -24_000, cashSurrenderValue: 38_141, netDeathBenefit: 1_749_928 },
        current: { annualCashFlow: -24_000, cashSurrenderValue: 62_214, netDeathBenefit: 1_774_001 } },
      { policyYear: 20, age: 57,
        guaranteed: { annualCashFlow: -24_000, cashSurrenderValue: 254_292, netDeathBenefit: 1_940_632 },
        current: { annualCashFlow: -24_000, cashSurrenderValue: 663_875, netDeathBenefit: 2_350_215 } },
    ],
    lapseYear: { guaranteed: 42, current: 72 },
  }
  const currentLedger = {
    rows: Array.from({ length: 30 }, (unused, index) => ({
      policyYear: index + 1, age: 38 + index, premiumOutlay: 24_000,
      weightedAverageInterestRate: 6.84,
      accumulatedValue: 15_816 + index * 40_000,
      cashSurrenderValue: index === 4 ? 62_214 : index === 19 ? 663_875 : index * 38_000,
      netDeathBenefit: index === 4 ? 1_774_001 : index === 19 ? 2_350_215 : 1_702_156 + index * 40_000,
    })),
    lapse: { policyYear: 72, age: 109 },
  }

  it('produz o documento sem a tela do Foresight', () => {
    const { rawPayload, ...rest } = verifiedIllustration
    const { quickReview: unused, ...result } = rawPayload.foresightResult
    void unused
    const summary = buildClientSummary({
      ...rest,
      rawPayload: { foresightResult: result },
      summaryOfValues,
      currentLedger,
    })
    expect(summary?.kind).toBe('PROJECTED')
    if (summary?.kind !== 'PROJECTED') return
    // O encerramento do cenário corrente vem da página da seguradora, e é o
    // número que uma peça só-corrente nunca contava.
    expect(summary.lapseYear).toBe(72)
    expect(summary.scenarios?.lapseAge).toEqual({ guaranteed: 79, current: 109 })
    // A curva é o ledger inteiro, não os dois marcos da página de resumo.
    expect(summary.scenarios?.deathBenefit.current).toHaveLength(30)
    expect(summary.scenarios?.cashValue.current).toHaveLength(30)
    expect(summary.scenarios?.cashValue.current[19]).toEqual({ policyYear: 20, age: 57, value: 663_875 })
    // Nenhuma destas páginas declara ano de MEC, e um campo vazio é a resposta
    // honesta para uma pergunta que o documento não responde.
    expect(summary.mecYear).toBeNull()
  })

  it('continua sem documento quando nem o PDF nem a tela trazem valores', () => {
    const { rawPayload, ...rest } = verifiedIllustration
    const { quickReview: unused, ...result } = rawPayload.foresightResult
    void unused
    expect(buildClientSummary({ ...rest, rawPayload: { foresightResult: result } })).toBeNull()
  })

  it('recusa combinar a página de resumo com um ledger divergente', () => {
    const { rawPayload, ...rest } = verifiedIllustration
    const { quickReview: unused, ...result } = rawPayload.foresightResult
    void unused
    const summary = buildClientSummary({
      ...rest,
      rawPayload: { foresightResult: result },
      summaryOfValues,
      currentLedger: {
        ...currentLedger,
        rows: currentLedger.rows.map((row) => row.policyYear === 20
          ? { ...row, netDeathBenefit: row.netDeathBenefit + 1 }
          : row),
      },
    })
    expect(summary).toBeNull()
  })
})

describe('Term summaries', () => {
  function termIllustration(confirmedTermDuration: string, requested = confirmedTermDuration) {
    return {
      insuredName: 'Ale Teste',
      productName: 'NL Term',
      documentFetchedAt: new Date('2026-09-01T12:00:00Z'),
      documentMimeType: 'application/pdf',
      rawPayload: {
        foresightTermDraft: {
          schemaVersion: 1,
          firstName: 'Ale', lastName: 'Teste', dateOfBirth: '1989-03-12',
          issueState: 'FL', gender: 'Male', rateClass: 'Standard_NT',
          faceAmount: 500_000, premiumMode: 'Monthly', termDuration: requested,
        },
        foresightTermResult: {
          source: 'OFFICIAL_PDF',
          premiumMode: 'Monthly',
          confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92,
          confirmedAnnualPremium: 755.04,
          requestedTermDuration: requested,
          confirmedTermDuration,
        },
      },
    }
  }

  it('summarises Term from the four numbers the carrier confirmed', () => {
    const summary = buildClientSummary(termIllustration('20-G'))
    expect(summary).toMatchObject({
      kind: 'LEVEL_TERM',
      insuredName: 'Ale Teste',
      productLabel: 'NL Term',
      faceAmount: 500_000,
      monthlyPremium: 62.92,
      annualPremium: 755.04,
      termDuration: '20-G',
    })
  })

  // The one thing a client holding an ART policy most needs to read, and the
  // reason a level coverage band is never drawn for Term.
  it('says plainly that an annually renewable premium rises each year', () => {
    const summary = buildClientSummary(termIllustration('ART'))
    expect(summary?.kind === 'LEVEL_TERM' && summary.termDuration).toBe('ART')
  })

  // The ledger is the carrier's own guaranteed schedule. What the summary must
  // do with it is keep the two years on either side of the guarantee, because
  // the difference between them is the whole point of showing it at all.
  it('keeps the years on either side of the guarantee when the ledger is read', () => {
    const rows = Array.from({ length: 40 }, (unused, index) => ({
      policyYear: index + 1,
      age: 37 + index,
      guaranteedAnnualPremium: index < 20 ? 755.04 : 6_262.08 + index * 100,
      guaranteedDeathBenefit: 500_000,
    }))
    const summary = buildClientSummary({
      ...termIllustration('20-G'),
      termLedger: {
        rows,
        levelPeriodYears: 20,
        levelAnnualPremium: 755.04,
        firstIncrease: { policyYear: 21, age: 57, annualPremium: 8_262.08 },
      },
    })
    const schedule = summary?.kind === 'LEVEL_TERM' ? summary.schedule : null
    expect(schedule?.levelPeriodYears).toBe(20)
    // Divided back at the mode the carrier annualized, which is how the ledger
    // and the policy's own cover page agree on the monthly figure.
    expect(schedule?.levelMonthlyPremium).toBeCloseTo(62.92, 2)
    expect(schedule?.rows.map((row) => row.policyYear)).toContain(20)
    expect(schedule?.rows.map((row) => row.policyYear)).toContain(21)
    expect(schedule?.rows.at(-1)?.policyYear).toBe(40)
    expect(schedule?.rows.length).toBeLessThanOrEqual(6)
  })

  it('states the duration without a schedule when the PDF could not be read', () => {
    const summary = buildClientSummary(termIllustration('20-G'))
    expect(summary?.kind === 'LEVEL_TERM' && summary.schedule).toBeNull()
  })

  it('carries no projection to draw', () => {
    expect(buildClientSummary(termIllustration('30-G'))).not.toHaveProperty('coverage')
  })

  // `resolveForesightTermDurationResult` — the canonical reader — treats a
  // pre-reconciliation Term result as confirming the duration that was asked
  // for, and the agent's own screen prints it as "Prazo confirmado". Refusing
  // here made this module stricter than the rest of the app about the same row.
  it('falls back to the requested duration on a pre-reconciliation Term result', () => {
    const illustration = termIllustration('20-G')
    const { confirmedTermDuration, requestedTermDuration, ...legacy } =
      illustration.rawPayload.foresightTermResult
    void confirmedTermDuration
    void requestedTermDuration
    const summary = buildClientSummary({
      ...illustration,
      rawPayload: { ...illustration.rawPayload, foresightTermResult: legacy },
    })
    expect(summary?.kind === 'LEVEL_TERM' && summary.termDuration).toBe('20-G')
  })

  it('produces nothing when neither the result nor the request names a duration', () => {
    const illustration = termIllustration('20-G')
    const { confirmedTermDuration, requestedTermDuration, ...legacy } =
      illustration.rawPayload.foresightTermResult
    void confirmedTermDuration
    void requestedTermDuration
    expect(buildClientSummary({
      ...illustration,
      rawPayload: {
        foresightTermDraft: { ...illustration.rawPayload.foresightTermDraft, termDuration: 'X' },
        foresightTermResult: legacy,
      },
    })).toBeNull()
  })

  it('still requires the official PDF to have arrived', () => {
    expect(buildClientSummary({
      ...termIllustration('20-G'), documentFetchedAt: null,
    })).toBeNull()
  })
})

describe('the full presentation figures', () => {
  function withProjection(rows: Array<Record<string, number | null>>) {
    return buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: { ...quickReview, annualProjection: rows },
        },
      },
    })
  }

  const everyYear = Array.from({ length: 30 }, (_, index) => projectionRow({
    policyYear: index + 1,
    age: 40 + index,
    premiumOutlay: 3_600,
    accumulatedValue: (index + 1) * 5_000,
    cashSurrenderValue: (index + 1) * 4_000,
    netDeathBenefit: 500_000,
  }))

  it('adds up what the client actually pays in, from the carrier’s own outlay column', () => {
    const summary = withProjection(everyYear)
    expect(summary?.kind === 'PROJECTED' && summary.outlook).toMatchObject({
      age: 65,
      policyYear: 26,
      totalContributions: 93_600,
      accumulatedValue: 130_000,
      growth: 36_400,
    })
  })

  // A Quick View that samples years rather than listing them cannot be summed:
  // adding five sampled rows would report a fraction of what was really paid,
  // stated as a total. Better to show nothing than a number that is wrong.
  it('refuses to total a projection that skips years', () => {
    const summary = withProjection([1, 5, 10, 20, 30].map((policyYear) => projectionRow({
      policyYear, age: 39 + policyYear, premiumOutlay: 3_600,
    })))
    expect(summary?.kind === 'PROJECTED' && summary.outlook).toBeNull()
  })

  it('refuses to total a projection with an outlay missing from any year', () => {
    const rows = everyYear.map((row, index) =>
      index === 7 ? { ...row, premiumOutlay: null } : row)
    expect(withProjection(rows)?.kind === 'PROJECTED' &&
      (withProjection(rows) as { outlook: unknown }).outlook).toBeNull()
  })

  it('reports the outlook at 65 when the projection reaches it', () => {
    const toSeventy = Array.from({ length: 31 }, (_, index) => projectionRow({
      policyYear: index + 1, age: 40 + index,
      premiumOutlay: 1_200, accumulatedValue: (index + 1) * 1_000,
    }))
    const summary = withProjection(toSeventy)
    expect(summary?.kind === 'PROJECTED' && summary.outlook?.age).toBe(65)
  })

  it('carries the carrier’s lapse and MEC years through untouched', () => {
    const summary = buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: { ...quickReview, summary: { ...quickReview.summary, lapseYear: 41, mecYear: 7 } },
        },
      },
    })
    expect(summary?.kind === 'PROJECTED' && summary.lapseYear).toBe(41)
    expect(summary?.kind === 'PROJECTED' && summary.mecYear).toBe(7)
  })

  it('carries the advisor through when the caller knows who it is', () => {
    expect(buildClientSummary({ ...verifiedIllustration, advisorName: 'Ana Corretora' })?.advisorName)
      .toBe('Ana Corretora')
  })
})
