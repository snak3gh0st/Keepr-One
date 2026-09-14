import { describe, expect, it } from 'vitest'
import { parseForesightCurrentLedgerText } from './foresight-current-ledger'

/// Transcrito das páginas Current Illustrated Values de uma ilustração FlexLife
/// real (Illustration ID 79382). Cada linha traz os dois cenários: à esquerda a
/// taxa alternativa de 3,50%, à direita a ilustrada de 6,84%.
const LEDGER = `Current Illustrated Values*
Policy Year Age Premium Outlay Weighted Average Interest Rate Accumu- lated Value Cash Surrender Value Net Death Benefit
1 38 $24,000.00 3.50 % $15,545 $0 $1,701,885 6.84 % $15,816 $0 $1,702,156
2 39 24,000.00 3.50 % 31,389 766 1,717,729 6.84 % 32,464 1,840 1,718,804
3 40 24,000.00 3.50 % 47,426 18,455 1,733,766 6.84 % 49,879 20,907 1,736,219
4 41 24,000.00 3.50 % 63,805 36,553 1,750,145 6.84 % 68,256 41,005 1,754,596
5 42 24,000.00 3.50 % 80,536 55,089 1,766,876 6.84 % 87,661 62,214 1,774,001 $120,000.00`

describe('o ledger corrente', () => {
  const ledger = parseForesightCurrentLedgerText(LEDGER)

  // O bloco da direita é o que a página Summary of Values chama de corrente:
  // no ano 5 ela resume resgate 62.214 e benefício 1.774.001, que são
  // exatamente estes. Ler o bloco da esquerda mostraria ao cliente um cenário
  // alternativo no lugar do dele.
  it('lê o cenário ilustrado, não a taxa alternativa ao lado', () => {
    expect(ledger.rows).toHaveLength(5)
    expect(ledger.rows[4]).toEqual({
      policyYear: 5, age: 42, premiumOutlay: 24_000,
      weightedAverageInterestRate: 6.84,
      accumulatedValue: 87_661, cashSurrenderValue: 62_214, netDeathBenefit: 1_774_001,
    })
  })

  it('mantém um resgate zerado nos primeiros anos, que é valor e não ausência', () => {
    expect(ledger.rows[0]!.cashSurrenderValue).toBe(0)
  })

  it('não confunde o subtotal de prêmios com uma linha', () => {
    expect(ledger.rows.map((row) => row.accumulatedValue)).not.toContain(120_000)
  })

  it('registra o ano em que a apólice se encerra, quando ela se encerra', () => {
    const lapsing = parseForesightCurrentLedgerText(
      '1 38 $24,000.00 3.50 % $15,545 $0 $1,701,885 6.84 % $15,816 $0 $1,702,156 ' +
      '2 39 24,000.00 3.50 % 31,389 766 1,717,729 6.84 % 32,464 1,840 1,718,804 ' +
      '3 40 14,000.00 3.50 % Lapse Lapse Lapse 6.84 % Lapse Lapse Lapse')
    expect(lapsing.lapse).toEqual({ policyYear: 3, age: 40 })
    expect(lapsing.rows).toHaveLength(2)
  })

  it('recusa um ledger que não começa no primeiro ano', () => {
    expect(() => parseForesightCurrentLedgerText(
      '3 40 $24,000.00 3.50 % $47,426 $18,455 $1,733,766 6.84 % $49,879 $20,907 $1,736,219 ' +
      '4 41 24,000.00 3.50 % 63,805 36,553 1,750,145 6.84 % 68,256 41,005 1,754,596'))
      .toThrow('FORESIGHT_CURRENT_LEDGER_INCOMPLETE')
  })

  it('recusa um ledger com um ano faltando no meio', () => {
    expect(() => parseForesightCurrentLedgerText(
      '1 38 $24,000.00 3.50 % $15,545 $0 $1,701,885 6.84 % $15,816 $0 $1,702,156 ' +
      '3 40 24,000.00 3.50 % 47,426 18,455 1,733,766 6.84 % 49,879 20,907 1,736,219'))
      .toThrow('FORESIGHT_CURRENT_LEDGER_INCONSISTENT')
  })

  it('recusa uma página sem nada que leia como linha', () => {
    expect(() => parseForesightCurrentLedgerText('Current Illustrated Values Policy Year Age'))
      .toThrow('FORESIGHT_CURRENT_LEDGER_MISSING')
  })
})
