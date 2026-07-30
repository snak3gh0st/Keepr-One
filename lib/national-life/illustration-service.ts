/// Keeps a quote after the screen that asked for it is gone.
///
/// Until this existed the carrier's answer lived only in the job row's result
/// and was never read again: an agent could quote a client, close the tab, and
/// have nothing to show for a request already made against the carrier.
import type { Prisma, PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import type { RapidSolveQuote } from './rapid-solve'

export type SaveRapidSolveIllustrationInput = {
  agentId: string
  clientId?: string | null
  jobId: string
  insuredName: string
  /// Carrier format, MM/DD/YYYY, as it crossed the queue.
  insuredDateOfBirth: string
  productCode: string
  quote: RapidSolveQuote
  request: unknown
}

type IllustrationWriter = Pick<PrismaClient, 'illustration'>

function parseCarrierDate(value: string): Date | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const [, month, day, year] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

/// Written only for a quote the carrier actually priced.
///
/// A refusal is a real answer and the job records it, but it is not an
/// illustration: there is no premium and no face amount to keep, and a row of
/// zeros would read like a quote of zero.
export async function saveRapidSolveIllustration(
  input: SaveRapidSolveIllustrationInput,
  client: IllustrationWriter,
): Promise<{ illustrationId: string }> {
  const illustration = await client.illustration.upsert({
    // The job id, so a worker that retries after a crash updates the quote it
    // already wrote instead of leaving two.
    where: {
      provider_externalId: {
        provider: NATIONAL_LIFE_PROVIDER,
        externalId: input.jobId,
      },
    },
    create: {
      agentId: input.agentId,
      clientId: input.clientId ?? null,
      // Nothing here has been submitted to underwriting.
      kind: 'PRELIMINARY',
      provider: NATIONAL_LIFE_PROVIDER,
      externalId: input.jobId,
      productName: input.productCode,
      faceAmount: input.quote.faceAmount,
      // The carrier quotes monthly, which is what `PremiumMode` asks for.
      premium: input.quote.monthlyPremium,
      insuredName: input.insuredName,
      insuredDateOfBirth: parseCarrierDate(input.insuredDateOfBirth),
      // Both sides of the exchange, so a number on screen can always be traced
      // to the question that produced it.
      rawPayload: {
        request: input.request,
        response: input.quote,
      } as Prisma.InputJsonValue,
    },
    update: {
      faceAmount: input.quote.faceAmount,
      premium: input.quote.monthlyPremium,
      rawPayload: {
        request: input.request,
        response: input.quote,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  })

  return { illustrationId: illustration.id }
}
