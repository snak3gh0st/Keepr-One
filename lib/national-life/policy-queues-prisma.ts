import type { PrismaClient } from '@prisma/client'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
import { classifyNationalPolicyQueues, type NationalPolicyQueueKey } from './policy-queues'

function verifyStage(input: { expectedRecordCount: number; receivedRecordCount: number; finalSequence: number;
  truncated: boolean; run: { rawGridPages: { sequence: number; recordCount: number; observedAt: Date }[] } }) {
  const pages = [...input.run.rawGridPages].sort((a, b) => a.sequence - b.sequence)
  if (input.truncated || input.expectedRecordCount !== input.receivedRecordCount
    || pages.length !== input.finalSequence + 1
    || pages.some((page, index) => page.sequence !== index)
    || pages.reduce((sum, page) => sum + page.recordCount, 0) !== input.receivedRecordCount) {
    throw new Error('NATIONAL_NEW_BUSINESS_SNAPSHOT_INCOMPLETE')
  }
  return pages.length ? new Date(Math.min(...pages.map((page) => page.observedAt.getTime()))) : null
}

export async function loadNationalPolicyQueues(prisma: PrismaClient, agentIds: string[]) {
  const partitions = await Promise.all(agentIds.map(async (agentId) => {
    const completion = await prisma.nationalLifeConnectorStageCompletion.findFirst({
      where: { gridKey: 'NEW_BUSINESS', truncated: false,
        run: { agentId, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } },
      orderBy: { completedAt: 'desc' },
      select: { expectedRecordCount: true, receivedRecordCount: true, finalSequence: true, truncated: true,
        run: { select: { rawGridPages: { where: { gridKey: 'NEW_BUSINESS' },
          select: { sequence: true, recordCount: true, observedAt: true } } } } },
    })
    if (!completion) return { verified: false, rows: [] }
    const boundary = verifyStage(completion)
    if (!boundary) return { verified: true, rows: [] }
    const rows = await prisma.nationalLifeCaseSnapshot.findMany({
      where: { agentId, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        gridKey: 'NEW_BUSINESS', fetchedAt: { gte: boundary } },
      select: { policyNo: true, insuredName: true, product: true, carrierStatus: true,
        deliveryStatus: true, submitDate: true },
      orderBy: { policyNo: 'asc' },
    })
    return { verified: true, rows }
  }))
  const rows = partitions.flatMap((partition) => partition.rows)
  const queues = classifyNationalPolicyQueues(rows)
  return {
    verified: partitions.length > 0 && partitions.every((partition) => partition.verified),
    queues,
    counts: Object.fromEntries(Object.entries(queues).map(([key, value]) => [key, value.length])) as Record<NationalPolicyQueueKey, number>,
  }
}
