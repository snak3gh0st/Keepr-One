import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentScopeIds } from "@/lib/agent-access";
import { Shell } from "@/components/Shell";
import { CrmNavigation } from "@/components/CrmNavigation";
import { PageHeader } from "@/components/PageHeader";
import { ModuleSummary } from "@/components/ModuleSummary";
import { ContextPanel } from "@/components/ContextPanel";
import { EmptyState } from "@/components/Table";
import { ErrorBanner } from "@/components/ErrorBanner";
import { CrmStagePill, PolicyStatusPill } from "@/components/StatusPill";
import { FollowUpActionCard } from "@/components/crm/FollowUpActionCard";
import { getOpenFollowUpsForScope, type DueFollowUpView } from "@/lib/crm";

export const dynamic = "force-dynamic";

const DUE_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/New_York",
});

const EVENT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const TODAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/New_York",
});

function dateKeyInNewYork(date: Date) {
  const parts = TODAY_KEY_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function dueState(dueAt: Date | null, todayKey: string) {
  if (!dueAt) return { label: "Sem prazo", tone: "neutral" as const };
  const dueKey = dateKeyInNewYork(dueAt);
  if (dueKey < todayKey) return { label: "Atrasado", tone: "danger" as const };
  if (dueKey === todayKey) return { label: "Hoje", tone: "gold" as const };
  return { label: DUE_DATE.format(dueAt), tone: "neutral" as const };
}

function activityTitle(type: string, title: string) {
  if (title === "Caso criado") return "Atendimento iniciado";
  if (title === "Needs analysis atualizada") return "Análise de necessidades atualizada";
  if (type === "STAGE_CHANGED") return title.replace("Etapa alterada", "Etapa atualizada");
  return title;
}

function personName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

export default async function ActivitiesPage() {
  const agent = await getCurrentAgent();
  const user = await prisma.user.findUnique({ where: { id: agent.userId } });
  const scopeAgentIds = await getAgentScopeIds(agent.id);

  let data: Awaited<ReturnType<typeof loadActivities>> | null = null;
  let followUps: DueFollowUpView[] = [];
  let loadError = false;

  try {
    [data, followUps] = await Promise.all([
      loadActivities(scopeAgentIds),
      getOpenFollowUpsForScope(scopeAgentIds),
    ]);
  } catch (error) {
    console.error("CRM activities query error", error);
    loadError = true;
  }

  const requirements = data?.requirements ?? [];
  const reviews = data?.reviews ?? [];
  const recentEvents = data?.recentEvents ?? [];
  const todayKey = dateKeyInNewYork(new Date());
  const overdueCount = [
    ...followUps.map((item) => item.scheduledAt),
    ...requirements.map((item) => item.dueAt),
    ...reviews.map((item) => item.dueAt),
  ].filter((dueAt) => dueAt && dateKeyInNewYork(dueAt) < todayKey).length;
  const openCount =
    followUps.length +
    (data?.requirementCount ?? 0) +
    (data?.reviewCount ?? 0);

  return (
    <Shell role="AGENT" userName={user?.name ?? ""}>
      <div className="space-y-4">
        <CrmNavigation active="activities" />
        <PageHeader
          title="Atividades"
          eyebrow="CRM · Próximas ações"
          description="Retornos, pendências e revisões organizados para você saber o que fazer agora."
        >
          <Link
            href="/agent/cases/new"
            className="inline-flex items-center gap-2 bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-transform duration-300 hover:-translate-y-0.5"
          >
            <span className="text-success" aria-hidden="true">+</span>
            Novo atendimento
          </Link>
          <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">
            {openCount} {openCount === 1 ? "ação aberta" : "ações abertas"}
          </span>
        </PageHeader>
      </div>

      {loadError && (
        <ErrorBanner>
          Não foi possível carregar as atividades agora. Tente atualizar a página.
        </ErrorBanner>
      )}

      {!loadError && (
        <>
          <ModuleSummary
            label="Resumo das atividades"
            items={[
              {
                label: "Retornos",
                value: followUps.length,
                detail: "Contatos ainda não concluídos",
                tone: "green",
              },
              {
                label: "Pendências",
                value: data?.requirementCount ?? 0,
                detail: "Documentos ou respostas em aberto",
                tone: "gold",
              },
              {
                label: "Revisões",
                value: data?.reviewCount ?? 0,
                detail: "Revisões anuais ainda abertas",
              },
              {
                label: "Atrasadas",
                value: overdueCount,
                detail: "Ações exibidas que passaram do prazo",
                tone: overdueCount > 0 ? "danger" : "neutral",
              },
            ]}
          />

          <div className="module-content-grid">
            <section className="module-main-surface" aria-labelledby="activities-priority-title">
              <div className="flex flex-col gap-3 border-b border-border-steel pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
                    Prioridades do CRM
                  </p>
                  <h2
                    id="activities-priority-title"
                    className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl"
                  >
                    Comece pelo que pede ação.
                  </h2>
                </div>
                <p className="max-w-sm text-sm leading-6 text-ink-muted">
                  Abra a oportunidade ou apólice para concluir a atividade sem criar um fluxo paralelo.
                </p>
              </div>

              <div className="mt-2 divide-y divide-border-steel">
                <ActivitySection
                  id="follow-ups"
                  index="01"
                  title="Retornos"
                  description="Contatos combinados com clientes e novos contatos."
                  empty="Nenhum retorno aberto. Sua agenda de contatos está em dia."
                >
                  {followUps.map((item) => (
                    <li key={item.id}>
                      <FollowUpActionCard item={item} />
                    </li>
                  ))}
                </ActivitySection>

                <ActivitySection
                  id="requirements"
                  index="02"
                  title="Pendências"
                  description="Itens solicitados durante a aplicação e análise."
                  empty="Nenhuma pendência aberta nas oportunidades da sua área."
                >
                  {requirements.map((item) => {
                    const insuranceCase = item.application.insuranceCase;
                    const status = dueState(item.dueAt, todayKey);
                    return (
                      <ActivityLink
                        key={item.id}
                        href={`/agent/cases/${item.application.caseId}`}
                        type="Pendência"
                        title={item.title}
                        subject={personName(
                          insuranceCase.prospect.firstName,
                          insuranceCase.prospect.lastName,
                        )}
                        owner={insuranceCase.assignedAgent.user.name}
                        status={status}
                      >
                        <CrmStagePill stage={insuranceCase.crmStage} />
                      </ActivityLink>
                    );
                  })}
                </ActivitySection>

                <ActivitySection
                  id="reviews"
                  index="03"
                  title="Revisões"
                  description="Acompanhamentos anuais da carteira emitida."
                  empty="Nenhuma revisão anual aberta na sua carteira."
                >
                  {reviews.map((item) => {
                    const status = dueState(item.dueAt, todayKey);
                    return (
                      <ActivityLink
                        key={item.id}
                        href={`/agent/policies/${item.policy.id}`}
                        type="Revisão anual"
                        title={`Apólice ${item.policy.policyNumber}`}
                        subject={item.policy.client.name}
                        owner={item.policy.agent.user.name}
                        status={status}
                      >
                        <PolicyStatusPill status={item.policy.status} />
                      </ActivityLink>
                    );
                  })}
                </ActivitySection>
              </div>
            </section>

            <ContextPanel eyebrow="Como usar" title="Uma ordem simples para agir">
              <ol className="space-y-5">
                {[
                  ["01", "Retorne", "Comece pelos contatos com prazo vencido ou marcado para hoje."],
                  ["02", "Destrave", "Revise documentos e respostas que impedem a oportunidade de avançar."],
                  ["03", "Acompanhe", "Use o histórico para entender o que mudou antes de agir."],
                ].map(([index, title, description]) => (
                  <li key={index} className="grid grid-cols-[2rem_1fr] gap-3 border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                    <span className="font-mono text-[10px] text-mint">{index}</span>
                    <div>
                      <strong className="text-sm font-medium text-paper">{title}</strong>
                      <p className="mt-1 text-xs leading-5 text-paper/50">{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </ContextPanel>
          </div>

          <section className="module-main-surface" aria-labelledby="recent-activity-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
                  Histórico recente
                </p>
                <h2
                  id="recent-activity-title"
                  className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink"
                >
                  O que mudou nas oportunidades.
                </h2>
              </div>
              <p className="text-xs text-ink-muted">
                Últimos {recentEvents.length} registros exibidos
              </p>
            </div>

            {recentEvents.length === 0 ? (
              <div className="mt-6">
                <EmptyState>
                  O histórico aparecerá quando um atendimento avançar, receber uma nota ou ganhar uma próxima ação.
                </EmptyState>
              </div>
            ) : (
              <ol className="mt-6 grid gap-2 md:grid-cols-2">
                {recentEvents.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`/agent/cases/${event.caseId}`}
                      className="group flex min-h-[92px] items-start justify-between gap-4 rounded-2xl border border-border-steel/80 bg-paper/65 p-4 transition-[background-color,border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-teal/35 hover:bg-paper hover:shadow-[var(--shadow-soft)]"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-teal">
                          {event.type.startsWith("FOLLOW_UP") ? "Retorno" : "Movimentação"}
                        </span>
                        <strong className="mt-1.5 block truncate text-sm font-medium text-ink">
                          {activityTitle(event.type, event.title)}
                        </strong>
                        <small className="mt-1 block truncate text-xs text-ink-muted">
                          {personName(
                            event.insuranceCase.prospect.firstName,
                            event.insuranceCase.prospect.lastName,
                          )}{" "}
                          · {EVENT_DATE.format(event.createdAt)}
                        </small>
                      </span>
                      <i className="text-sm not-italic text-ink-muted transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                        →
                      </i>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

function ActivitySection({
  id,
  index,
  title,
  description,
  empty,
  children,
}: {
  id: string;
  index: string;
  title: string;
  description: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section id={id} className="grid gap-5 py-6 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.8fr)]">
      <div>
        <span className="font-mono text-[10px] text-teal">{index}</span>
        <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-ink">{title}</h3>
        <p className="mt-1 max-w-xs text-xs leading-5 text-ink-muted">{description}</p>
      </div>
      {hasItems ? (
        <ol className="grid gap-2">{children}</ol>
      ) : (
        <p className="rounded-2xl border border-dashed border-border-steel bg-panel/45 px-4 py-5 text-sm text-ink-muted">
          {empty}
        </p>
      )}
    </section>
  );
}

function ActivityLink({
  href,
  type,
  title,
  subject,
  owner,
  status,
  children,
}: {
  href: string;
  type: string;
  title: string;
  subject: string;
  owner: string;
  status: { label: string; tone: "neutral" | "gold" | "danger" };
  children: React.ReactNode;
}) {
  const toneClass =
    status.tone === "danger"
      ? "bg-danger-pale text-danger"
      : status.tone === "gold"
        ? "bg-gold-pale text-gold-ink"
        : "bg-canvas-deep text-ink-muted";

  return (
    <li>
      <Link
        href={href}
        className="group grid min-h-[84px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-border-steel/80 bg-paper/68 p-4 transition-[background-color,border-color,transform,box-shadow] duration-300 hover:translate-x-1 hover:border-teal/35 hover:bg-paper hover:shadow-[var(--shadow-soft)]"
      >
        <span className="min-w-0">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-teal">
            {type}
          </span>
          <strong className="mt-1.5 block truncate text-sm font-medium text-ink">{title}</strong>
          <small className="mt-1 block truncate text-xs text-ink-muted">
            {subject} · {owner}
          </small>
        </span>
        <span className="flex flex-col items-end gap-2">
          {children}
          <span className={`rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] ${toneClass}`}>
            {status.label}
          </span>
        </span>
      </Link>
    </li>
  );
}

function loadActivities(scopeAgentIds: string[]) {
  const requirementWhere = {
    status: "OPEN" as const,
    application: {
      insuranceCase: { assignedAgentId: { in: scopeAgentIds } },
    },
  };
  const reviewWhere = {
    completedAt: null,
    policy: { agentId: { in: scopeAgentIds } },
  } as const;

  return Promise.all([
    prisma.applicationRequirement.findMany({
      where: requirementWhere,
      select: {
        id: true,
        title: true,
        dueAt: true,
        createdAt: true,
        application: {
          select: {
            caseId: true,
            insuranceCase: {
              select: {
                crmStage: { select: { name: true, systemKey: true } },
                prospect: { select: { firstName: true, lastName: true } },
                assignedAgent: {
                  select: { user: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: 100,
    }),
    prisma.policyReview.findMany({
      where: reviewWhere,
      select: {
        id: true,
        dueAt: true,
        policy: {
          select: {
            id: true,
            policyNumber: true,
            status: true,
            client: { select: { name: true } },
            agent: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { dueAt: "asc" },
      take: 100,
    }),
    prisma.caseTimelineEvent.findMany({
      where: {
        insuranceCase: { assignedAgentId: { in: scopeAgentIds } },
      },
      select: {
        id: true,
        caseId: true,
        type: true,
        title: true,
        createdAt: true,
        insuranceCase: {
          select: {
            prospect: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.applicationRequirement.count({ where: requirementWhere }),
    prisma.policyReview.count({ where: reviewWhere }),
  ]).then(
    ([
      requirements,
      reviews,
      recentEvents,
      requirementCount,
      reviewCount,
    ]) => ({
      requirements,
      reviews,
      recentEvents,
      requirementCount,
      reviewCount,
    }),
  );
}
