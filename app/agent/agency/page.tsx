export const dynamic = "force-dynamic";

import Link from "next/link";
import { ContextPanel } from "@/components/ContextPanel";
import { ModuleSummary } from "@/components/ModuleSummary";
import { PageHeader } from "@/components/PageHeader";
import { Shell } from "@/components/Shell";
import {
  getCurrentAgentAccess,
  requireAgencyCapability,
} from "@/lib/agent-access";
import {
  AGENCY_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
} from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  AgencyInvitationForm,
  RecruitmentStageForm,
  RevokeInvitationForm,
} from "./AgencyInvitationForms";
import {
  AGENCY_RECRUITMENT_STAGE_LABEL,
  AGENCY_RECRUITMENT_STAGES,
  agencyInviteeTypeLabel,
  agencyRecruitmentStageLabel,
  sanitizeAgencyRecruitmentStage,
  type AgencyRecruitmentStageValue,
} from "./recruitment-ui";

type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED";

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: "Período de teste",
  ACTIVE: "Assinatura ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "TRIALING",
  "ACTIVE",
]);

type TeamSubscription = {
  status: SubscriptionStatus;
  unitAmountCents: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

function isCurrentSubscription(
  subscription: TeamSubscription | null,
  now: Date,
): subscription is TeamSubscription {
  return Boolean(
    subscription
      && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
      && (!subscription.currentPeriodStart || subscription.currentPeriodStart <= now)
      && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now),
  );
}

function currentOrLatestSubscription(
  subscriptions: readonly TeamSubscription[],
  now: Date,
): TeamSubscription | null {
  return subscriptions.find((subscription) =>
    isCurrentSubscription(subscription, now),
  ) ?? subscriptions[0] ?? null;
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: "Aguardando aceite",
  ACCEPTED: "Aceito",
  REVOKED: "Revogado",
  EXPIRED: "Expirado",
};

function effectiveInvitationStatus(
  status: InvitationStatus,
  expiresAt: Date,
  now: Date,
): InvitationStatus {
  return status === "PENDING" && expiresAt <= now ? "EXPIRED" : status;
}

function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const className = status === "ACCEPTED"
    ? "bg-success-pale text-success"
    : status === "PENDING"
      ? "bg-gold-pale text-gold-ink"
      : "bg-panel text-ink-muted";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {INVITATION_STATUS_LABEL[status]}
    </span>
  );
}

function StatusBadge({
  status,
  current,
}: {
  status: string | null;
  current?: boolean;
}) {
  const knownStatus = status as SubscriptionStatus | null;
  const statusLooksActive = knownStatus
    ? ACTIVE_SUBSCRIPTION_STATUSES.has(knownStatus)
    : false;
  const active = statusLooksActive && current !== false;
  const warning = knownStatus === "PAST_DUE";
  const label = statusLooksActive && current === false
    ? "Período encerrado"
    : knownStatus
      ? SUBSCRIPTION_STATUS_LABEL[knownStatus] ?? knownStatus
      : "Sem assinatura ativa";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-success-pale text-success"
          : warning
            ? "bg-gold-pale text-gold-ink"
            : "bg-panel text-ink-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-success" : warning ? "bg-gold-ink" : "bg-ink-muted"
        }`}
      />
      {label}
    </span>
  );
}

function AccessItem({
  title,
  description,
  enabled = true,
}: {
  title: string;
  description: string;
  enabled?: boolean;
}) {
  return (
    <li className="flex gap-3 border-b border-border-steel py-4 last:border-b-0">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          enabled ? "bg-teal-pale text-teal-deep" : "bg-panel text-ink-muted"
        }`}
      >
        {enabled ? "✓" : "—"}
      </span>
      <span>
        <strong className="block text-sm font-semibold text-ink">{title}</strong>
        <span className="mt-1 block text-sm leading-6 text-ink-muted">{description}</span>
      </span>
    </li>
  );
}

function IndividualPlan({
  subscriptionStatus,
  subscriptionCurrent,
  unitAmountCents,
}: {
  subscriptionStatus: string | null;
  subscriptionCurrent: boolean;
  unitAmountCents: number | null;
}) {
  return (
    <>
      <ModuleSummary
        label="Limites do acesso individual"
        items={[
          { label: "Plano", value: "Agente", detail: "Operação individual" },
          { label: "Escopo", value: "1", detail: "Somente seus próprios dados", tone: "green" },
          {
            label: "National Life",
            value: "Pessoal",
            detail: "Sem dados provenientes da agência",
          },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface" aria-labelledby="individual-access-title">
          <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
                Operação independente
              </p>
              <h2 id="individual-access-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                Tudo o que o agente precisa, sem dados da equipe.
              </h2>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} />
              {unitAmountCents ? (
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatUsd(unitAmountCents)}/mês
                </span>
              ) : null}
            </div>
          </div>
          <ul className="mt-2">
            <AccessItem title="CRM e carteira pessoais" description="Clientes, oportunidades, apólices e comissões atribuídos a você." />
            <AccessItem title="National Life pessoal" description="A integração e os dados da seguradora ficam limitados à sua própria produção." />
            <AccessItem title="Jornada individual" description="Metas, progresso e próximos passos calculados para o seu resultado." />
            <AccessItem enabled={false} title="Gestão de equipe" description="Hierarquia, produção consolidada e assinaturas da equipe não aparecem neste plano." />
          </ul>
        </section>

        <ContextPanel eyebrow="Separação de acesso" title="Privacidade por padrão">
          <p>
            O plano Agente nunca amplia o escopo só porque existe uma relação na hierarquia. Consultas e telas usam apenas o seu identificador.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Nesta primeira versão</p>
            <p className="mt-2">Troca de plano e cobrança automática ainda não estão habilitadas.</p>
          </div>
        </ContextPanel>
      </div>
    </>
  );
}

function AgencyMemberPlan({
  agencyName,
  subscriptionStatus,
  subscriptionCurrent,
  unitAmountCents,
}: {
  agencyName: string;
  subscriptionStatus: string | null;
  subscriptionCurrent: boolean;
  unitAmountCents: number | null;
}) {
  const price = unitAmountCents ?? INVITED_AGENT_MONTHLY_PRICE_CENTS;

  return (
    <>
      <ModuleSummary
        label="Resumo do vínculo"
        items={[
          { label: "Plano", value: "Convidado", detail: "Assinatura individual vinculada" },
          { label: "Mensalidade", value: formatUsd(price), detail: "Valor especial da agência", tone: "green", compact: true },
          { label: "Escopo", value: "Pessoal", detail: "Você trabalha apenas nos seus dados" },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface" aria-labelledby="member-plan-title">
          <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Agente convidado</p>
              <h2 id="member-plan-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                Você está vinculado à {agencyName}.
              </h2>
            </div>
            <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} />
          </div>

          <div className="mt-6 rounded-2xl border border-teal/20 bg-teal-pale/55 p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-deep">Regra do plano</p>
            <p className="mt-2 text-sm leading-6 text-ink">
              O valor de {formatUsd(price)} por mês existe enquanto esta assinatura permanecer sob o convite da agência. O agente continua vinculado durante o plano; ao encerrá-lo, o preço especial e o acesso comercial deixam de valer.
            </p>
          </div>

          <ul className="mt-2">
            <AccessItem title="Seu trabalho continua privado" description="Você acessa seus próprios clientes, oportunidades, apólices e produção." />
            <AccessItem title="Visibilidade da assinatura" description={`A ${agencyName} pode ver se sua assinatura está ativa, pendente ou cancelada.`} />
            <AccessItem enabled={false} title="Sem painel de gestão" description="Você não acessa a equipe, as assinaturas dos colegas nem os dados consolidados da agência." />
          </ul>
        </section>

        <ContextPanel eyebrow="Seu acesso" title="Individual, dentro da agência">
          <p>
            O vínculo comercial não transforma seu login em uma conta de gestão. Informações de equipe e dados National Life de outros agentes permanecem restritos.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Mensalidade</p>
            <p className="mt-2 text-2xl font-medium text-paper">{formatUsd(price)}</p>
            <p className="mt-1 text-xs text-paper/55">por mês, por assinatura convidada</p>
          </div>
        </ContextPanel>
      </div>
    </>
  );
}

function PausedAgencyOwnerPlan({
  agencyName,
  subscriptionStatus,
}: {
  agencyName: string;
  subscriptionStatus: string | null;
}) {
  return (
    <div className="module-content-grid">
      <section className="module-main-surface" aria-labelledby="paused-agency-title">
        <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">
              Plano Agência
            </p>
            <h2 id="paused-agency-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
              A gestão da {agencyName} está temporariamente limitada.
            </h2>
          </div>
          <StatusBadge status={subscriptionStatus} current={false} />
        </div>
        <ul className="mt-2">
          <AccessItem title="Seu acesso pessoal continua disponível" description="Você pode trabalhar com os registros atribuídos diretamente a você." />
          <AccessItem enabled={false} title="Equipe protegida" description="Equipe, convites, assinaturas e dados consolidados ficam indisponíveis sem uma assinatura Agência ativa." />
          <AccessItem enabled={false} title="National Life da agência protegida" description="Fontes e totais da equipe não são liberados enquanto o plano não estiver ativo." />
        </ul>
      </section>

      <ContextPanel eyebrow="Acesso suspenso" title="O vínculo foi preservado">
        <p>
          A conta continua identificada como responsável pela {agencyName}, mas nenhum dado da equipe é exibido neste estado.
        </p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Nesta primeira versão</p>
          <p className="mt-2">A reativação e a cobrança automática ainda não estão disponíveis nesta tela.</p>
        </div>
      </ContextPanel>
    </div>
  );
}

async function AgencyOwnerPlan({ agencyId }: { agencyId: string }) {
  // The route condition is not the security boundary: the capability is
  // checked again immediately before team subscription data is queried.
  const access = await requireAgencyCapability("VIEW_TEAM_SUBSCRIPTIONS");
  if (!access.agency || access.agency.id !== agencyId) {
    throw new Error("Forbidden");
  }

  const now = new Date();
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      name: true,
      memberships: {
        // Billing visibility is broader than data access: an inactive account
        // with a current charge must remain visible to the agency owner.
        where: { endedAt: null },
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          agent: {
            select: {
              id: true,
              status: true,
              user: { select: { name: true, email: true } },
            },
          },
          subscriptions: {
            where: { plan: "AGENT_AGENCY_MEMBER" },
            orderBy: { createdAt: "desc" },
            select: {
              status: true,
              unitAmountCents: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
      invitations: {
        orderBy: [{ stageUpdatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          email: true,
          intendedType: true,
          recruitmentStage: true,
          stageUpdatedAt: true,
          status: true,
          monthlyPriceCents: true,
          expiresAt: true,
          acceptedAt: true,
          acceptedPlan: true,
          revokedAt: true,
          createdAt: true,
          acceptedAgent: {
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!agency) {
    throw new Error("Agência não encontrada.");
  }

  // The active agency subscription used by the access decision is the same
  // one shown here. Reading an arbitrary historical row could make a valid
  // owner appear canceled when an older subscription still exists.
  const agencySubscription = access.subscription;
  const subscribedMembers = agency.memberships.filter((membership) => {
    if (membership.role === "OWNER") {
      return isCurrentSubscription(agencySubscription, now);
    }
    return isCurrentSubscription(
      currentOrLatestSubscription(membership.subscriptions, now),
      now,
    );
  });
  const invitedSubscribers = subscribedMembers.filter((membership) => membership.role === "MEMBER");
  const invitations = agency.invitations.map((invitation) => ({
    ...invitation,
    effectiveStatus: effectiveInvitationStatus(
      invitation.status,
      invitation.expiresAt,
      now,
    ),
    sanitizedStage:
      sanitizeAgencyRecruitmentStage(invitation.recruitmentStage) ?? "PROSPECT",
  }));
  const activePendingInvitations = invitations.filter(
    (invitation) => invitation.effectiveStatus === "PENDING",
  );
  const acceptedInvitations = invitations.filter(
    (invitation) => invitation.effectiveStatus === "ACCEPTED",
  );
  const stageCounts = new Map<AgencyRecruitmentStageValue, number>(
    AGENCY_RECRUITMENT_STAGES.map((stage) => [stage, 0]),
  );
  for (const invitation of invitations) {
    stageCounts.set(
      invitation.sanitizedStage,
      (stageCounts.get(invitation.sanitizedStage) ?? 0) + 1,
    );
  }

  return (
    <>
      <ModuleSummary
        label="Resumo do plano Agência"
        items={[
          { label: "Vínculos diretos", value: agency.memberships.length, detail: "Responsável e membros desta agência" },
          { label: "Histórico direto", value: invitations.length, detail: "Convites acompanhados" },
          { label: "Convites pendentes", value: activePendingInvitations.length, detail: "Aguardando aceite" },
          { label: "Entradas confirmadas", value: acceptedInvitations.length, detail: "Convites aceitos", tone: "green" },
        ]}
      />

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-8">
          <section className="module-main-surface" aria-labelledby="recruitment-pipeline-title">
            <div className="flex flex-col gap-3 border-b border-border-steel pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Recrutamento direto</p>
                <h2 id="recruitment-pipeline-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">Pipeline da equipe</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
                  Acompanhe convites pendentes, entradas confirmadas e o histórico dos vínculos criados diretamente pela {agency.name}.
                </p>
              </div>
              <span className="font-mono text-xs text-ink-muted">{invitations.length} registros</span>
            </div>

            <div
              className="mt-5 overflow-x-auto rounded-xl border border-border-steel"
              role="region"
              aria-label="Contagem por etapa do recrutamento"
              tabIndex={0}
            >
              <ol className="grid min-w-[920px] grid-cols-9 bg-panel/45">
                {AGENCY_RECRUITMENT_STAGES.map((stage, index) => (
                  <li
                    key={stage}
                    className="flex min-h-20 items-center justify-between gap-3 border-r border-border-steel px-3 py-3 last:border-r-0"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[10px] text-ink-muted">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-ink">
                        {AGENCY_RECRUITMENT_STAGE_LABEL[stage]}
                      </span>
                    </span>
                    <strong className="font-mono text-lg font-medium tabular-nums text-ink">
                      {stageCounts.get(stage) ?? 0}
                    </strong>
                  </li>
                ))}
              </ol>
            </div>

            {invitations.length === 0 ? (
              <div className="py-10 text-center">
                <h3 className="text-base font-semibold text-ink">Nenhum recrutamento registrado.</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink-muted">
                  Use o formulário ao lado para convidar um agente ou uma agência e definir a etapa inicial.
                </p>
              </div>
            ) : (
              <div className="mt-6">
                <div className="hidden grid-cols-[minmax(0,1.15fr)_0.75fr_minmax(230px,1fr)_0.75fr_auto] gap-4 border-b border-border-steel px-2 pb-3 md:grid">
                  {[
                    "Pessoa ou agência",
                    "Entrada",
                    "Etapa",
                    "Convite",
                    "Ações",
                  ].map((label) => (
                    <span key={label} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                      {label}
                    </span>
                  ))}
                </div>
                <ul>
                  {invitations.map((invitation) => {
                    const inviteeLabel = invitation.acceptedAgent?.user.name
                      || invitation.name
                      || invitation.email;
                    const resolvedType = invitation.intendedType
                      ?? (invitation.acceptedPlan === "AGENCY"
                        ? "AGENCY"
                        : invitation.acceptedPlan === "AGENT_AGENCY_MEMBER"
                          ? "AGENT"
                          : null);
                    const planDetail = resolvedType === "AGENT"
                      ? `${formatUsd(invitation.monthlyPriceCents)}/mês`
                      : resolvedType === "AGENCY"
                        ? `${formatUsd(AGENCY_MONTHLY_PRICE_CENTS)}/mês`
                        : "Plano definido no aceite";
                    const statusDetail = invitation.effectiveStatus === "PENDING"
                      ? `Válido até ${formatDate(invitation.expiresAt)}`
                      : invitation.effectiveStatus === "ACCEPTED" && invitation.acceptedAt
                        ? `Aceito em ${formatDate(invitation.acceptedAt)}`
                        : invitation.effectiveStatus === "REVOKED" && invitation.revokedAt
                          ? `Revogado em ${formatDate(invitation.revokedAt)}`
                          : `Criado em ${formatDate(invitation.createdAt)}`;

                    return (
                      <li
                        key={invitation.id}
                        className="grid gap-4 border-b border-border-steel py-5 last:border-b-0 md:grid-cols-[minmax(0,1.15fr)_0.75fr_minmax(230px,1fr)_0.75fr_auto] md:items-start md:px-2"
                      >
                        <div className="min-w-0">
                          <strong className="block truncate text-sm font-semibold text-ink">{inviteeLabel}</strong>
                          <span className="mt-1 block truncate text-xs text-ink-muted">{invitation.email}</span>
                          <span className="mt-2 inline-flex rounded-full bg-panel px-2.5 py-1 text-[10px] font-semibold text-ink-muted md:hidden">
                            {agencyRecruitmentStageLabel(invitation.sanitizedStage)}
                          </span>
                        </div>

                        <div>
                          <span className="block text-xs font-semibold text-ink">
                            {agencyInviteeTypeLabel(resolvedType)}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-ink-muted">{planDetail}</span>
                          <span className="mt-1 block text-xs leading-5 text-ink-muted">Direto em {agency.name}</span>
                        </div>

                        <RecruitmentStageForm
                          key={`${invitation.id}:${invitation.sanitizedStage}:${invitation.stageUpdatedAt.toISOString()}`}
                          invitationId={invitation.id}
                          inviteeLabel={inviteeLabel}
                          currentStage={invitation.sanitizedStage}
                          expectedStageUpdatedAt={invitation.stageUpdatedAt.toISOString()}
                        />

                        <div>
                          <InvitationStatusBadge status={invitation.effectiveStatus} />
                          <span className="mt-2 block text-xs leading-5 text-ink-muted">{statusDetail}</span>
                        </div>

                        <div className="flex min-h-11 items-start justify-start md:justify-end">
                          {invitation.effectiveStatus === "PENDING" ? (
                            <RevokeInvitationForm
                              invitationId={invitation.id}
                              inviteeLabel={inviteeLabel}
                            />
                          ) : (
                            <span className="py-2 text-xs text-ink-muted">Histórico</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="module-main-surface" aria-labelledby="team-subscriptions-title">
            <div className="flex items-end justify-between gap-4 border-b border-border-steel pb-5">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Equipe e assinaturas</p>
                <h2 id="team-subscriptions-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">Assinaturas diretas</h2>
              </div>
              <span className="font-mono text-xs text-ink-muted">{subscribedMembers.length}/{agency.memberships.length} ativas</span>
            </div>

            <div className="mt-5 overflow-x-auto" role="region" aria-label="Assinaturas da equipe" tabIndex={0}>
              <table className="w-full min-w-[680px] border-collapse text-left">
                <caption className="sr-only">Agentes vinculados e situação de suas assinaturas</caption>
                <thead>
                  <tr className="border-b border-border-steel">
                    <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Agente</th>
                    <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Vínculo</th>
                    <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Assinatura</th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Mensalidade</th>
                  </tr>
                </thead>
                <tbody>
                  {agency.memberships.map((membership) => {
                    const isOwner = membership.role === "OWNER";
                    const subscription = currentOrLatestSubscription(
                      membership.subscriptions,
                      now,
                    );
                    const status = isOwner
                      ? agencySubscription?.status ?? null
                      : subscription?.status ?? null;
                    const price = isOwner ? null : subscription?.unitAmountCents ?? INVITED_AGENT_MONTHLY_PRICE_CENTS;

                    return (
                      <tr key={membership.id} className="border-b border-border-steel/75 last:border-b-0">
                        <td className="px-3 py-4">
                          <strong className="block text-sm font-semibold text-ink">{membership.agent.user.name}</strong>
                          <span className="mt-1 block text-xs text-ink-muted">{membership.agent.user.email}</span>
                          {membership.agent.status !== "ACTIVE" ? (
                            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-gold-ink">Conta inativa</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 text-sm text-ink-muted">{isOwner ? "Responsável" : "Agente convidado"}</td>
                        <td className="px-3 py-4">
                          <StatusBadge
                            status={status}
                            current={isCurrentSubscription(
                              isOwner ? agencySubscription : subscription,
                              now,
                            )}
                          />
                        </td>
                        <td className="px-3 py-4 text-right font-mono text-sm font-semibold tabular-nums text-ink">
                          {price === null ? "Plano Agência" : `${formatUsd(price)}/mês`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section id="invite-agent-title" className="module-main-surface scroll-mt-24" aria-labelledby="new-invitation-title">
            <div className="border-b border-border-steel pb-5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Novo vínculo direto</p>
              <h2 id="new-invitation-title" className="mt-2 text-xl font-medium tracking-[-0.035em] text-ink">Convidar para a equipe</h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Defina se a pessoa entrará como Agente ou Agência e em qual etapa do recrutamento ela está.
              </p>
            </div>
            <AgencyInvitationForm agencyName={agency.name} />
          </section>

          <ContextPanel eyebrow="Lógica desta versão" title="Vínculo visível e controlado">
            <p>
              Você atualiza apenas as etapas dos vínculos diretos da {agency.name}. Subagências administram os próprios convites; a árvore mantém toda a ordem descendente visível.
            </p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Assinaturas convidadas</p>
              <p className="mt-2 text-2xl font-medium text-paper">{invitedSubscribers.length}</p>
              <p className="mt-1 text-xs text-paper/55">ativas por {formatUsd(INVITED_AGENT_MONTHLY_PRICE_CENTS)}/mês</p>
            </div>
            <Link href="/agent/hierarchy" className="mt-5 inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-xs font-semibold text-paper transition-colors hover:bg-white/10">
              Ver estrutura da equipe →
            </Link>
          </ContextPanel>
        </div>
      </div>
    </>
  );
}

export default async function AgencyPage() {
  const access = await getCurrentAgentAccess();
  const currentAgent = await prisma.agent.findUnique({
    where: { id: access.agentId },
    select: { user: { select: { name: true } } },
  });
  const agencyName = access.agency?.name ?? "sua agência";
  const subscriptionStatus = access.subscription?.status ?? null;
  const subscriptionCurrent = isCurrentSubscription(
    access.subscription,
    new Date(),
  );

  return (
    <Shell role="AGENT" userName={currentAgent?.user.name ?? ""}>
      <PageHeader
        title={
          access.kind === "AGENCY_OWNER"
            ? "Sua agência, em uma única visão."
            : access.kind === "AGENCY_MEMBER"
              ? "Seu plano dentro da agência."
              : "Seu plano, do seu jeito."
        }
        eyebrow={
          access.kind === "AGENCY_OWNER"
            ? `Plano Agência · ${agencyName}`
            : access.kind === "AGENCY_MEMBER"
              ? "Plano Agente convidado"
              : "Plano Agente"
        }
        description={
          access.kind === "AGENCY_OWNER"
            ? access.canViewTeamSubscriptions
              ? "Gerencie o vínculo da equipe, acompanhe quem está assinando e mantenha os dados consolidados sob o acesso da agência."
              : "O vínculo da agência foi preservado, mas os dados e controles da equipe permanecem protegidos até a reativação do plano."
            : access.kind === "AGENCY_MEMBER"
              ? "Seu acesso continua individual, com a mensalidade especial e o vínculo definidos pela agência."
              : "Uma operação individual com limites claros: seus dados, sua carteira e sua produção."
        }
      >
        <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} />
      </PageHeader>

      {access.kind === "AGENCY_OWNER" && access.agency ? (
        access.canViewTeamSubscriptions ? (
          <AgencyOwnerPlan agencyId={access.agency.id} />
        ) : (
          <PausedAgencyOwnerPlan
            agencyName={access.agency.name}
            subscriptionStatus={subscriptionStatus}
          />
        )
      ) : access.kind === "AGENCY_MEMBER" && access.agency ? (
        <AgencyMemberPlan
          agencyName={access.agency.name}
          subscriptionStatus={subscriptionStatus}
          subscriptionCurrent={subscriptionCurrent}
          unitAmountCents={access.subscription?.unitAmountCents ?? null}
        />
      ) : (
        <IndividualPlan
          subscriptionStatus={subscriptionStatus}
          subscriptionCurrent={subscriptionCurrent}
          unitAmountCents={access.subscription?.unitAmountCents ?? null}
        />
      )}
    </Shell>
  );
}
