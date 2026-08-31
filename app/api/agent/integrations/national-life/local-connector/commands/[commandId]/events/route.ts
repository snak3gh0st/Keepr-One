import { z } from 'zod'
import {
  ConnectorCommandError,
} from '@/lib/national-life/connector-command-service'
import { parseConnectorCommandEvent } from '@/lib/national-life/connector-command-contract'
import {
  prismaLocalConnectorCommandDispatchRepository,
} from '@/lib/national-life/local-connector/command-dispatch-prisma'
import {
  recordDeviceConnectorCommandEvent,
} from '@/lib/national-life/local-connector/command-dispatch-service'
import {
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
  isNationalLifeLocalConnectorEnabled,
  localConnectorUnavailableResponse,
} from '@/lib/national-life/local-connector/config'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'
import { prisma } from '@/lib/prisma'
import { createPrismaPolicyDetailRepository } from '@/lib/national-life/policy-detail-prisma'
import { createFlexLifeQuoteResultRepository } from '@/lib/national-life/flexlife-quote-result'
import { extractForesightTermPremiums } from '@/lib/national-life/foresight-term-pdf'
import type { IgoApplicationDraftReceipt } from '@/lib/application-addon/igo-receipt'
import { createHash } from 'node:crypto'

const MAX_BODY_BYTES = 64 * 1024
const NO_STORE = { 'Cache-Control': 'no-store' }
const paramsSchema = z.strictObject({
  commandId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
})
const policyDetailRepository = createPrismaPolicyDetailRepository(prisma)
const flexLifeQuoteRepository = createFlexLifeQuoteResultRepository(prisma)
const foresightArtifactRepository = {
  async findOwnedArtifact(input: { agentId: string; illustrationId: string }) {
    return prisma.illustration.findFirst({
      where: { id: input.illustrationId, agentId: input.agentId },
      select: {
        provider: true, externalId: true, productName: true, documentBytes: true, documentMimeType: true,
      },
    })
  },
  async persistSolvedResult(input: {
    agentId: string
    illustrationId: string
    solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
    faceAmount: number
    monthlyPremium: number
    annualPremium: number
  }) {
    const existing = await prisma.illustration.findFirst({
      where: { id: input.illustrationId, agentId: input.agentId, productName: 'FlexLife' },
      select: { rawPayload: true, targetPremium: true, faceAmount: true },
    })
    if (!existing) throw new ConnectorCommandError('EVENT_INVALID')
    const rawPayload = existing.rawPayload && typeof existing.rawPayload === 'object' &&
      !Array.isArray(existing.rawPayload) ? existing.rawPayload : {}
    const requestedAmount = input.solveBasis === 'PREMIUM'
      ? Number(existing.targetPremium)
      : Number(existing.faceAmount)
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    const updated = await prisma.illustration.updateMany({
      where: { id: input.illustrationId, agentId: input.agentId, productName: 'FlexLife' },
      data: {
        faceAmount: input.faceAmount,
        premium: input.monthlyPremium,
        rawPayload: {
          ...rawPayload,
          foresightResult: {
            solveBasis: input.solveBasis,
            requestedAmount,
            confirmedFaceAmount: input.faceAmount,
            confirmedMonthlyPremium: input.monthlyPremium,
            confirmedAnnualPremium: input.annualPremium,
          },
        },
        ...(input.solveBasis === 'DEATH_BENEFIT'
          ? {
              targetPremium: input.monthlyPremium,
              targetPremiumSource: 'FORESIGHT_CALCULATED_FROM_DEATH_BENEFIT',
            }
          : {}),
      },
    })
    if (updated.count !== 1) throw new ConnectorCommandError('EVENT_INVALID')
  },
  async persistTermResult(input: {
    agentId: string
    illustrationId: string
    monthlyPremium: number
    annualPremium: number
  }) {
    const existing = await prisma.illustration.findFirst({
      where: {
        id: input.illustrationId,
        agentId: input.agentId,
        productName: { in: ['NL Term', 'LSW Term'] },
      },
      select: { rawPayload: true, faceAmount: true },
    })
    const faceAmount = Number(existing?.faceAmount)
    if (!existing || !Number.isFinite(faceAmount) || faceAmount <= 0) {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    const rawPayload = existing.rawPayload && typeof existing.rawPayload === 'object' &&
      !Array.isArray(existing.rawPayload) ? existing.rawPayload : {}
    const updated = await prisma.illustration.updateMany({
      where: {
        id: input.illustrationId,
        agentId: input.agentId,
        productName: { in: ['NL Term', 'LSW Term'] },
      },
      data: {
        premium: input.monthlyPremium,
        targetPremium: input.monthlyPremium,
        targetPremiumSource: 'CARRIER_CALCULATED_FOR_TERM',
        rawPayload: {
          ...rawPayload,
          foresightTermResult: {
            source: 'OFFICIAL_PDF',
            premiumMode: 'Monthly',
            confirmedFaceAmount: faceAmount,
            confirmedMonthlyPremium: input.monthlyPremium,
            confirmedAnnualPremium: input.annualPremium,
          },
        },
      },
    })
    if (updated.count !== 1) throw new ConnectorCommandError('EVENT_INVALID')
  },
}
const applicationDraftReceiptRepository = {
  async persistOwnedDraftReceipt(input: {
    agentId: string
    applicationId: string
    receipt: IgoApplicationDraftReceipt
  }) {
    await prisma.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: {
          id: input.applicationId,
          insuranceCase: { assignedAgentId: input.agentId },
        },
        select: { id: true, dossierHash: true, automationState: true },
      })
      if (!application || application.dossierHash !== input.receipt.payloadHash ||
        application.automationState !== 'PREPARING_DRAFT') {
        throw new ConnectorCommandError('EVENT_INVALID')
      }
      await tx.application.update({
        where: { id: application.id },
        data: {
          provider: 'IPIPELINE_IGO',
          externalId: input.receipt.externalApplicationId,
          carrierReceipt: input.receipt,
          automationState: input.receipt.missingQuestions.length
            ? 'NEEDS_INFORMATION'
            : 'DRAFT_READY',
          safeErrorCode: null,
          sourceUpdatedAt: new Date(),
        },
      })
      for (const question of input.receipt.missingQuestions) {
        const externalId = createHash('sha256')
          .update(`${input.receipt.externalApplicationId}:${question.section}:${question.label}`)
          .digest('hex')
        await tx.applicationRequirement.upsert({
          where: { provider_externalId: { provider: 'IPIPELINE_IGO', externalId } },
          create: {
            applicationId: application.id,
            provider: 'IPIPELINE_IGO',
            externalId,
            title: question.label,
            description: question.allowedValues?.length
              ? `${question.section} · Opções: ${question.allowedValues.join(', ')}`
              : question.section,
            sourceUpdatedAt: new Date(),
          },
          update: {
            status: 'OPEN',
            title: question.label,
            description: question.allowedValues?.length
              ? `${question.section} · Opções: ${question.allowedValues.join(', ')}`
              : question.section,
            sourceUpdatedAt: new Date(),
          },
        })
      }
    })
  },
  async persistOwnedDraftFailure(input: {
    agentId: string
    applicationId: string
    safeErrorCode: string
  }) {
    const updated = await prisma.application.updateMany({
      where: {
        id: input.applicationId,
        insuranceCase: { assignedAgentId: input.agentId },
        automationState: 'PREPARING_DRAFT',
      },
      data: {
        automationState: 'FAILED',
        safeErrorCode: input.safeErrorCode.slice(0, 80),
      },
    })
    if (updated.count !== 1) throw new ConnectorCommandError('EVENT_INVALID')
  },
}

function commandErrorResponse(error: ConnectorCommandError): Response {
  const status = error.code === 'COMMAND_NOT_FOUND' ? 404
    : error.code === 'COMMAND_EXPIRED' ? 410
      : error.code === 'CONFIRMATION_REQUIRED' ? 409
        : 400
  return Response.json({ error: error.code }, { status, headers: NO_STORE })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  if (!isNationalLifeLocalConnectorEnabled()) return localConnectorUnavailableResponse()

  try {
    const body = await readLimitedBody(request, MAX_BODY_BYTES)
    const device = await verifyLocalConnectorDeviceRequest(prisma, {
      method: request.method,
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body,
    })
    const params = paramsSchema.parse(await context.params)
    const event = parseConnectorCommandEvent(parseJsonBody(body))
    if (!event || event.commandId !== params.commandId) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }

    await recordDeviceConnectorCommandEvent(
      prismaLocalConnectorCommandDispatchRepository,
      {
        ...device,
        commandId: params.commandId,
        event,
        now: new Date(),
        policyDetailRepository,
        foresightArtifactRepository,
        extractTermPremiums: extractForesightTermPremiums,
        flexLifeQuoteRepository,
        applicationDraftReceiptRepository,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      },
    )
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    if (error instanceof LocalConnectorSignatureError) {
      return Response.json(
        { error: 'DEVICE_REQUEST_REJECTED' },
        { status: 401, headers: { ...NO_STORE, 'x-fyntra-device-error': error.code } },
      )
    }
    if (error instanceof ConnectorCommandError) return commandErrorResponse(error)
    if (error instanceof LocalConnectorRequestError || error instanceof z.ZodError) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
    }
    return Response.json({ error: 'COMMAND_EVENT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
