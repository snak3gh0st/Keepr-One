"use server";

import { getCurrentAgent } from '@/lib/agent-context'
import { enqueueRapidSolveQuote } from '@/lib/national-life/job-service'
import { RAPID_SOLVE_PRODUCT_CODE, SOLVE_TYPES, toCarrierDate } from '@/lib/national-life/rapid-solve'
import { calculateMarketPremium, type MarketAgeBand } from '@/lib/policy-quote'

type TobaccoStatus = 'YES' | 'NO' | 'FORMER'

type QuoteProductCode = 'TERM_15' | 'TERM_20' | 'TERM_30' | 'IUL'

type QuoteEntry = {
  productCode: QuoteProductCode
  productLabel: string
  formulaLabel: string
  basePremium: number
  tobaccoFactor: number
  premium: number
}

type InsuredSnapshot = {
  firstName: string
  lastName: string
  dateOfBirth: string
  age: number
  tobaccoStatus: TobaccoStatus
}

type CreateIllustrationRequestResult =
  | {
      ok: true
      insured: InsuredSnapshot
      coverageAmount: number
      ageBand: MarketAgeBand
      tobaccoFactor: number
      quotes: QuoteEntry[]
      calculatedAt: string
    }
  | { ok: false; message: string }

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function parseIntValue(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : null
}

function calculateAgeFromDOB(dob: Date): number {
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const hasBirthdayPassed =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate())
  if (!hasBirthdayPassed) age -= 1
  return age
}

const BASE_COVERAGE_AMOUNT = 100_000

const ILLUSTRATION_PRODUCTS: Array<{
  code: QuoteProductCode
  productLabel: string
  productInput: string
}> = [
  { code: 'TERM_15', productLabel: 'Term 15', productInput: 'Term 15' },
  { code: 'TERM_20', productLabel: 'Term 20', productInput: 'Term 20' },
  { code: 'TERM_30', productLabel: 'Term 30', productInput: 'Term 30' },
  { code: 'IUL', productLabel: 'IUL', productInput: 'IUL' },
]

const TOBACCO_FACTORS: Record<TobaccoStatus, number> = {
  NO: 1,
  FORMER: 1.2,
  YES: 1.45,
}

function getAgeBandFromAge(age: number): MarketAgeBand {
  if (age <= 30) return 'AGE_18_30'
  if (age <= 45) return 'AGE_31_45'
  if (age <= 59) return 'AGE_46_59'
  return 'AGE_60_PLUS'
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function buildIllustrationQuotes(ageBand: MarketAgeBand, tobaccoStatus: TobaccoStatus): QuoteEntry[] {
  return ILLUSTRATION_PRODUCTS.map(({ code, productLabel, productInput }) => {
    const quote = calculateMarketPremium({
      product: productInput,
      faceAmount: BASE_COVERAGE_AMOUNT,
      ageBand,
    })
    const tobaccoFactor = TOBACCO_FACTORS[tobaccoStatus]
    return {
      productCode: code,
      productLabel,
      formulaLabel: quote.formulaLabel,
      basePremium: quote.premium,
      tobaccoFactor,
      premium: roundMoney(quote.premium * tobaccoFactor),
    }
  })
}

type RequestCarrierQuoteResult =
  | { ok: true; jobId: string }
  | { ok: false; message: string }

const SOLVE_TYPE_VALUES = new Set<string>(Object.values(SOLVE_TYPES))

/// Asks National Life to price the illustration, instead of estimating it here.
///
/// Returns a job id rather than a quote. The app reaches neither the carrier
/// nor the browser that holds the agent's session — both live in the runtime —
/// so the question is queued and the screen polls for the answer.
///
/// The carrier's own fields are taken from the form rather than derived from
/// the ones already there. A tobacco answer is not a rate class, and guessing
/// the mapping would misprice the quote in a way that looks like a quote.
export async function requestCarrierQuote(
  formData: FormData,
): Promise<RequestCarrierQuoteResult> {
  const agent = await getCurrentAgent()

  const firstName = normalizeText(formData.get('firstName') as string | null)
  const lastName = normalizeText(formData.get('lastName') as string | null)
  const dateOfBirthRaw = normalizeText(formData.get('dateOfBirth') as string | null)
  const issueState = normalizeText(formData.get('issueState') as string | null)
  const gender = normalizeText(formData.get('gender') as string | null)
  const rateClass = normalizeText(formData.get('rateClass') as string | null)
  const solveType = normalizeText(formData.get('solveType') as string | null)
  const deathBenefitOption = normalizeText(formData.get('deathBenefitOption') as string | null)
  const strategy = normalizeText(formData.get('strategy') as string | null)
  const amount = Number(normalizeText(formData.get('amount') as string | null))
  const allocationRaw = normalizeText(formData.get('allocation') as string | null)
  const allocation = allocationRaw === '' ? 100 : Number(allocationRaw)
  const productCode =
    normalizeText(formData.get('productCode') as string | null) || RAPID_SOLVE_PRODUCT_CODE

  if (!firstName) return { ok: false, message: 'Informe o nome.' }
  if (!lastName) return { ok: false, message: 'Informe o sobrenome.' }
  if (!dateOfBirthRaw) return { ok: false, message: 'Informe a data de nascimento (DOB).' }
  if (!issueState) return { ok: false, message: 'Informe o estado de emissão.' }
  if (!gender) return { ok: false, message: 'Informe o gênero, como a seguradora o classifica.' }
  if (!rateClass) return { ok: false, message: 'Informe a classe de risco.' }
  if (!deathBenefitOption) return { ok: false, message: 'Informe a opção de benefício por morte.' }
  if (!strategy) return { ok: false, message: 'Informe a estratégia de alocação.' }

  if (!SOLVE_TYPE_VALUES.has(solveType)) {
    return { ok: false, message: 'Escolha o que a seguradora deve calcular.' }
  }

  // The same field carries face amount or premium depending on the solve type,
  // which is how the carrier's own screen works.
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      message:
        solveType === SOLVE_TYPES.SPECIFY_AMOUNT
          ? 'Informe um capital segurado maior que zero.'
          : 'Informe um prêmio maior que zero.',
    }
  }

  if (!Number.isFinite(allocation) || allocation < 0 || allocation > 100) {
    return { ok: false, message: 'A alocação precisa estar entre 0 e 100.' }
  }

  const dateOfBirth = new Date(`${dateOfBirthRaw}T00:00:00.000Z`)
  if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
    return { ok: false, message: 'Data de nascimento inválida.' }
  }

  try {
    const { jobId } = await enqueueRapidSolveQuote({
      agentId: agent.id,
      quote: {
        issueState,
        firstName,
        lastName,
        // The carrier's format, written once here so the queue never carries a
        // date that has to be guessed at on the way out.
        dateOfBirth: toCarrierDate(dateOfBirth),
        gender,
        rateClass,
        solveType,
        amount,
        deathBenefitOption,
        strategy,
        allocation,
        productCode,
      },
    })

    return { ok: true, jobId }
  } catch {
    // The reason is either a validation detail already checked above or an
    // infrastructure fault. Neither is something to put in front of an agent.
    return {
      ok: false,
      message: 'Não foi possível enviar a cotação para a seguradora. Tente novamente.',
    }
  }
}

export async function createIllustrationRequest(formData: FormData): Promise<CreateIllustrationRequestResult> {
  await getCurrentAgent()

  const firstName = normalizeText(formData.get('firstName') as string | null)
  const lastName = normalizeText(formData.get('lastName') as string | null)
  const dateOfBirthRaw = normalizeText(formData.get('dateOfBirth') as string | null)
  const age = parseIntValue(formData.get('age') as string | null)
  const tobaccoStatus = normalizeText(formData.get('tobaccoStatus') as string | null) as TobaccoStatus | ''

  if (!firstName) return { ok: false, message: 'Informe o nome.' }
  if (!lastName) return { ok: false, message: 'Informe o sobrenome.' }
  if (!dateOfBirthRaw) return { ok: false, message: 'Informe a data de nascimento (DOB).' }
  if (age === null || age < 0 || age > 120) return { ok: false, message: 'Informe uma idade válida entre 0 e 120.' }
  if (tobaccoStatus !== 'YES' && tobaccoStatus !== 'NO' && tobaccoStatus !== 'FORMER') {
    return { ok: false, message: 'Informe a situação de tabagismo.' }
  }

  const dateOfBirth = new Date(`${dateOfBirthRaw}T00:00:00.000Z`)
  if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth > new Date()) {
    return { ok: false, message: 'Data de nascimento inválida.' }
  }

  const inferredAge = calculateAgeFromDOB(dateOfBirth)
  if (Math.abs(inferredAge - age) > 1) {
    return {
      ok: false,
      message: `A idade informada (${age}) não bate com a DOB (${inferredAge} anos). Corrija antes de continuar.`,
    }
  }

  const insured: InsuredSnapshot = {
    firstName,
    lastName,
    dateOfBirth: dateOfBirthRaw,
    age,
    tobaccoStatus,
  }
  const ageBand = getAgeBandFromAge(age)

  const quotes = buildIllustrationQuotes(ageBand, tobaccoStatus)

  return {
    ok: true,
    insured,
    coverageAmount: BASE_COVERAGE_AMOUNT,
    ageBand,
    tobaccoFactor: TOBACCO_FACTORS[tobaccoStatus],
    quotes,
    calculatedAt: new Date().toISOString(),
  }
}
