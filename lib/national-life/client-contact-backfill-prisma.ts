import type { PrismaClient } from '@prisma/client'
import { planClientContactBackfill, type ClientContactBackfillPlan } from './client-contact-backfill'
import { toClientServiceEvents } from './client-intelligence'
import { prismaIngestDeps } from './portfolio-ingest-prisma'

export type ClientContactBackfillReport = {
  planned: number
  clientsContactFilled: number
  skipped: ClientContactBackfillPlan['skipped']
}

const EMPTY_REPORT: ClientContactBackfillReport = {
  planned: 0,
  clientsContactFilled: 0,
  skipped: { unmatchedPolicy: 0, nameMismatch: 0, agentOwnPhone: 0 },
}

/**
 * Fills `Client.email` / `Client.phone` gaps from the stored client
 * intelligence grid.
 *
 * Every read is scoped to the agent, and the write goes through the portfolio
 * ingest's `updateClientContact`, which repeats the agent scope and the blank
 * check in the update predicate. There is deliberately no second writer: this
 * module is a new source for an existing sink.
 */
export async function backfillClientContactFromServiceLog(
  prisma: PrismaClient,
  input: { agentId: string },
): Promise<ClientContactBackfillReport> {
  const [rows, policies, clients, channels] = await Promise.all([
    // No deployment scope filter: the same grid arrives from the hosted and the
    // local connector, and a contact is a contact whichever read produced it.
    prisma.nationalLifeReportRow.findMany({
      where: { agentId: input.agentId, gridKey: 'CLIENT_INTELLIGENCE' },
      select: { id: true, raw: true },
    }),
    prisma.policy.findMany({
      where: { agentId: input.agentId, client: { assignedAgentId: input.agentId } },
      select: { policyNumber: true, clientId: true },
    }),
    prisma.client.findMany({
      where: { assignedAgentId: input.agentId },
      select: { id: true, name: true, email: true, phone: true },
    }),
    // The agent's own lines, to be recognised and discarded rather than saved
    // as a client's number.
    prisma.agentMessagingChannel.findMany({
      where: { agentId: input.agentId },
      select: { normalizedPhoneE164: true },
    }),
  ])
  if (rows.length === 0) return EMPTY_REPORT

  const plan = planClientContactBackfill({
    events: toClientServiceEvents(rows),
    policies,
    clients,
    agentPhones: channels.map((channel) => channel.normalizedPhoneE164),
  })

  const { updateClientContact } = prismaIngestDeps(prisma)
  let clientsContactFilled = 0
  for (const contact of plan.contacts) {
    // One refused row must not cost the rest of the book its contacts; the gap
    // simply survives to the next sync.
    try {
      const filled = await updateClientContact({
        agentId: input.agentId,
        clientId: contact.clientId,
        email: contact.email,
        phone: contact.phone,
      })
      // The sink reports whether a row actually changed: the plan was read
      // before this write and the agent may have filled the field meanwhile.
      if (filled) clientsContactFilled += 1
    } catch {
      // Intentionally swallowed: this is an enrichment pass, not the sync.
    }
  }

  return { planned: plan.contacts.length, clientsContactFilled, skipped: plan.skipped }
}

/**
 * Contact enrichment is never worth failing a finished sync over, so this
 * boundary converts any read or write failure into an empty report.
 */
export async function backfillClientContactFromServiceLogSafely(
  prisma: PrismaClient,
  input: { agentId: string },
): Promise<ClientContactBackfillReport> {
  try {
    return await backfillClientContactFromServiceLog(prisma, input)
  } catch {
    return EMPTY_REPORT
  }
}
