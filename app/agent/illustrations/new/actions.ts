"use server";

import { getCurrentAgent } from '@/lib/agent-context'
import { enqueueRapidSolveQuote } from '@/lib/national-life/job-service'
import {
  DEATH_BENEFIT_OPTIONS,
  GENDERS,
  ISSUE_STATES,
  RAPID_SOLVE_ALLOCATION,
  RAPID_SOLVE_PRODUCT_CODE,
  RATE_CLASSES,
  SOLVE_TYPES,
  STRATEGIES,
  toCarrierDate,
} from '@/lib/national-life/rapid-solve'

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

type RequestCarrierQuoteResult =
  | { ok: true; jobId: string }
  | { ok: false; message: string }

const SOLVE_TYPE_VALUES = new Set<string>(Object.values(SOLVE_TYPES))
const RATE_CLASS_VALUES = new Set<string>(Object.values(RATE_CLASSES))
const GENDER_VALUES = new Set<string>(Object.values(GENDERS))
const DEATH_BENEFIT_VALUES = new Set<string>(Object.values(DEATH_BENEFIT_OPTIONS))
const ISSUE_STATE_VALUES = new Set<string>(ISSUE_STATES)
const STRATEGY_VALUES = new Set<string>(Object.values(STRATEGIES))

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
  const clientId = normalizeText(formData.get('clientId') as string | null)
  const amount = Number(normalizeText(formData.get('amount') as string | null))

  if (!firstName) return { ok: false, message: 'Informe o nome.' }
  if (!lastName) return { ok: false, message: 'Informe o sobrenome.' }
  if (!dateOfBirthRaw) return { ok: false, message: 'Informe a data de nascimento (DOB).' }

  // Checked against the carrier's own lists rather than for non-emptiness. New
  // York is the reason this matters: it is not on the list, and a prospect
  // there should be turned away here instead of by a refusal that costs a
  // carrier round trip and reads like the quote failed.
  if (!ISSUE_STATE_VALUES.has(issueState)) {
    return {
      ok: false,
      message: 'A National Life não emite neste estado por este portal.',
    }
  }
  if (!GENDER_VALUES.has(gender)) {
    return { ok: false, message: 'Informe o sexo, como a seguradora o classifica.' }
  }
  if (!RATE_CLASS_VALUES.has(rateClass)) {
    return { ok: false, message: 'Informe a classe de risco.' }
  }
  if (!DEATH_BENEFIT_VALUES.has(deathBenefitOption)) {
    return { ok: false, message: 'Informe a opção de benefício por morte.' }
  }
  if (!SOLVE_TYPE_VALUES.has(solveType)) {
    return { ok: false, message: 'Escolha o que a seguradora deve calcular.' }
  }
  if (!STRATEGY_VALUES.has(strategy)) {
    return { ok: false, message: 'Escolha a estratégia de índice.' }
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
        // Not a choice: the request carries one strategy, and the carrier's
        // script fills allocation with 100% the moment one is picked.
        allocation: RAPID_SOLVE_ALLOCATION,
        productCode: RAPID_SOLVE_PRODUCT_CODE,
        // Present only when the agent quoted for someone already in the book.
        // A prospect has none, which is the ordinary pre-sale case.
        ...(clientId ? { clientId } : {}),
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
