'use server'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getDownlineIds } from '@/lib/hierarchy'
import { revalidatePath } from 'next/cache'
import { getServerI18n } from '@/lib/i18n/server'

export type UpdateHierarchyResult = { ok: true } | { ok: false; message: string }

export async function updateAgentHierarchy(formData: FormData): Promise<UpdateHierarchyResult> {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()

  const agentId = formData.get('agentId') as string
  const parentAgentId = (formData.get('parentAgentId') as string) || null
  const rank = formData.get('rank') as string

  if (parentAgentId) {
    if (parentAgentId === agentId) {
      return { ok: false, message: copy('Um agente não pode reportar para si mesmo.', 'An agent cannot report to themselves.') }
    }
    const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
    const downlineIds = getDownlineIds(allAgents, agentId)
    if (downlineIds.includes(parentAgentId)) {
      return {
        ok: false,
        message: copy(
          'Não é possível definir um descendente deste agente como seu superior (criaria um ciclo).',
          'A descendant of this agent cannot be assigned as their manager because that would create a cycle.',
        ),
      }
    }
  }

  const before = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
  const after = await prisma.agent.update({
    where: { id: agentId },
    data: { parentAgentId, rank },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'UPDATE_AGENT_HIERARCHY',
      entity: 'Agent',
      entityId: agentId,
      before: { parentAgentId: before.parentAgentId, rank: before.rank },
      after: { parentAgentId: after.parentAgentId, rank: after.rank },
    },
  })

  revalidatePath('/admin/agents')
  return { ok: true }
}
