'use server'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getCurrentAgent as readCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import {
  approveConnectorCommand,
  ConnectorCommandError,
  createPrismaConnectorCommandRepository,
  issueConnectorCommand,
} from '@/lib/national-life/connector-command-service'
import {
  buildForesightIllustrationSnapshot,
  FORESIGHT_ISSUE_STATES,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
} from '@/lib/national-life/foresight-term-contract'
import { getForesightIllustrationProduct } from '@/lib/national-life/foresight-product-catalog'
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { getServerI18n } from '@/lib/i18n/server'
import { requireAgentModule } from '@/lib/require-agent-module'

async function getCurrentAgent() {
  await requireAgentModule('ILLUSTRATIONS')
  return readCurrentAgent()
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date > new Date()
    ? null
    : date
}

type RequestForesightIllustrationResult =
  | { ok: true; commandId: string; illustrationId: string }
  | { ok: false; message: string }

const GENDERS = new Set(['Male', 'Female'])
const RATE_CLASSES = new Set(['Standard_NT', 'Standard_Tobacco'])
const DEATH_BENEFIT_OPTIONS = new Set(['A_Level', 'B_Increasing'])
const CAP_FOCUS = 'SP500PointToPointCapFocus'
const TERM_DURATIONS = new Set(['10-G', '15-G', '20-G', '30-G', 'ART'])
const IUL_SOLVE_BASES = new Set(['DEATH_BENEFIT', 'PREMIUM'])
const IUL_SOLVE_METHOD_BASIS: Record<string, 'DEATH_BENEFIT' | 'PREMIUM'> = {
  Minimum_DB_Max_Cash_Value: 'PREMIUM',
  Balanced_DB: 'PREMIUM',
  Based_on_Target_Premium: 'PREMIUM',
  Protection_Focus: 'DEATH_BENEFIT',
  Retirement_Focus: 'DEATH_BENEFIT',
}
const ACTIVE_ILLUSTRATION_COMMAND_STATES = [
  'QUEUED',
  'RUNNING',
  'AUTH_REQUIRED',
  'WAITING_FOR_CONFIRMATION',
  'PAUSED',
] as const

function targetIllustrationId(target: unknown): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null
  const value = target as Record<string, unknown>
  return value.kind === 'ILLUSTRATION' && typeof value.id === 'string' ? value.id : null
}

/// Creates the exact, reviewable instruction that the Foresight executor will
/// write into the carrier. It intentionally does not call Rapid Solve: capital
/// or monthly premium is the agent's explicit source, while the other value is
/// calculated by Foresight and accepted only with the official NAIC document.
export async function requestForesightIllustration(
  formData: FormData,
): Promise<RequestForesightIllustrationResult> {
  const { copy } = await getServerI18n()
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: copy('Conecte o K-Bot neste navegador para gerar a ilustração oficial.', 'Connect K-Bot in this browser to generate the official illustration.') }
  }
  const agent = await getCurrentAgent()

  const firstName = normalizeText(formData.get('firstName') as string | null)
  const product = getForesightIllustrationProduct(normalizeText(formData.get('product') as string | null))
  const lastName = normalizeText(formData.get('lastName') as string | null)
  const dateOfBirthRaw = normalizeText(formData.get('dateOfBirth') as string | null)
  const issueState = normalizeText(formData.get('issueState') as string | null)
  const gender = normalizeText(formData.get('gender') as string | null)
  const rateClass = normalizeText(formData.get('rateClass') as string | null)
  const solveBasis = normalizeText(formData.get('solveBasis') as string | null)
  const requestedSolveMethod = normalizeText(formData.get('solveMethod') as string | null)
  const deathBenefitOption = normalizeText(formData.get('deathBenefitOption') as string | null)
  const strategy = normalizeText(formData.get('strategy') as string | null)
  const termDuration = normalizeText(formData.get('termDuration') as string | null)
  const premiumMode = normalizeText(formData.get('premiumMode') as string | null)
  const clientId = normalizeText(formData.get('clientId') as string | null)
  const faceAmount = Number(normalizeText(formData.get('faceAmount') as string | null))
  const monthlyPremium = Number(normalizeText(formData.get('monthlyPremium') as string | null))

  if (!product) return { ok: false, message: copy('Escolha o produto da ilustração.', 'Choose the illustration product.') }
  if (!firstName) return { ok: false, message: copy('Informe o nome.', 'Enter the first name.') }
  if (!lastName) return { ok: false, message: copy('Informe o sobrenome.', 'Enter the last name.') }
  const dateOfBirth = parseIsoDate(dateOfBirthRaw)
  if (!dateOfBirth) return { ok: false, message: copy('Data de nascimento inválida.', 'Invalid date of birth.') }
  if (!FORESIGHT_ISSUE_STATES.includes(issueState as typeof FORESIGHT_ISSUE_STATES[number])) {
    return { ok: false, message: copy('Escolha o estado de emissão.', 'Choose the issue state.') }
  }
  if (!GENDERS.has(gender)) return { ok: false, message: copy('Informe o sexo, como a seguradora o classifica.', 'Enter the sex as classified by the carrier.') }
  if (!RATE_CLASSES.has(rateClass)) return { ok: false, message: copy('Informe a classe de risco.', 'Enter the rate class.') }
  const isPremiumSolve = product?.kind === 'IUL' && solveBasis === 'PREMIUM'
  const isExplicitIulSolve = product?.kind === 'IUL' && solveBasis.length > 0
  const solveMethod = requestedSolveMethod || (solveBasis === 'PREMIUM'
    ? 'Based_on_Target_Premium'
    : 'Protection_Focus')
  if (!isPremiumSolve && (!Number.isFinite(faceAmount) || faceAmount <= 0 || faceAmount > 1_000_000_000)) {
    return { ok: false, message: copy('Informe um capital segurado maior que zero.', 'Enter a face amount greater than zero.') }
  }
  if (product.kind === 'IUL') {
    if (isExplicitIulSolve && !IUL_SOLVE_BASES.has(solveBasis)) {
      return { ok: false, message: copy('Escolha uma estratégia válida para o IUL.', 'Choose a valid IUL strategy.') }
    }
    if (isExplicitIulSolve && IUL_SOLVE_METHOD_BASIS[solveMethod] !== solveBasis) {
      return { ok: false, message: copy('A estratégia escolhida não corresponde ao cenário informado.', 'The selected strategy does not match the entered scenario.') }
    }
    if (!DEATH_BENEFIT_OPTIONS.has(deathBenefitOption)) {
      return { ok: false, message: copy('Informe a opção de benefício por morte.', 'Enter the death benefit option.') }
    }
    if (strategy !== CAP_FOCUS) {
      return { ok: false, message: copy('A ilustração oficial usa S&P 500 — foco em teto.', 'The official illustration uses S&P 500 — cap focus.') }
    }
    if ((isPremiumSolve || !isExplicitIulSolve) &&
      (!Number.isFinite(monthlyPremium) || monthlyPremium <= 0 || monthlyPremium > 100_000_000)) {
      return { ok: false, message: copy('Informe um prêmio mensal maior que zero.', 'Enter a monthly premium greater than zero.') }
    }
  } else if (!TERM_DURATIONS.has(termDuration)) {
    return { ok: false, message: copy('Escolha a duração do Term.', 'Choose the Term duration.') }
  } else if (premiumMode !== 'Monthly') {
    return { ok: false, message: copy('A ilustração Term oficial usa cobrança mensal.', 'The official Term illustration uses monthly billing.') }
  }

  const illustrationId = `ill_${randomUUID()}`
  const rawPayload = (product.kind === 'IUL'
    ? isExplicitIulSolve
      ? {
          foresightDraft: {
            schemaVersion: 2,
            firstName,
            lastName,
            dateOfBirth: dateOfBirthRaw,
            issueState,
            gender,
            rateClass,
            solveBasis,
            solveMethod,
            ...(solveBasis === 'PREMIUM'
              ? { targetMonthlyPremium: monthlyPremium }
              : { targetFaceAmount: faceAmount }),
            deathBenefitOption,
            strategy: CAP_FOCUS,
          },
        }
      : {
        foresightDraft: {
          schemaVersion: 1,
          firstName,
          lastName,
          dateOfBirth: dateOfBirthRaw,
          issueState,
          gender,
          rateClass,
          faceAmount,
          monthlyPremium,
          deathBenefitOption,
          strategy: CAP_FOCUS,
        },
      }
    : {
        foresightTermDraft: {
          schemaVersion: 1,
          carrierProduct: product.carrierName,
          firstName,
          lastName,
          dateOfBirth: dateOfBirthRaw,
          issueState,
          gender,
          rateClass,
          faceAmount,
          premiumMode: 'Monthly',
          termDuration,
        },
      }) as Prisma.InputJsonValue

  if (clientId) {
    const ownedClient = await prisma.client.findFirst({
      where: { id: clientId, assignedAgentId: agent.id },
      select: { id: true },
    })
    if (!ownedClient) {
      return { ok: false, message: copy('Cliente fora da sua carteira pessoal.', 'Client is outside your personal book.') }
    }
  }

  try {
    const issued = await prisma.$transaction(async (tx) => {
      // Serialize per agent inside Postgres. This protects every browser tab and
      // survives two requests arriving before either UI can repaint.
      // Postgres returns `void` from pg_advisory_xact_lock. Prisma cannot
      // deserialize that type and raises P2010 after the lock was acquired, so
      // expose the otherwise-unused result as text.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`foresight:${agent.id}`}, 0))::text AS lock_result`
      const active = await tx.nationalLifeConnectorCommand.findFirst({
        where: {
          agentId: agent.id,
          capability: 'GENERATE_ILLUSTRATION',
          state: { in: [...ACTIVE_ILLUSTRATION_COMMAND_STATES] },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, target: true },
      })
      const activeIllustrationId = targetIllustrationId(active?.target)
      if (active && activeIllustrationId) {
        return {
          command: { commandId: active.id },
          illustrationId: activeIllustrationId,
        }
      }

      const repository = createPrismaConnectorCommandRepository(tx)
      const created = await tx.illustration.create({
        data: {
          id: illustrationId,
          agentId: agent.id,
          clientId: clientId || null,
          kind: 'PRELIMINARY',
          productName: product.carrierName,
          provider: NATIONAL_LIFE_PROVIDER,
          externalId: illustrationId,
          faceAmount: isPremiumSolve ? null : faceAmount,
          premium: null,
          targetPremium: product.kind === 'IUL' && (isPremiumSolve || !isExplicitIulSolve)
            ? monthlyPremium
            : null,
          targetPremiumSource: product.kind === 'IUL'
            ? isPremiumSolve || !isExplicitIulSolve
              ? 'AGENT_INPUT_FOR_FORESIGHT'
              : 'FORESIGHT_CALCULATES_PREMIUM_FROM_DEATH_BENEFIT'
            : null,
          insuredName: `${firstName} ${lastName}`,
          insuredDateOfBirth: dateOfBirth,
          rawPayload,
        },
        select: { id: true, createdAt: true },
      })
      const source = { ...created, caseId: null, productName: product.carrierName, rawPayload }
      const inputHash = product.kind === 'IUL'
        ? foresightIllustrationInputHash(buildForesightIllustrationSnapshot(source))
        : foresightTermIllustrationInputHash(buildForesightTermIllustrationSnapshot(source))
      const command = await issueConnectorCommand(repository, {
        agentId: agent.id,
        capability: 'GENERATE_ILLUSTRATION',
        target: { kind: 'ILLUSTRATION', id: created.id },
        params: { illustrationId: created.id, inputHash },
        idempotencyKey: `foresight:${created.id}:${inputHash}`,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      })
      await approveConnectorCommand(repository, {
        agentId: agent.id,
        commandId: command.command.commandId,
        payloadHash: command.payloadHash,
        confirmedByUserId: agent.userId,
      })
      return { ...command, illustrationId: created.id }
    })
    return {
      ok: true,
      commandId: issued.command.commandId,
      illustrationId: issued.illustrationId,
    }
  } catch (error) {
    const rawCode = error instanceof ConnectorCommandError
      ? error.code
      : error && typeof error === 'object' && 'code' in error &&
          typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message
          : 'UNCLASSIFIED'
    console.error('NATIONAL_LIFE_FORESIGHT_COMMAND_FAILED', {
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: rawCode,
    })
    return { ok: false, message: copy('Não foi possível iniciar a ilustração oficial agora.', 'The official illustration could not be started right now.') }
  }
}
