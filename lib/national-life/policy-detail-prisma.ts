import type { Prisma, PrismaClient } from '@prisma/client'
import type { PolicyDetailRepository } from './policy-detail-service'

type PolicyDetailTransaction = Pick<
  Prisma.TransactionClient,
  'nationalLifePolicyDetailSnapshot' | 'policy'
>

type PolicyDetailDatabase = Pick<PrismaClient, 'policy'> & {
  $transaction<T>(operation: (transaction: PolicyDetailTransaction) => Promise<T>): Promise<T>
}

function snapshotData(input: Parameters<PolicyDetailRepository['persist']>[0]) {
  return {
    agentId: input.agentId,
    deploymentScope: input.deploymentScope,
    policyId: input.policyId,
    policyNumber: input.detail.policyNumber,
    sourcePath: input.detail.sourcePath,
    observedAt: input.detail.observedAt,
    coverageCaptured: input.detail.coverageCaptured,
    paymentsCaptured: input.detail.paymentsCaptured,
    totalFaceAmount: input.detail.totalFaceAmount,
    netDeathBenefit: input.detail.netDeathBenefit,
    nextScheduledPaymentDate: input.detail.nextScheduledPaymentDate,
    paymentFrequency: input.detail.paymentFrequency,
    plannedPeriodicPayment: input.detail.plannedPeriodicPayment,
    anticipatedAnnualPremium: input.detail.anticipatedAnnualPremium,
    minimumMonthlyPremium: input.detail.minimumMonthlyPremium,
    minimumGuaranteedPremium: input.detail.minimumGuaranteedPremium,
    ctp: input.detail.ctp,
    mecLimit: input.detail.mecLimit,
    mecLimitThrough: input.detail.mecLimitThrough,
    guidelinePremiumLimit: input.detail.guidelinePremiumLimit,
    guidelinePremiumLimitThrough: input.detail.guidelinePremiumLimitThrough,
    // Deliberate: no DOM, HTML or page-wide payload is persisted.
    raw: undefined,
  }
}

export function createPrismaPolicyDetailRepository(
  database: PolicyDetailDatabase,
): PolicyDetailRepository {
  return {
    async findOwnedPolicy(input) {
      return database.policy.findFirst({
        where: { id: input.policyId, agentId: input.agentId },
        select: { id: true, policyNumber: true },
      })
    },

    async persist(input) {
      await database.$transaction(async (transaction) => {
        const existing = await transaction.nationalLifePolicyDetailSnapshot.findUnique({
          where: { policyId: input.policyId },
          select: { observedAt: true },
        })
        if (existing && existing.observedAt > input.detail.observedAt) return

        const data = snapshotData(input)
        await transaction.nationalLifePolicyDetailSnapshot.upsert({
          where: { policyId: input.policyId },
          create: data,
          update: data,
        })
        const updated = await transaction.policy.updateMany({
          where: { id: input.policyId, agentId: input.agentId },
          data: input.policyPatch,
        })
        if (updated.count !== 1) throw new Error('POLICY_DETAIL_NOT_FOUND')
      })
    },
  }
}
