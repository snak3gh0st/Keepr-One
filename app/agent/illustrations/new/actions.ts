'use server'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getCurrentAgent } from '@/lib/agent-context'
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
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: 'Conecte o K-Bot neste navegador para gerar a ilustração oficial.' }
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
  const deathBenefitOption = normalizeText(formData.get('deathBenefitOption') as string | null)
  const strategy = normalizeText(formData.get('strategy') as string | null)
  const termDuration = normalizeText(formData.get('termDuration') as string | null)
  const premiumMode = normalizeText(formData.get('premiumMode') as string | null)
  const clientId = normalizeText(formData.get('clientId') as string | null)
  const faceAmount = Number(normalizeText(formData.get('faceAmount') as string | null))
  const monthlyPremium = Number(normalizeText(formData.get('monthlyPremium') as string | null))

  if (!product) return { ok: false, message: 'Escolha o produto da ilustração.' }
  if (!firstName) return { ok: false, message: 'Informe o nome.' }
  if (!lastName) return { ok: false, message: 'Informe o sobrenome.' }
  const dateOfBirth = parseIsoDate(dateOfBirthRaw)
  if (!dateOfBirth) return { ok: false, message: 'Data de nascimento inválida.' }
  if (!FORESIGHT_ISSUE_STATES.includes(issueState as typeof FORESIGHT_ISSUE_STATES[number])) {
    return { ok: false, message: 'Escolha o estado de emissão.' }
  }
  if (!GENDERS.has(gender)) return { ok: false, message: 'Informe o sexo, como a seguradora o classifica.' }
  if (!RATE_CLASSES.has(rateClass)) return { ok: false, message: 'Informe a classe de risco.' }
  const isPremiumSolve = product?.kind === 'IUL' && solveBasis === 'PREMIUM'
  const isExplicitIulSolve = product?.kind === 'IUL' && solveBasis.length > 0
  if (!isPremiumSolve && (!Number.isFinite(faceAmount) || faceAmount <= 0 || faceAmount > 1_000_000_000)) {
    return { ok: false, message: 'Informe um capital segurado maior que zero.' }
  }
  if (product.kind === 'IUL') {
    if (isExplicitIulSolve && !IUL_SOLVE_BASES.has(solveBasis)) {
      return { ok: false, message: 'Escolha se a ilustração será resolvida por capital ou prêmio.' }
    }
    if (!DEATH_BENEFIT_OPTIONS.has(deathBenefitOption)) {
      return { ok: false, message: 'Informe a opção de benefício por morte.' }
    }
    if (strategy !== CAP_FOCUS) {
      return { ok: false, message: 'A ilustração oficial usa S&P 500 — foco em teto.' }
    }
    if ((isPremiumSolve || !isExplicitIulSolve) &&
      (!Number.isFinite(monthlyPremium) || monthlyPremium <= 0 || monthlyPremium > 100_000_000)) {
      return { ok: false, message: 'Informe um prêmio mensal maior que zero.' }
    }
  } else if (!TERM_DURATIONS.has(termDuration)) {
    return { ok: false, message: 'Escolha a duração do Term.' }
  } else if (premiumMode !== 'Monthly') {
    return { ok: false, message: 'A ilustração Term oficial usa cobrança mensal.' }
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
      return { ok: false, message: 'Cliente fora da sua carteira pessoal.' }
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
            : 'CARRIER_CALCULATED_FOR_TERM',
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
    return { ok: false, message: 'Não foi possível iniciar a ilustração oficial agora.' }
  }
}
