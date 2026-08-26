import type { NationalLifePolicyDetail } from './policy-detail'

export const NATIONAL_LIFE_POLICY_DETAIL_SOURCE = 'NATIONAL_LIFE_POLICY_DETAIL' as const

export type PolicyDetailPromotionPatch = {
  faceAmount?: string
  faceAmountSource?: typeof NATIONAL_LIFE_POLICY_DETAIL_SOURCE
  carrierDetailUpdatedAt: Date
}

export type PersistPolicyDetailInput = {
  agentId: string
  deploymentScope: string
  policyId: string
  detail: NationalLifePolicyDetail
}

export type PolicyDetailRepository = {
  findOwnedPolicy(input: {
    agentId: string
    policyId: string
  }): Promise<{ id: string; policyNumber: string } | null>
  persist(input: PersistPolicyDetailInput & {
    policyPatch: PolicyDetailPromotionPatch
  }): Promise<void>
}

function policyNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function promotionPatch(detail: NationalLifePolicyDetail): PolicyDetailPromotionPatch {
  const patch: PolicyDetailPromotionPatch = {
    carrierDetailUpdatedAt: detail.observedAt,
  }
  if (detail.coverageCaptured && detail.totalFaceAmount !== null) {
    patch.faceAmount = detail.totalFaceAmount
    patch.faceAmountSource = NATIONAL_LIFE_POLICY_DETAIL_SOURCE
  }
  return patch
}

export async function persistNationalLifePolicyDetail(
  repository: PolicyDetailRepository,
  input: PersistPolicyDetailInput,
): Promise<void> {
  const owned = await repository.findOwnedPolicy({
    agentId: input.agentId,
    policyId: input.policyId,
  })
  if (!owned) throw new Error('POLICY_DETAIL_NOT_FOUND')
  if (policyNumber(owned.policyNumber) !== policyNumber(input.detail.policyNumber)) {
    throw new Error('POLICY_DETAIL_TARGET_MISMATCH')
  }

  await repository.persist({
    ...input,
    policyPatch: promotionPatch(input.detail),
  })
}
