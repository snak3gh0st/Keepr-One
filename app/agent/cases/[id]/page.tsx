export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessCase } from '@/lib/case-access'
import { decimalToNumber } from '@/lib/decimal'
import { formatMoney } from '@/lib/format'
import { Shell } from '@/components/Shell'
import { CaseWorkspace } from './CaseWorkspace'
import { getPipelineForAgent } from '@/lib/crm'
import { getCalendarConnectionForUser, getCalendarEventsForCase } from '@/lib/calendar'
import { mapDomainCalendarConnectionToUi, mapDomainCalendarEventToUi } from '@/components/calendar/server-adapter'

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId }, select: { name: true, timeZone: true } })
  const scope = await getAgentScopeIds(agent.id)

  const c = await prisma.insuranceCase.findUnique({
    where: { id },
    include: {
      prospect: true,
      assignedAgent: { select: { userId: true, user: { select: { name: true } } } },
      illustrations: { orderBy: { createdAt: 'desc' } },
      applications: { include: { requirements: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } },
      timelineEvents: { orderBy: { createdAt: 'desc' } },
      followUps: { orderBy: { createdAt: 'desc' } },
      crmStage: { select: { id: true, name: true, systemKey: true } },
      policies: true,
    },
  })

  if (!c || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, c)) notFound()
  const pipeline = await getPipelineForAgent(c.assignedAgentId)
  const ownsCase = c.assignedAgentId === agent.id
  let calendarConnectionDomain = null
  let calendarEventDomains: Awaited<ReturnType<typeof getCalendarEventsForCase>> = []
  // CRM hierarchy grants access to the lead, never to another agent's private
  // calendar. Only the assigned agent can load provider/account metadata or
  // event details; leaders receive the neutral read-only placeholder below.
  if (ownsCase) {
    try {
      ;[calendarConnectionDomain, calendarEventDomains] = await Promise.all([
        getCalendarConnectionForUser(agent.userId),
        getCalendarEventsForCase({ ownerUserId: agent.userId, caseId: c.id }),
      ])
    } catch (error) {
      console.error('Case calendar query error', error)
    }
  }
  const mappedCalendar = mapDomainCalendarConnectionToUi(calendarConnectionDomain)
  const calendarById = new Map(mappedCalendar.calendars.map((calendar) => [calendar.id, calendar]))
  const calendarCase = {
    id: c.id,
    name: `${c.prospect.firstName} ${c.prospect.lastName}`.trim(),
    email: c.prospect.email,
    stage: c.crmStage?.name ?? null,
  }

  const money = (v: unknown) => (v != null ? formatMoney(decimalToNumber(v)) : null)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <CaseWorkspace
        caseData={{
          id: c.id,
          now: new Date().toISOString(),
          crmStage: c.crmStage,
          crmStages: pipeline.stages,
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
          followUps: c.followUps.map((followUp) => ({
            id: followUp.id,
            title: followUp.title,
            scheduledAt: followUp.scheduledAt.toISOString(),
            status: followUp.status,
            completedAt: followUp.completedAt?.toISOString() ?? null,
            cancelledAt: followUp.cancelledAt?.toISOString() ?? null,
          })),
          calendar: {
            canManage: ownsCase,
            connection: mappedCalendar.connection,
            calendars: mappedCalendar.calendars,
            timeZone: user?.timeZone ?? 'America/New_York',
            events: calendarEventDomains.map((event) => mapDomainCalendarEventToUi(event, {
              timeZone: event.timeZone ?? 'America/New_York',
              case: calendarCase,
              canWrite: ownsCase && (calendarById.get(event.calendar.id)?.canWrite ?? false),
            })),
          },
        }}
      />
    </Shell>
  )
}
