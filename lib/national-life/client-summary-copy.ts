/// Every word the client-facing PDF prints, in both languages.
///
/// Kept apart from the renderer so the drawing code holds no sentences, and
/// apart from `client-summary.ts` so the data code holds none either. A fact
/// comes from the carrier; a word comes from here.
///
/// The one thing not translated is the compliance disclaimer, which lives in
/// `quote-disclaimer.ts` and is transcribed US insurance language — English on
/// a Portuguese page is the correct outcome there, not an oversight.

import type { TermDuration } from './client-summary'

export type ClientSummaryLanguage = 'PT' | 'EN'

type Copy = {
  planLabel: string
  preparedFor: string
  issued: string
  advisor: string
  yourCoverage: string
  monthlyPayment: string
  perYear: string
  yourPremium: string
  coverageOverTime: string
  valuesOverTime: string
  notGuaranteed: string
  currentAndGuaranteed: string
  scenarioGuaranteed: string
  scenarioCurrent: string
  currentShort: string
  guaranteedShort: string
  scenarioNote: string
  publishedPointsNote: string
  chartAxisNote: string
  chartCurrentEnding: string
  chartGuaranteedEnding: string
  protectionOverTime: string
  cashAvailableOverTime: string
  surrenderTiming: string
  surrenderTimingSubtitle: string
  firstBreakEven: string
  breakEvenAt: (year: number, age: number) => string
  breakEvenWindow: (afterYear: number, byYear: number) => string
  noBreakEven: string
  breakEvenUnavailable: string
  totalPaidColumn: string
  differenceColumn: string
  currentValuesOnly: string
  decisionGuide: string
  decisionGuideBody: string
  notSurrenderAdvice: string
  importantInformation: string
  reportTitle: string
  reportSubtitle: string
  executiveReading: string
  verifiedSource: string
  protectionQuestion: string
  cashQuestion: string
  surrenderQuestion: string
  selectedMilestones: string
  projectedValueAt: (age: number) => string
  currentProjection: string
  cashVersusPaid: string
  reportClose: string
  cashValueColumnShort: string
  deathBenefitColumnShort: string
  endsInYear: (year: number, age: number) => string
  neverEnds: string
  guaranteedDeathBenefit: string
  lapsesAt: (age: number) => string
  guaranteedLapseNote: (year: number, age: number) => string
  deathBenefit: string
  cashValue: string
  age: (value: number) => string
  policyYearColumn: string
  ageColumn: string
  deathBenefitColumn: string
  cashValueColumn: string
  outlayColumn: string
  accumulatedColumn: string
  year: (value: number) => string
  yourPlan: string
  yearByYear: string
  whatYouPutIn: string
  scenarioGuideTitle: string
  scenarioCurrentBody: string
  scenarioGuaranteedBody: string
  totalContributions: string
  accumulatedAt: (age: number) => string
  growth: string
  lapseNote: (year: number) => string
  mecNote: (year: number) => string
  nextStep: string
  nextStepBody: string
  sourceLine: (date: string) => string
  termDuration: Record<TermDuration, string>
  premiumSchedule: string
  guaranteed: string
  levelThrough: (year: number, age: number) => string
  afterLevel: (year: number, age: number) => string
  perMonth: string
  premiumColumn: string
  scheduleNote: (face: string, age: number) => string
}

const EN: Copy = {
  planLabel: 'PERSONAL PLAN',
  preparedFor: 'PREPARED FOR',
  issued: 'ISSUED',
  advisor: 'YOUR ADVISOR',
  yourCoverage: 'Your coverage',
  monthlyPayment: 'Monthly payment',
  perYear: 'Per year',
  yourPremium: 'Your premium',
  coverageOverTime: 'Coverage over time',
  valuesOverTime: 'What the policy provides over time',
  notGuaranteed: 'Not guaranteed · current assumptions',
  currentAndGuaranteed: 'Current vs. guaranteed assumptions',
  scenarioGuaranteed: 'GUARANTEED',
  scenarioCurrent: 'CURRENT · NOT GUARANTEED',
  currentShort: 'Current',
  guaranteedShort: 'Guaranteed',
  scenarioNote: 'Both columns are National Life’s own, from the Summary of Values page of your illustration. Guaranteed assumes the lowest rate it credits and the highest charges it may take; current assumes today’s illustrated rates, which are not guaranteed and will change.',
  publishedPointsNote: 'Every marker is a value published in the National Life illustration. Lines connect those published points without smoothing.',
  chartAxisNote: 'Policy year along the bottom · age shown below each labeled year',
  chartCurrentEnding: 'Current illustrated ending',
  chartGuaranteedEnding: 'Guaranteed illustrated ending',
  protectionOverTime: 'Protection over time',
  cashAvailableOverTime: 'Cash available over time',
  surrenderTiming: 'Understanding surrender timing',
  surrenderTimingSubtitle: 'Current illustrated values compared with cumulative premiums',
  firstBreakEven: 'First illustrated break-even',
  breakEvenAt: (year, age) => `Year ${year}, at age ${age}`,
  breakEvenWindow: (afterYear, byYear) =>
    `The first published milestone above cumulative premiums is year ${byYear}. The crossover occurs after year ${afterYear} and by year ${byYear}; the annual ledger identifies the exact year.`,
  noBreakEven: 'The illustrated cash surrender value does not reach cumulative premiums in the years shown.',
  breakEvenUnavailable: 'The official PDF does not contain enough consecutive annual premium data to calculate break-even safely.',
  totalPaidColumn: 'TOTAL PAID',
  differenceColumn: 'VALUE MINUS PAID',
  currentValuesOnly: 'Current illustrated values · not guaranteed',
  decisionGuide: 'What this presentation answers',
  decisionGuideBody: 'How much protection the policy illustrates, how much cash may be available, and when its cash surrender value first reaches the cumulative premiums paid.',
  notSurrenderAdvice: 'Break-even is a reference point, not a recommendation to surrender. Taxes, loans, withdrawals, policy charges and the loss of death benefit can change the outcome. Review the full illustration with your advisor before acting.',
  importantInformation: 'Important information',
  reportTitle: 'Personal policy report',
  reportSubtitle: 'Protection, cash value and decision points from your National Life illustration',
  executiveReading: 'Your policy, translated into decisions',
  verifiedSource: 'Analysis based exclusively on National Life values.',
  protectionQuestion: 'How much protection does the policy illustrate over time?',
  cashQuestion: 'How much cash surrender value may be available?',
  surrenderQuestion: 'When does cash value catch up with cumulative premiums?',
  selectedMilestones: 'Selected milestones',
  projectedValueAt: (age) => `Illustrated value at age ${age}`,
  currentProjection: 'Current illustration',
  cashVersusPaid: 'Cash value versus cumulative premiums',
  reportClose: 'Use this report to guide a conversation with your advisor. The complete National Life illustration remains the authoritative source.',
  cashValueColumnShort: 'CASH VALUE',
  deathBenefitColumnShort: 'DEATH BENEFIT',
  endsInYear: (year, age) => `Ends in year ${year}, at age ${age}`,
  neverEnds: 'Runs to the end of the illustration',
  guaranteedDeathBenefit: 'Guaranteed',
  lapsesAt: (age) => `Ends at ${age}`,
  guaranteedLapseNote: (year, age) =>
    `On guaranteed assumptions — the lowest rate National Life credits and the highest ` +
    `charges it may take — this policy would end in year ${year}, at age ${age}, unless a ` +
    `higher premium is paid.`,
  deathBenefit: 'Death benefit',
  cashValue: 'Cash value',
  age: (value) => `Age ${value}`,
  policyYearColumn: 'POLICY YEAR',
  ageColumn: 'AGE',
  deathBenefitColumn: 'DEATH BENEFIT',
  cashValueColumn: 'CASH VALUE',
  outlayColumn: 'YOU PAY',
  accumulatedColumn: 'ACCUMULATED',
  year: (value) => `Year ${value}`,
  yourPlan: 'Your plan',
  yearByYear: 'Selected policy years',
  whatYouPutIn: 'What you pay in, what it becomes',
  scenarioGuideTitle: 'How to read the two scenarios',
  scenarioCurrentBody: 'Uses the rates and charges currently illustrated by National Life. These values can change and are not guaranteed.',
  scenarioGuaranteedBody: 'Uses the lowest credited rate and highest contract charges. It is the conservative scenario published by National Life.',
  totalContributions: 'Total paid in',
  accumulatedAt: (age) => `Accumulated value at age ${age}`,
  growth: 'Growth',
  lapseNote: (year) => `On these assumptions the policy would lapse in year ${year}.`,
  mecNote: (year) => `This policy becomes a Modified Endowment Contract in year ${year}.`,
  nextStep: 'Next step',
  nextStepBody: 'Talk to your advisor about anything on these pages, and ask for the full National Life illustration whenever you want the complete detail behind them.',
  sourceLine: (date) => `Source: National Life illustration issued ${date}. Ask your advisor for the full illustration.`,
  termDuration: {
    '10-G': 'Level premium guaranteed for 10 years',
    '15-G': 'Level premium guaranteed for 15 years',
    '20-G': 'Level premium guaranteed for 20 years',
    '30-G': 'Level premium guaranteed for 30 years',
    ART: 'Annually renewable — the premium increases each year',
  },
  premiumSchedule: 'What you pay, year by year',
  guaranteed: 'Guaranteed by contract',
  levelThrough: (year, age) => `Through year ${year} — age ${age}`,
  afterLevel: (year, age) => `From year ${year} — age ${age}`,
  perMonth: 'per month',
  premiumColumn: 'YOU PAY PER YEAR',
  scheduleNote: (face, age) =>
    `The death benefit stays at ${face} for as long as the premium is paid, through age ${age}.`,
}

const PT: Copy = {
  planLabel: 'PLANO PESSOAL',
  preparedFor: 'PREPARADO PARA',
  issued: 'EMITIDA EM',
  advisor: 'SEU CONSULTOR',
  yourCoverage: 'Sua cobertura',
  monthlyPayment: 'Pagamento mensal',
  perYear: 'Por ano',
  yourPremium: 'Seu prêmio',
  coverageOverTime: 'Cobertura ao longo do tempo',
  valuesOverTime: 'O que a apólice entrega ao longo do tempo',
  notGuaranteed: 'Não garantido · premissas atuais',
  currentAndGuaranteed: 'Premissas atuais vs. garantidas',
  scenarioGuaranteed: 'GARANTIDO',
  scenarioCurrent: 'ATUAL · NÃO GARANTIDO',
  currentShort: 'Atual',
  guaranteedShort: 'Garantido',
  scenarioNote: 'As duas colunas são da própria National Life, da página Summary of Values da sua ilustração. O garantido assume a menor taxa que ela credita e os maiores encargos que pode cobrar; o atual assume as taxas de hoje, que não são garantidas e vão mudar.',
  publishedPointsNote: 'Cada marcador é um valor publicado na ilustração da National Life. As linhas apenas conectam esses pontos, sem suavização.',
  chartAxisNote: 'Ano da apólice na base · idade abaixo de cada ano destacado',
  chartCurrentEnding: 'Término ilustrado no cenário atual',
  chartGuaranteedEnding: 'Término ilustrado no cenário garantido',
  protectionOverTime: 'Proteção ao longo do tempo',
  cashAvailableOverTime: 'Valor disponível ao longo do tempo',
  surrenderTiming: 'Entendendo o momento de resgate',
  surrenderTimingSubtitle: 'Valores atualmente ilustrados comparados aos prêmios acumulados',
  firstBreakEven: 'Primeiro ponto de equilíbrio ilustrado',
  breakEvenAt: (year, age) => `Ano ${year}, aos ${age} anos`,
  breakEvenWindow: (afterYear, byYear) =>
    `O primeiro marco publicado acima dos prêmios acumulados é o ano ${byYear}. O equilíbrio ocorre depois do ano ${afterYear} e até o ano ${byYear}; o ledger anual identifica o ano exato.`,
  noBreakEven: 'O valor de resgate ilustrado não alcança os prêmios acumulados nos anos apresentados.',
  breakEvenUnavailable: 'O PDF oficial não contém anos consecutivos de prêmio suficientes para calcular o ponto de equilíbrio com segurança.',
  totalPaidColumn: 'TOTAL APORTADO',
  differenceColumn: 'VALOR MENOS APORTES',
  currentValuesOnly: 'Valores atualmente ilustrados · não garantidos',
  decisionGuide: 'O que esta apresentação responde',
  decisionGuideBody: 'Quanto de proteção a apólice ilustra, quanto pode estar disponível em dinheiro e quando o valor de resgate alcança pela primeira vez os prêmios acumulados.',
  notSurrenderAdvice: 'O ponto de equilíbrio é uma referência, não uma recomendação de resgate. Impostos, empréstimos, retiradas, encargos e a perda do benefício por morte podem mudar o resultado. Revise a ilustração completa com seu consultor antes de agir.',
  importantInformation: 'Informações importantes',
  reportTitle: 'Relatório pessoal da apólice',
  reportSubtitle: 'Proteção, valor de resgate e pontos de decisão da sua ilustração National Life',
  executiveReading: 'Sua apólice traduzida em decisões',
  verifiedSource: 'Análise baseada exclusivamente nos valores da National Life.',
  protectionQuestion: 'Quanto de proteção a apólice ilustra ao longo do tempo?',
  cashQuestion: 'Quanto pode estar disponível em valor de resgate?',
  surrenderQuestion: 'Quando o valor de resgate alcança os prêmios acumulados?',
  selectedMilestones: 'Marcos selecionados',
  projectedValueAt: (age) => `Valor ilustrado aos ${age} anos`,
  currentProjection: 'Ilustração atual',
  cashVersusPaid: 'Valor de resgate versus prêmios acumulados',
  reportClose: 'Use este relatório para orientar a conversa com seu consultor. A ilustração completa da National Life continua sendo a fonte oficial.',
  cashValueColumnShort: 'VALOR DE RESGATE',
  deathBenefitColumnShort: 'BENEFÍCIO POR MORTE',
  endsInYear: (year, age) => `Encerra no ano ${year}, aos ${age} anos`,
  neverEnds: 'Vai até o fim da ilustração',
  guaranteedDeathBenefit: 'Garantido',
  lapsesAt: (age) => `Encerra aos ${age}`,
  guaranteedLapseNote: (year, age) =>
    `Nas premissas garantidas — a menor taxa que a National Life credita e os maiores ` +
    `encargos que ela pode cobrar — esta apólice se encerraria no ano ${year}, aos ${age} ` +
    `anos, a menos que se pague um prêmio maior.`,
  deathBenefit: 'Benefício por morte',
  cashValue: 'Valor de resgate',
  age: (value) => `Idade ${value}`,
  policyYearColumn: 'ANO DA APÓLICE',
  ageColumn: 'IDADE',
  deathBenefitColumn: 'BENEFÍCIO POR MORTE',
  cashValueColumn: 'VALOR DE RESGATE',
  outlayColumn: 'VOCÊ PAGA',
  accumulatedColumn: 'ACUMULADO',
  year: (value) => `Ano ${value}`,
  yourPlan: 'Seu plano',
  yearByYear: 'Anos selecionados da apólice',
  whatYouPutIn: 'O que você aporta, no que se torna',
  scenarioGuideTitle: 'Como ler os dois cenários',
  scenarioCurrentBody: 'Usa as taxas e os encargos atualmente ilustrados pela National Life. Estes valores podem mudar e não são garantidos.',
  scenarioGuaranteedBody: 'Usa a menor taxa creditada e os maiores encargos permitidos pelo contrato. É o cenário conservador publicado pela National Life.',
  totalContributions: 'Total aportado',
  accumulatedAt: (age) => `Valor acumulado aos ${age} anos`,
  growth: 'Crescimento',
  lapseNote: (year) => `Nestas premissas, a apólice se encerraria no ano ${year}.`,
  mecNote: (year) => `Esta apólice se torna um Modified Endowment Contract no ano ${year}.`,
  nextStep: 'Próximo passo',
  nextStepBody: 'Converse com seu consultor sobre qualquer ponto destas páginas, e peça a ilustração completa da National Life sempre que quiser o detalhe integral por trás delas.',
  sourceLine: (date) => `Fonte: ilustração da National Life emitida em ${date}. Peça ao seu consultor a ilustração completa.`,
  termDuration: {
    '10-G': 'Prêmio nivelado garantido por 10 anos',
    '15-G': 'Prêmio nivelado garantido por 15 anos',
    '20-G': 'Prêmio nivelado garantido por 20 anos',
    '30-G': 'Prêmio nivelado garantido por 30 anos',
    ART: 'Renovável anualmente — o prêmio aumenta a cada ano',
  },
  premiumSchedule: 'O que você paga, ano a ano',
  guaranteed: 'Garantido em contrato',
  levelThrough: (year, age) => `Até o ano ${year} — idade ${age}`,
  afterLevel: (year, age) => `A partir do ano ${year} — idade ${age}`,
  perMonth: 'por mês',
  premiumColumn: 'VOCÊ PAGA POR ANO',
  scheduleNote: (face, age) =>
    `O benefício por morte permanece em ${face} enquanto o prêmio for pago, até os ${age} anos.`,
}

export function clientSummaryCopy(language: ClientSummaryLanguage): Copy {
  return language === 'PT' ? PT : EN
}
