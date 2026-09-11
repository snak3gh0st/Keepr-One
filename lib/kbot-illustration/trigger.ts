import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizePlatformModules } from '@/lib/platform-modules'
import { getForesightIllustrationProduct } from '@/lib/national-life/foresight-product-catalog'
import {
  buildForesightIllustrationSnapshot,
  FORESIGHT_ISSUE_STATES,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'
import { dispatchForesightIllustration } from '@/lib/national-life/foresight-illustration-dispatch'
import {
  APPROVAL_WINDOW_MS,
  AWAITING_APPROVAL,
  APPROVED,
  DELIVERING,
  FAILED,
  GENERATING,
  GENERATION_WINDOW_MS,
  type IllustrationRefusal,
} from './domain'

/// Raising an illustration from a conversation.
///
/// The K-Bot notices that a client asked what a policy would cost and starts
/// the carrier run. What it does *not* do is answer them: the request lands in
/// GENERATING and, once the connector reports numbers, in AWAITING_APPROVAL,
/// where the agent reads the face amount and the premium before anyone else
/// does. See `approval.ts` for the gate.

/// The interest that prompted this. Detection is a separate problem — today an
/// agent marks the conversation, tomorrow an intent model does — so the signal
/// is an input here and nothing downstream has to change when that lands.
export type IllustrationInterestSignal = {
  conversationId: string
  clientId: string
  detectedBy: 'AGENT_MARKED' | 'KBOT_INTENT'
  /// The words that were read as interest, kept so the agent reviewing the
  /// numbers can see what the bot reacted to.
  excerpt?: string | null
  /// Confidence when a detector produced the signal. Absent when a person did.
  confidence?: number | null
  detectedAt?: Date
}

/// The carrier inputs a conversation cannot supply. Deliberately explicit: an
/// illustration with an invented face amount is worse than no illustration, so
/// there are no defaults here and a missing value is a refusal.
export type IllustrationQuoteInput = {
  productKey: 'FLEXLIFE_IUL'
  issueState: string
  gender: 'Male' | 'Female'
  rateClass: 'Standard_NT' | 'Standard_Tobacco'
  faceAmount: number
  monthlyPremium: number
  deathBenefitOption: 'A_Level' | 'B_Increasing'
}

export type RequestIllustrationResult =
  | {
      ok: true
      requestId: string
      illustrationId: string
      commandId: string
    }
  | { ok: false; reason: IllustrationRefusal; requestId?: string }

const CAP_FOCUS = 'SP500PointToPointCapFocus'
const GENDERS = new Set(['Male', 'Female'])
const RATE_CLASSES = new Set(['Standard_NT', 'Standard_Tobacco'])
const DEATH_BENEFIT_OPTIONS = new Set(['A_Level', 'B_Increasing'])

function positiveMoney(value: number, max: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= max
}

/// The module check the agent's own screen makes, asked about an agent instead
/// of about a session: this path has no request to read a session from.
async function illustrationsModuleEnabled(agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      adminProvisionedAccess: { select: { modules: true } },
      agencyInvitationsAccepted: {
        where: { status: 'ACCEPTED', isCurrentCommercial: true },
        take: 1,
        select: { id: true },
      },
    },
  })
  if (!agent) return false
  const managedAccess = agent.agencyInvitationsAccepted.length ? null : agent.adminProvisionedAccess
  if (!managedAccess) return true
  return normalizePlatformModules(managedAccess.modules).includes('ILLUSTRATIONS')
}

/// Start an illustration for a client of this agent.
///
/// Every read and write below is scoped by `agentId`, and the client is matched
/// by `assignedAgentId`, so a signal carrying someone else's client id raises
/// nothing.
export async function requestIllustrationForSignal(input: {
  agentId: string
  userId: string
  signal: IllustrationInterestSignal
  quote: IllustrationQuoteInput
  now?: Date
}): Promise<RequestIllustrationResult> {
  const { agentId, userId, signal, quote } = input
  const now = input.now ?? new Date()

  if (!isNationalLifeLocalConnectorEnabled()) return { ok: false, reason: 'CONNECTOR_NOT_CONNECTED' }

  const product = getForesightIllustrationProduct(quote.productKey)
  if (!product || product.kind !== 'IUL') return { ok: false, reason: 'PRODUCT_NOT_SUPPORTED' }
  if (!FORESIGHT_ISSUE_STATES.includes(quote.issueState as typeof FORESIGHT_ISSUE_STATES[number])) {
    return { ok: false, reason: 'QUOTE_INPUT_INVALID' }
  }
  if (!GENDERS.has(quote.gender) || !RATE_CLASSES.has(quote.rateClass)) {
    return { ok: false, reason: 'QUOTE_INPUT_INVALID' }
  }
  if (!DEATH_BENEFIT_OPTIONS.has(quote.deathBenefitOption)) return { ok: false, reason: 'QUOTE_INPUT_INVALID' }
  if (!positiveMoney(quote.faceAmount, 1_000_000_000)) return { ok: false, reason: 'QUOTE_INPUT_INVALID' }
  if (!positiveMoney(quote.monthlyPremium, 100_000_000)) return { ok: false, reason: 'QUOTE_INPUT_INVALID' }

  if (!(await illustrationsModuleEnabled(agentId))) {
    return { ok: false, reason: 'ILLUSTRATIONS_MODULE_DISABLED' }
  }

  const client = await prisma.client.findFirst({
    where: { id: signal.clientId, assignedAgentId: agentId },
    select: { id: true, name: true, dateOfBirth: true },
  })
  if (!client) return { ok: false, reason: 'CLIENT_NOT_IN_BOOK' }
  if (!client.dateOfBirth) return { ok: false, reason: 'CLIENT_DATE_OF_BIRTH_MISSING' }
  const nameParts = client.name.trim().split(/\s+/)
  if (nameParts.length < 2) return { ok: false, reason: 'CLIENT_NAME_INCOMPLETE' }
  const firstName = nameParts[0]
  const lastName = nameParts.slice(1).join(' ')
  const dateOfBirth = client.dateOfBirth

  // Claim the client-and-product slot before anything is dispatched. Two
  // signals from the same conversation — the client says it twice, or a
  // detector fires on two messages — must cost one carrier run, not two.
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kbot-illustration:${agentId}`}, 0))::text AS lock_result`
    const inFlight = await tx.kBotIllustrationRequest.findFirst({
      where: {
        agentId,
        clientId: client.id,
        productKey: quote.productKey,
        OR: [
          // A generation that outlived the connector command's own expiry is
          // not in flight any more; it is stale, and it must not block the
          // agent from asking again.
          { status: GENERATING, createdAt: { gte: new Date(now.getTime() - GENERATION_WINDOW_MS) } },
          {
            status: { in: [AWAITING_APPROVAL, APPROVED, DELIVERING] },
            createdAt: { gte: new Date(now.getTime() - APPROVAL_WINDOW_MS) },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, illustrationId: true },
    })
    if (inFlight) return { existing: inFlight }
    const created = await tx.kBotIllustrationRequest.create({
      data: {
        agentId,
        clientId: client.id,
        productKey: quote.productKey,
        status: GENERATING,
        signal: {
          conversationId: signal.conversationId,
          detectedBy: signal.detectedBy,
          excerpt: signal.excerpt ?? null,
          confidence: signal.confidence ?? null,
          detectedAt: (signal.detectedAt ?? now).toISOString(),
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    return { created }
  })
  if ('existing' in claim && claim.existing) {
    return { ok: false, reason: 'ALREADY_IN_FLIGHT', requestId: claim.existing.id }
  }
  const requestId = claim.created!.id

  const illustrationId = `ill_${randomUUID()}`
  const rawPayload = {
    foresightDraft: {
      schemaVersion: 1,
      firstName,
      lastName,
      dateOfBirth: dateOfBirth.toISOString().slice(0, 10),
      issueState: quote.issueState,
      gender: quote.gender,
      rateClass: quote.rateClass,
      faceAmount: quote.faceAmount,
      monthlyPremium: quote.monthlyPremium,
      deathBenefitOption: quote.deathBenefitOption,
      strategy: CAP_FOCUS,
    },
  } as Prisma.InputJsonValue

  try {
    const issued = await dispatchForesightIllustration({
      agentId,
      userId,
      draft: {
        illustrationId,
        clientId: client.id,
        productName: product.carrierName,
        faceAmount: quote.faceAmount,
        targetPremium: quote.monthlyPremium,
        targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
        insuredName: `${firstName} ${lastName}`,
        insuredDateOfBirth: dateOfBirth,
        rawPayload,
      },
      inputHash: (source) => foresightIllustrationInputHash(buildForesightIllustrationSnapshot(source)),
      now,
    })
    if (issued.reusedActiveCommand) {
      // The connector is already running an illustration for this agent. The
      // existing guard handed that run back rather than starting a second one,
      // and it belongs to another request — so this one is closed, not wired to
      // someone else's numbers.
      await failRequest(requestId, agentId, 'CARRIER_RUN_IN_PROGRESS')
      return { ok: false, reason: 'CARRIER_RUN_IN_PROGRESS', requestId }
    }
    await prisma.kBotIllustrationRequest.updateMany({
      where: { id: requestId, agentId, status: GENERATING },
      data: { illustrationId: issued.illustrationId, commandId: issued.command.commandId },
    })
    return { ok: true, requestId, illustrationId: issued.illustrationId, commandId: issued.command.commandId }
  } catch (error) {
    console.error('KBOT_ILLUSTRATION_DISPATCH_FAILED', {
      errorName: error instanceof Error ? error.name : typeof error,
    })
    await failRequest(requestId, agentId, 'DISPATCH_FAILED')
    return { ok: false, reason: 'DISPATCH_FAILED', requestId }
  }
}

async function failRequest(requestId: string, agentId: string, safeErrorCode: string): Promise<void> {
  await prisma.kBotIllustrationRequest.updateMany({
    where: { id: requestId, agentId, status: GENERATING },
    data: { status: FAILED, safeErrorCode, closedAt: new Date() },
  })
}
