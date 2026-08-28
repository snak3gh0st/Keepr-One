export const FORESIGHT_PROGRESS_PHASES = [
  'OPENING_FORESIGHT',
  'OPENING_CASE',
  'FILLING_CLIENT',
  'CONFIGURING_PRODUCT',
  'CALCULATING',
  'VERIFYING_VALUES',
  'SAVING_CASE',
  'GENERATING_PDF',
  'UPLOADING_PDF',
  'COMPLETED',
] as const

export type ForesightProgressPhase = (typeof FORESIGHT_PROGRESS_PHASES)[number]

export function parseForesightProgressPhase(value: unknown): ForesightProgressPhase | null {
  return typeof value === 'string' && (FORESIGHT_PROGRESS_PHASES as readonly string[]).includes(value)
    ? value as ForesightProgressPhase
    : null
}
