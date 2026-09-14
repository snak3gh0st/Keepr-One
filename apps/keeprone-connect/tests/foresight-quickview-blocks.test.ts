import { describe, expect, it } from 'vitest'
import { parseForesightQuickReview } from '../lib/foresight-executor'

/// A página real da National Life, copiada do que o K-Bot capturou e gravou em
/// produção em 14/09/2026 (ilustração FlexLife, capital de 500 mil).
///
/// O resumo do Quick View não é um cabeçalho seguido de uma linha de valores:
/// são três pares empilhados. O leitor ancorava em `Initial Face Amount` e lia
/// só a linha seguinte, então seis campos — entre eles o Target Premium, que
/// está ali impresso — nunca eram lidos. O comentário que dizia que a
/// seguradora não imprime prêmio-alvo em caso resolvido pelo capital está
/// refutado por esta captura: ela imprime, em outro bloco.
const PAGINA_REAL = [
  ['Quick View'],
  [],
  ['Initial Face Amount', 'Lapse Year', 'MEC Year', 'Modal Premium', 'Premium Mode'],
  ['$500,000', 'N/A', 'N/A', '$287.96', 'Monthly (EFT)'],
  ['Minimum Premium (MMP)', 'Death Benefit Protection Premium (MGP)', 'Target Premium', 'MEC Premium', 'Guideline Level Premium'],
  ['$2,469.60', '$2,523.00', '$6,786.00', '$32,869.00', '$8,759.00'],
  ['Guideline Single Premium'],
  ['$140,537.00'],
  ['This information is for agent use only. Only complete illustrations may be shown to the public.'],
  ['Policy Year', 'Age', 'Premium Outlay', 'Weighted Average Interest Rate', 'Accumulated Value', 'Cash Surrender Value', 'Net Death Benefit'],
  ['1', '37', '$3,456', '6.84%', '$1,243', '$0', '$500,000'],
  ['2', '38', '$3,456', '6.84%', '$2,516', '$0', '$500,000'],
]

describe('o resumo do Quick View vem em blocos empilhados', () => {
  it('lê os três blocos, e não só o primeiro', () => {
    const review = parseForesightQuickReview(PAGINA_REAL)

    expect(review).not.toBeNull()
    expect(review!.summary).toMatchObject({
      initialFaceAmount: 500_000,
      modalPremium: 287.96,
      // O campo do relato: impresso na página, perdido na leitura.
      targetPremium: 6_786,
      mecPremium: 32_869,
      minimumPremium: 2_469.6,
      deathBenefitProtectionPremium: 2_523,
      guidelineLevelPremium: 8_759,
      // Sozinho no terceiro bloco, com uma coluna só.
      guidelineSinglePremium: 140_537,
    })
  })

  // `N/A` é a seguradora dizendo que não há, e continua virando nulo. A
  // correção é sobre blocos não lidos, não sobre inventar número onde a
  // seguradora escreveu que não existe.
  it('mantém nulo o que a seguradora marcou como N/A', () => {
    const review = parseForesightQuickReview(PAGINA_REAL)

    expect(review!.summary.lapseYear).toBeNull()
    expect(review!.summary.mecYear).toBeNull()
  })
})
