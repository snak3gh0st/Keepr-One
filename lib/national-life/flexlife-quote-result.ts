import type { Prisma, PrismaClient } from '@prisma/client'
import { buildFlexLifeQuoteSnapshot, flexLifeQuoteInputHash } from './flexlife-quote-contract'
import { saveRapidSolveIllustration } from './illustration-service'
import { parseRapidSolveResponse } from './rapid-solve'

type FlexLifeQuoteDb = Pick<PrismaClient, 'illustration'>

export function createFlexLifeQuoteResultRepository(db: FlexLifeQuoteDb) {
  return {
    async persistOwnedQuoteResult(input: {
      agentId: string
      illustrationId: string
      inputHash: string
      response: Record<string, unknown>
    }): Promise<void> {
      const illustration = await db.illustration.findFirst({
        where: { id: input.illustrationId, agentId: input.agentId },
        select: {
          id: true,
          agentId: true,
          clientId: true,
          insuredName: true,
          insuredDateOfBirth: true,
          rawPayload: true,
        },
      })
      if (!illustration) throw new Error('FLEXLIFE_QUOTE_NOT_FOUND')
      const snapshot = buildFlexLifeQuoteSnapshot(illustration)
      if (flexLifeQuoteInputHash(snapshot) !== input.inputHash) {
        throw new Error('FLEXLIFE_QUOTE_INPUT_MISMATCH')
      }
      const result = parseRapidSolveResponse(input.response)
      if (!result.ok) {
        const updated = await db.illustration.updateMany({
          where: { id: illustration.id, agentId: input.agentId },
          data: {
            rawPayload: {
              request: snapshot.request,
              response: result,
            } as Prisma.InputJsonValue,
          },
        })
        if (updated.count !== 1) throw new Error('FLEXLIFE_QUOTE_NOT_FOUND')
        return
      }
      await saveRapidSolveIllustration({
        agentId: input.agentId,
        clientId: illustration.clientId,
        jobId: illustration.id,
        insuredName: illustration.insuredName ??
          `${snapshot.request.FirstName} ${snapshot.request.LastName}`,
        insuredDateOfBirth: snapshot.request.DateOfBirth,
        productCode: snapshot.request.ProductCode,
        quote: result,
        request: snapshot.request,
      }, db)
    },
  }
}
