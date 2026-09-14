import { describe, expect, it } from 'vitest'
import { parseForesightSummaryOfValuesText } from './foresight-summary-of-values'

/// Transcrito da página Summary of Values de uma ilustração FlexLife real
/// (Illustration ID 79382), com os três cenários lado a lado e a linha de
/// encerramento que os fecha.
const PAGE = `Summary of Values FlexLife Paulo Loureiro Face Amount: $1,686,340
The following table summarizes policy values with benefits previously described.
Guaranteed Illustrated Values Current Illustrated Values 1 Average Illustrated Values 1
Policy Year Age Annual Cash Flow Cash Surrender Value Net Death Benefit
Annual Cash Flow Cash Surrender Value Net Death Benefit
Annual Cash Flow Cash Surrender Value Net Death Benefit
5 42 -24,000 38,141 1,749,928 -24,000 62,214 1,774,001 -24,000 49,577 1,761,364
10 47 -24,000 124,031 1,814,233 -24,000 199,177 1,889,379 -24,000 157,906 1,848,108
20 57 -24,000 254,292 1,940,632 -24,000 663,875 2,350,215 -24,000 421,752 2,108,092
33 70 -24,000 291,752 1,978,092 -24,000 1,859,888 3,546,228 -24,000 816,480 2,502,820
Lapse Year 42 72 52`

describe('a página Summary of Values', () => {
  const summary = parseForesightSummaryOfValuesText(PAGE)

  it('lê os dois cenários que importam, lado a lado', () => {
    expect(summary.rows).toHaveLength(4)
    expect(summary.rows[0]).toEqual({
      policyYear: 5,
      age: 42,
      guaranteed: { annualCashFlow: -24_000, cashSurrenderValue: 38_141, netDeathBenefit: 1_749_928 },
      current: { annualCashFlow: -24_000, cashSurrenderValue: 62_214, netDeathBenefit: 1_774_001 },
    })
  })

  // O bloco do meio da linha é o corrente e o terceiro é o médio. Trocá-los
  // mostraria ao cliente uma interpolação no lugar da projeção.
  it('não confunde o cenário corrente com o médio', () => {
    expect(summary.rows[3]!.current.cashSurrenderValue).toBe(1_859_888)
    expect(summary.rows[3]!.guaranteed.cashSurrenderValue).toBe(291_752)
  })

  // O fato que uma peça só-corrente nunca conta: o cenário corrente também
  // encerra, trinta anos depois do garantido.
  it('lê o ano de encerramento de cada cenário', () => {
    expect(summary.lapseYear).toEqual({ guaranteed: 42, current: 72 })
  })

  it('aceita uma ilustração que não encerra em nenhum cenário', () => {
    const intact = parseForesightSummaryOfValuesText(
      '5 42 -24,000 38,141 1,749,928 -24,000 62,214 1,774,001 -24,000 49,577 1,761,364 ' +
      '10 47 -24,000 124,031 1,814,233 -24,000 199,177 1,889,379 -24,000 157,906 1,848,108')
    expect(intact.lapseYear).toEqual({ guaranteed: null, current: null })
    expect(intact.rows).toHaveLength(2)
  })

  // Os anos não são contíguos nesta página, então a prova de que as linhas são
  // do mesmo segurado é a idade de emissão sair igual em todas.
  it('recusa linhas que não pertencem ao mesmo segurado', () => {
    expect(() => parseForesightSummaryOfValuesText(
      '5 42 -24,000 38,141 1,749,928 -24,000 62,214 1,774,001 -24,000 49,577 1,761,364 ' +
      '10 61 -24,000 124,031 1,814,233 -24,000 199,177 1,889,379 -24,000 157,906 1,848,108'))
      .toThrow('FORESIGHT_SUMMARY_OF_VALUES_INCONSISTENT')
  })

  it('recusa uma página sem nada que leia como linha', () => {
    expect(() => parseForesightSummaryOfValuesText('Summary of Values Policy Year Age'))
      .toThrow('FORESIGHT_SUMMARY_OF_VALUES_MISSING')
  })
})
