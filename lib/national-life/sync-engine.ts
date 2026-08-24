import { NATIONAL_LIFE_PROVIDER } from './constants'

/**
 * The only supported engine for the National Life book-of-business sync.
 *
 * Keepr One owns the plan, checkpoints, validation and persistence. KeeproneConnect
 * is the authenticated boundary that drives the agent's National Life browser and
 * returns raw, signed batches. Keeping this contract in one small, dependency-free
 * module prevents a UI or worker from silently selecting the retired remote path.
 */
export const NATIONAL_LIFE_SYNC_ENGINE = 'KEEPRONE_CONNECT' as const

export const CANONICAL_NATIONAL_LIFE_SYNC = {
  provider: NATIONAL_LIFE_PROVIDER,
  deploymentScope: 'LOCAL_CONNECTOR',
  executionSource: 'LOCAL',
} as const

export const NATIONAL_LIFE_SYNC_PIPELINE = [
  'KEEPRONE_SYNC',
  'KEEPRONE_CONNECT_REQUEST',
  'NATIONAL_LIFE_BROWSER',
  'KEEPRONE_CONNECT_RECEIPT',
  'KEEPRONE_VALIDATE_DEDUPLICATE',
  'KEEPRONE_DATABASE',
  'KEEPRONE_APP_RENDER',
] as const

export type NationalLifeSyncPipelineStage = (typeof NATIONAL_LIFE_SYNC_PIPELINE)[number]

export function isCanonicalNationalLifeSync(input: {
  provider?: string | null
  deploymentScope?: string | null
  executionSource?: string | null
}): boolean {
  return (
    input.provider === CANONICAL_NATIONAL_LIFE_SYNC.provider &&
    input.deploymentScope === CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope &&
    input.executionSource === CANONICAL_NATIONAL_LIFE_SYNC.executionSource
  )
}
