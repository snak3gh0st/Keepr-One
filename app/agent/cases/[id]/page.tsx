export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { canAccessCase } from '@/lib/case-access'
import { allowedTransitions } from '@/lib/case-workflow'
import { decimalToNumber } from '@/lib/decimal'
import { formatMoney } from '@/lib/format'
import { Shell } from '@/components/Shell'
import { CaseWorkspace } from './CaseWorkspace'

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  const scope = [agent.id, ...getDownlineIds(allAgents, agent.id)]

  const c = await prisma.insuranceCase.findUnique({
    where: { id },
    include: {
      prospect: true,
      assignedAgent: { select: { user: { select: { name: true } } } },
      illustrations: { orderBy: { createdAt: 'desc' } },
      applications: { include: { requirements: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } },
      timelineEvents: { orderBy: { createdAt: 'desc' } },
      policies: true,
    },
  })

  if (!c || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, c)) notFound()

  const money = (v: unknown) => (v != null ? formatMoney(decimalToNumber(v)) : null)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <CaseWorkspace
        caseData={{
          id: c.id,
          stage: c.stage,
          status: c.status,
          objective: c.objective,
          productType: c.productType,
          carrier: c.carrier,
          targetCoverage: money(c.targetCoverage),
          monthlyBudget: money(c.monthlyBudget),
          needsAnalysis: c.needsAnalysis as {
            input: Record<string, number>
            result: { grossNeed: number; resources: number; recommendedCoverage: number }
            savedAt: string
          } | null,
          nextStages: allowedTransitions(c.stage),
          prospect: {
            name: `${c.prospect.firstName} ${c.prospect.lastName}`.trim(),
            email: c.prospect.email,
            phone: c.prospect.phone,
            state: c.prospect.state,
            tobaccoStatus: c.prospect.tobaccoStatus,
            dateOfBirth: c.prospect.dateOfBirth ? c.prospect.dateOfBirth.toISOString() : null,
          },
          agentName: c.assignedAgent.user?.name ?? '—',
          illustrations: c.illustrations.map((il) => ({
            id: il.id,
            kind: il.kind,
            productName: il.productName,
            faceAmount: money(il.faceAmount),
            premium: money(il.premium),
          })),
          applications: c.applications.map((app) => ({
            id: app.id,
            status: app.status,
            requirements: app.requirements.map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
            })),
          })),
          policies: c.policies.map((p) => ({
            id: p.id,
            policyNumber: p.policyNumber,
            carrier: p.carrier,
            product: p.product,
            status: p.status,
          })),
          timeline: c.timelineEvents.map((t) => ({
            id: t.id,
            type: t.type,
            title: t.title,
            body: t.body,
            createdAt: t.createdAt.toISOString(),
            dueAt: t.dueAt ? t.dueAt.toISOString() : null,
            doneAt: t.doneAt ? t.doneAt.toISOString() : null,
          })),
        }}
      />
    </Shell>
  )
}
