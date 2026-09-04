export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessCase } from '@/lib/case-access'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { CaseWorkspace } from './CaseWorkspace'
import { getPipelineForAgent } from '@/lib/crm'
import { getCalendarConnectionForUser, getCalendarEventsForCase } from '@/lib/calendar'
import { mapDomainCalendarConnectionToUi, mapDomainCalendarEventToUi } from '@/components/calendar/server-adapter'
import { getKBotApplicationEntitlement } from '@/lib/application-addon/entitlement-prisma'
import { getServerI18n } from '@/lib/i18n/server'

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { language } = await getServerI18n()
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
      applications: {
        include: {
          createdBy: { select: { name: true } },
          requirements: { orderBy: { createdAt: 'asc' } },
          documents: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      },
      timelineEvents: { orderBy: { createdAt: 'desc' } },
      followUps: { orderBy: { createdAt: 'desc' } },
      crmStage: { select: { id: true, name: true, systemKey: true } },
      policies: true,
    },
  })

  if (!c || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, c)) notFound()
  const pipeline = await getPipelineForAgent(c.assignedAgentId)
  const ownsCase = c.assignedAgentId === agent.id
  const applicationAddon = ownsCase
    ? await getKBotApplicationEntitlement(agent.id)
    : { entitled: false, subscriptionId: null, status: null }
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
    stageSystemKey: c.crmStage?.systemKey ?? null,
  }

  const money = (v: unknown) => (v != null ? new Intl.NumberFormat(language === 'PT' ? 'pt-BR' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(decimalToNumber(v)) ? 0 : 2,
  }).format(decimalToNumber(v)) : null)

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
            createdByName: app.createdBy?.name ?? null,
            status: app.status,
            automationState: app.automationState,
            dossier: app.dossier,
            dossierHash: app.dossierHash,
            reviewedAt: app.reviewedAt?.toISOString() ?? null,
            externalId: app.externalId,
            carrierReceipt: app.carrierReceipt,
            documents: app.documents.map((document) => ({
              id: document.id,
              type: document.type,
              filename: document.filename,
              reviewedAt: document.reviewedAt?.toISOString() ?? null,
            })),
            requirements: app.requirements.map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
            })),
          })),
          applicationAddon: {
            entitled: applicationAddon.entitled,
            status: applicationAddon.status,
            canAutomate: ownsCase && applicationAddon.entitled,
          },
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
              timeZone: user?.timeZone ?? 'America/New_York',
              case: calendarCase,
              canWrite: ownsCase && (calendarById.get(event.calendar.id)?.canWrite ?? false),
            })),
          },
        }}
      />
    </Shell>
  )
}
