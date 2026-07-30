import { describe, expect, it, vi } from 'vitest'
import { saveRapidSolveIllustration } from './illustration-service'

function createWriter() {
  // Typed argument so the assertions below can read what was written.
  const upsert = vi.fn(async (_args: unknown) => ({ id: 'illustration-1' }))
  return { writer: { illustration: { upsert } } as never, upsert }
}

const input = {
  agentId: 'agent-1',
  jobId: 'job-1',
  insuredName: 'Ana Souza',
  insuredDateOfBirth: '03/10/1986',
  productCode: '956',
  quote: {
    ok: true as const,
    faceAmount: 250_000,
    annualPremium: 3_748.8,
    monthlyPremium: 312.4,
    lapseYear: null,
  },
  request: { Amount: 250_000 },
}

describe('saveRapidSolveIllustration', () => {
  it('keeps the carrier answer and the question that produced it', async () => {
    const { writer, upsert } = createWriter()

    await expect(saveRapidSolveIllustration(input, writer)).resolves.toEqual({
      illustrationId: 'illustration-1',
    })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          agentId: 'agent-1',
          clientId: null,
          kind: 'PRELIMINARY',
          externalId: 'job-1',
          faceAmount: 250_000,
          premium: 312.4,
          insuredName: 'Ana Souza',
          rawPayload: { request: { Amount: 250_000 }, response: input.quote },
        }),
      }),
    )
  })

  it('stores the monthly premium, which is the mode the carrier quotes in', async () => {
    const { writer, upsert } = createWriter()
    await saveRapidSolveIllustration(input, writer)

    const call = upsert.mock.calls[0][0] as { create: { premium: number } }
    expect(call.create.premium).toBe(312.4)
    expect(call.create.premium).not.toBe(3_748.8)
  })

  it('reads the date of birth out of the carrier format', async () => {
    const { writer, upsert } = createWriter()
    await saveRapidSolveIllustration(input, writer)

    const call = upsert.mock.calls[0][0] as { create: { insuredDateOfBirth: Date } }
    expect(call.create.insuredDateOfBirth.toISOString()).toBe('1986-03-10T00:00:00.000Z')
  })

  // A worker that retries after a crash must not leave two rows for one quote.
  it('keys on the job so a retry updates rather than duplicates', async () => {
    const { writer, upsert } = createWriter()
    await saveRapidSolveIllustration(input, writer)

    const call = upsert.mock.calls[0][0] as {
      where: { provider_externalId: { externalId: string } }
    }
    expect(call.where.provider_externalId.externalId).toBe('job-1')
  })

  it('links to a client when the quote was for one', async () => {
    const { writer, upsert } = createWriter()
    await saveRapidSolveIllustration({ ...input, clientId: 'client-9' }, writer)

    const call = upsert.mock.calls[0][0] as { create: { clientId: string | null } }
    expect(call.create.clientId).toBe('client-9')
  })
})
