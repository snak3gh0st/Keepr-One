import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  ApplicationDossierRepository,
  ApplicationDossierReviewRepository,
} from './dossier-service'

export const prismaApplicationDossierRepository: ApplicationDossierRepository &
ApplicationDossierReviewRepository = {
  async update(input) {
    const result = await prisma.application.updateMany({
      where: {
        id: input.applicationId,
        insuranceCase: { assignedAgentId: input.agentId },
      },
      data: {
        intakeVersion: input.intakeVersion,
        dossier: input.dossier as Prisma.InputJsonValue,
        automationState: input.automationState,
        reviewedAt: input.reviewedAt,
        reviewedByUserId: input.reviewedByUserId,
        consentedAt: input.consentedAt,
        dossierHash: input.dossierHash,
        safeErrorCode: null,
      },
    })
    if (result.count !== 1) throw new Error('APPLICATION_NOT_FOUND')
  },

  async findOwned(input) {
    return prisma.application.findFirst({
      where: {
        id: input.applicationId,
        insuranceCase: { assignedAgentId: input.agentId },
      },
      select: { id: true, dossier: true },
    })
  },

  async updateReview(input) {
    const result = await prisma.application.updateMany({
      where: {
        id: input.applicationId,
        insuranceCase: { assignedAgentId: input.agentId },
      },
      data: {
        automationState: input.automationState,
        dossierHash: input.dossierHash,
        reviewedAt: input.reviewedAt,
        reviewedByUserId: input.reviewedByUserId,
        consentedAt: input.consentedAt,
        safeErrorCode: null,
      },
    })
    if (result.count !== 1) throw new Error('APPLICATION_NOT_FOUND')
  },
}
