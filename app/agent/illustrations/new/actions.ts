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

/// Creates the exact, reviewable instruction that the Foresight executor will
/// write into the carrier. It intentionally does not call Rapid Solve: capital
/// and monthly premium are the agent's explicit inputs, and the official NAIC
/// document is the carrier artifact returned by Foresight.
export async function requestForesightIllustration(
  formData: FormData,
): Promise<RequestForesightIllustrationResult> {
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: 'Conecte o KeeproneConnect para gerar a ilustração oficial.' }
  }
  const agent = await getCurrentAgent()

  const firstName = normalizeText(formData.get('firstName') as string | null)
  const lastName = normalizeText(formData.get('lastName') as string | null)
  const dateOfBirthRaw = normalizeText(formData.get('dateOfBirth') as string | null)
  const issueState = normalizeText(formData.get('issueState') as string | null)
  const gender = normalizeText(formData.get('gender') as string | null)
  const rateClass = normalizeText(formData.get('rateClass') as string | null)
  const deathBenefitOption = normalizeText(formData.get('deathBenefitOption') as string | null)
  const strategy = normalizeText(formData.get('strategy') as string | null)
  const clientId = normalizeText(formData.get('clientId') as string | null)
  const faceAmount = Number(normalizeText(formData.get('faceAmount') as string | null))
  const monthlyPremium = Number(normalizeText(formData.get('monthlyPremium') as string | null))

  if (!firstName) return { ok: false, message: 'Informe o nome.' }
  if (!lastName) return { ok: false, message: 'Informe o sobrenome.' }
  const dateOfBirth = parseIsoDate(dateOfBirthRaw)
  if (!dateOfBirth) return { ok: false, message: 'Data de nascimento inválida.' }
  if (!FORESIGHT_ISSUE_STATES.includes(issueState as typeof FORESIGHT_ISSUE_STATES[number])) {
    return { ok: false, message: 'Escolha o estado de emissão.' }
  }
  if (!GENDERS.has(gender)) return { ok: false, message: 'Informe o sexo, como a seguradora o classifica.' }
  if (!RATE_CLASSES.has(rateClass)) return { ok: false, message: 'Informe a classe de risco.' }
  if (!DEATH_BENEFIT_OPTIONS.has(deathBenefitOption)) {
    return { ok: false, message: 'Informe a opção de benefício por morte.' }
  }
  if (strategy !== CAP_FOCUS) {
    return { ok: false, message: 'A ilustração oficial usa S&P 500 — foco em teto.' }
  }
  if (!Number.isFinite(faceAmount) || faceAmount <= 0 || faceAmount > 1_000_000_000) {
    return { ok: false, message: 'Informe um capital segurado maior que zero.' }
  }
  if (!Number.isFinite(monthlyPremium) || monthlyPremium <= 0 || monthlyPremium > 100_000_000) {
    return { ok: false, message: 'Informe um prêmio mensal maior que zero.' }
  }

  const illustrationId = `ill_${randomUUID()}`
  const rawPayload = {
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
  } as Prisma.InputJsonValue

  try {
    const issued = await prisma.$transaction(async (tx) => {
      const repository = createPrismaConnectorCommandRepository(tx)
      const created = await tx.illustration.create({
        data: {
          id: illustrationId,
          agentId: agent.id,
          clientId: clientId || null,
          kind: 'PRELIMINARY',
          productName: 'FlexLife',
          provider: NATIONAL_LIFE_PROVIDER,
          externalId: illustrationId,
          faceAmount,
          premium: null,
          targetPremium: monthlyPremium,
          targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
          insuredName: `${firstName} ${lastName}`,
          insuredDateOfBirth: dateOfBirth,
          rawPayload,
        },
        select: { id: true, createdAt: true },
      })
      const snapshot = buildForesightIllustrationSnapshot({
        ...created,
        caseId: null,
        productName: 'FlexLife',
        rawPayload,
      })
      const inputHash = foresightIllustrationInputHash(snapshot)
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
