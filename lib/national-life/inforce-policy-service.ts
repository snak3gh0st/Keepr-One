import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import {
  syncConfirmedInforcePromotionCreditsSafely,
  type PromotionCreditSyncResult,
} from './promotion-credit-sync'

export { toInforcePolicySnapshot, toInforcePolicySnapshots } from './inforce-policy-mapper'
export type { InforcePolicySnapshot } from './inforce-policy-mapper'
import type { InforcePolicySnapshot } from './inforce-policy-mapper'

export type PersistInforcePoliciesInput = {
  agentId: string
  deploymentScope: string
  snapshots: InforcePolicySnapshot[]
  fetchedAt: Date
}

/// One round trip per chunk instead of per row. Ten thousand policies as
/// individual awaited upserts took minutes, which is too slow to sit inside a
/// scheduled job.
const UPSERT_CHUNK_SIZE = 500

export async function persistInforcePolicies(
  input: PersistInforcePoliciesInput,
): Promise<{ written: number; promotionCredits?: PromotionCreditSyncResult }> {
  let written = 0

  for (let offset = 0; offset < input.snapshots.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = input.snapshots.slice(offset, offset + UPSERT_CHUNK_SIZE)

    await prisma.$transaction(
      chunk.map((snapshot) => {
        const { raw, policyNumber, ...rest } = snapshot
        const data = { ...rest, raw: raw as Prisma.InputJsonValue, fetchedAt: input.fetchedAt }

        return prisma.nationalLifeInforcePolicy.upsert({
          where: {
            agentId_deploymentScope_policyNumber: {
              agentId: input.agentId,
              deploymentScope: input.deploymentScope,
              policyNumber,
            },
          },
          create: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            policyNumber,
            ...data,
          },
          update: data,
        })
      }),
    )
    written += chunk.length
  }

  const promotionCredits = await syncConfirmedInforcePromotionCreditsSafely(input)

  return { written, promotionCredits }
}
