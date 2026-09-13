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
  notGuaranteed: string
  currentAndGuaranteed: string
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
  notGuaranteed: 'Not guaranteed · current assumptions',
  currentAndGuaranteed: 'Current vs. guaranteed assumptions',
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
  yearByYear: 'Year by year',
  whatYouPutIn: 'What you pay in, what it becomes',
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
  notGuaranteed: 'Não garantido · premissas atuais',
  currentAndGuaranteed: 'Premissas atuais vs. garantidas',
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
  yearByYear: 'Ano a ano',
  whatYouPutIn: 'O que você aporta, no que se torna',
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
