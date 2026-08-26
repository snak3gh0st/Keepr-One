import 'server-only'

import type { PrismaClient } from '@prisma/client'
import type { RapidSolveFailure, RapidSolveQuote } from './rapid-solve'

export type LocalFlexLifeQuoteStatus =
  | { state: 'PENDING' }
  | { state: 'AUTH_REQUIRED' }
  | { state: 'ANSWERED'; quote: RapidSolveQuote | RapidSolveFailure }
  | { state: 'UNAVAILABLE'; safeErrorCode: string }

type QuoteStatusDb = Pick<PrismaClient, 'nationalLifeConnectorCommand' | 'illustration'>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseStoredQuote(value: unknown): RapidSolveQuote | RapidSolveFailure | null {
  const result = record(value)
  if (!result || typeof result.ok !== 'boolean') return null
  if (result.ok === false) {
    return typeof result.message === 'string' && result.message.length > 0 && result.message.length <= 2_000
      ? { ok: false, message: result.message }
      : null
  }
  const lapseYear = result.lapseYear
  if (
    typeof result.faceAmount !== 'number' || !Number.isFinite(result.faceAmount) || result.faceAmount < 0 ||
    typeof result.annualPremium !== 'number' || !Number.isFinite(result.annualPremium) || result.annualPremium < 0 ||
    typeof result.monthlyPremium !== 'number' || !Number.isFinite(result.monthlyPremium) || result.monthlyPremium < 0 ||
    !(lapseYear === null || lapseYear === 'NEVER' ||
      (Number.isInteger(lapseYear) && (lapseYear as number) >= 1 && (lapseYear as number) <= 200))
  ) return null
  return {
    ok: true,
    faceAmount: result.faceAmount,
    annualPremium: result.annualPremium,
    monthlyPremium: result.monthlyPremium,
    lapseYear: lapseYear as number | 'NEVER' | null,
  }
}

export function createFlexLifeQuoteStatusRepository(db: QuoteStatusDb) {
  return {
    async getOwnedQuoteStatus(
      agentId: string,
      commandId: string,
    ): Promise<LocalFlexLifeQuoteStatus | null> {
      const command = await db.nationalLifeConnectorCommand.findFirst({
        where: { id: commandId, agentId, capability: 'FLEXLIFE_QUOTE' },
        select: { state: true, target: true, safeErrorCode: true },
      })
      if (!command) return null
      const target = record(command.target)
      if (target?.kind !== 'ILLUSTRATION' || typeof target.id !== 'string') {
        return { state: 'UNAVAILABLE', safeErrorCode: 'QUOTE_TARGET_INVALID' }
      }
      if (command.state === 'AUTH_REQUIRED') return { state: 'AUTH_REQUIRED' }
      if (['QUEUED', 'RUNNING', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)) {
        return { state: 'PENDING' }
      }
      if (command.state !== 'COMPLETED') {
        return { state: 'UNAVAILABLE', safeErrorCode: command.safeErrorCode ?? 'QUOTE_FAILED' }
      }
      const illustration = await db.illustration.findFirst({
        where: { id: target.id, agentId },
        select: { rawPayload: true },
      })
      const payload = record(illustration?.rawPayload)
      const quote = parseStoredQuote(payload?.response)
      return quote
        ? { state: 'ANSWERED', quote }
        : { state: 'UNAVAILABLE', safeErrorCode: 'QUOTE_RESULT_MISSING' }
    },
  }
}
