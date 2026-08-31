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
import { localize } from "@/lib/i18n/catalog";
import { localeFor, type UserLanguage } from "@/lib/i18n/config";
import { getServerI18n } from "@/lib/i18n/server";
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  INVITED_AGENCY_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
} from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  AgencyInvitationForm,
  RecruitmentStageForm,
  RevokeInvitationForm,
} from "./AgencyInvitationForms";
import { AgencyOverviewBento } from "./AgencyOverviewBento";
import { AgencyRecruitmentPipeline } from "./AgencyRecruitmentPipeline";
import {
  AgencyTeamList,
  type AgencyTeamMember,
} from "./AgencyTeamList";
import {
  AGENCY_RECRUITMENT_STAGE_LABEL,
  AGENCY_RECRUITMENT_STAGE_LABEL_EN,
  AGENCY_RECRUITMENT_STAGES,
  agencyRecruitmentStageLabel,
  sanitizeAgencyRecruitmentStage,
  type AgencyRecruitmentStageValue,
} from "./recruitment-ui";
import {
  currentOrLatestAgencyPlanSubscription,
  getActiveDirectInvitedSubagencySubscription,
  INVITATION_VALIDITY_DAYS,
  isCurrentAgencyPlanSubscription,
  type AgencyPlanSubscriptionStatus as SubscriptionStatus,
} from "./plan";

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: "Período de teste",
  ACTIVE: "Assinatura ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

const SUBSCRIPTION_STATUS_LABEL_EN: Record<SubscriptionStatus, string> = {
  TRIALING: "Trial period",
  ACTIVE: "Active subscription",
  PAST_DUE: "Payment overdue",
  CANCELED: "Canceled",
  EXPIRED: "Expired",
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "TRIALING",
  "ACTIVE",
]);

const AGENCY_RECRUITMENT_STAGE_SHORT_LABEL: Record<
  AgencyRecruitmentStageValue,
  string
> = {
  PROSPECT: "Prospecto",
  CONTACTED: "Contato",
  MEETING_SCHEDULED: "Reunião",
  QUALIFIED: "Qualificado",
  INVITED: "Convite",
  ONBOARDING: "Onboarding",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  DECLINED: "Descartado",
};

const AGENCY_RECRUITMENT_STAGE_SHORT_LABEL_EN: Record<
  AgencyRecruitmentStageValue,
  string
> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacted",
  MEETING_SCHEDULED: "Meeting",
  QUALIFIED: "Qualified",
  INVITED: "Invited",
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  PAUSED: "Paused",
  DECLINED: "Declined",
};

function formatUsd(cents: number, language: UserLanguage): string {
  return new Intl.NumberFormat(localeFor(language), {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: Date, language: UserLanguage): string {
  return new Intl.DateTimeFormat(localeFor(language), {
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

const INVITATION_STATUS_LABEL_EN: Record<InvitationStatus, string> = {
  PENDING: "Awaiting acceptance",
  ACCEPTED: "Accepted",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
};

function effectiveInvitationStatus(
  status: InvitationStatus,
  expiresAt: Date,
  now: Date,
): InvitationStatus {
  return status === "PENDING" && expiresAt <= now ? "EXPIRED" : status;
}

function InvitationStatusBadge({
  status,
  language,
}: {
  status: InvitationStatus;
  language: UserLanguage;
}) {
  const className = status === "ACCEPTED"
    ? "bg-success-pale text-success"
    : status === "PENDING"
      ? "bg-gold-pale text-gold-ink"
      : "bg-panel text-ink-muted";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {language === "EN"
        ? INVITATION_STATUS_LABEL_EN[status]
        : INVITATION_STATUS_LABEL[status]}
    </span>
  );
}

function StatusBadge({
  status,
  current,
  language,
}: {
  status: string | null;
  current?: boolean;
  language: UserLanguage;
}) {
  const presentation = getSubscriptionStatusPresentation(status, current, language);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        presentation.active
          ? "bg-success-pale text-success"
          : presentation.warning
            ? "bg-gold-pale text-gold-ink"
            : "bg-panel text-ink-muted"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          presentation.active
            ? "bg-success"
            : presentation.warning
              ? "bg-gold-ink"
              : "bg-ink-muted"
        }`}
      />
      {presentation.label}
    </span>
  );
}

function getSubscriptionStatusPresentation(
  status: string | null,
  current = true,
  language: UserLanguage = "PT",
) {
  const knownStatus = status as SubscriptionStatus | null;
  const statusLooksActive = knownStatus
    ? ACTIVE_SUBSCRIPTION_STATUSES.has(knownStatus)
    : false;
  const active = statusLooksActive && current !== false;
  const warning = knownStatus === "PAST_DUE";
  const label = statusLooksActive && current === false
    ? localize(language, "Período encerrado", "Period ended")
    : knownStatus
      ? (language === "EN"
          ? SUBSCRIPTION_STATUS_LABEL_EN[knownStatus]
          : SUBSCRIPTION_STATUS_LABEL[knownStatus]) ?? knownStatus
      : localize(language, "Sem assinatura ativa", "No active subscription");

  return {
    active,
    warning,
    label,
    tone: active ? "success" : warning ? "warning" : "neutral",
  } as const;
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
  language,
}: {
  subscriptionStatus: string | null;
  subscriptionCurrent: boolean;
  unitAmountCents: number | null;
  language: UserLanguage;
}) {
  const copy = (portuguese: string, english: string) =>
    localize(language, portuguese, english);

  return (
    <>
      <ModuleSummary
        label={copy("Limites do acesso individual", "Individual access limits")}
        items={[
          { label: copy("Plano", "Plan"), value: copy("Agente", "Agent"), detail: copy("Operação individual", "Individual operation") },
          { label: copy("Escopo", "Scope"), value: "1", detail: copy("Somente seus próprios dados", "Only your own data"), tone: "green" },
          {
            label: "National Life",
            value: copy("Pessoal", "Personal"),
            detail: copy("Sem dados provenientes da agência", "No data from the agency"),
          },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface" aria-labelledby="individual-access-title">
          <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-teal">
                {copy("Operação independente", "Independent operation")}
              </p>
              <h2 id="individual-access-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                {copy("Tudo o que o agente precisa, sem dados da equipe.", "Everything an agent needs, without team data.")}
              </h2>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} language={language} />
              {unitAmountCents ? (
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatUsd(unitAmountCents, language)}{copy("/mês", "/month")}
                </span>
              ) : null}
            </div>
          </div>
          <ul className="mt-2">
            <AccessItem title={copy("CRM e carteira pessoais", "Personal CRM and portfolio")} description={copy("Clientes, oportunidades, apólices e comissões atribuídos a você.", "Clients, opportunities, policies, and commissions assigned to you.")} />
            <AccessItem title={copy("National Life pessoal", "Personal National Life")} description={copy("A integração e os dados da seguradora ficam limitados à sua própria produção.", "The carrier integration and data are limited to your own production.")} />
            <AccessItem title={copy("Jornada individual", "Individual journey")} description={copy("Metas, progresso e próximos passos calculados para o seu resultado.", "Goals, progress, and next steps calculated for your results.")} />
            <AccessItem enabled={false} title={copy("Gestão de equipe", "Team management")} description={copy("Hierarquia, produção consolidada e assinaturas da equipe não aparecem neste plano.", "Hierarchy, consolidated production, and team subscriptions are not available on this plan.")} />
          </ul>
        </section>

        <ContextPanel eyebrow={copy("Separação de acesso", "Access separation")} title={copy("Privacidade por padrão", "Privacy by default")}>
          <p>
            {copy(
              "O plano Agente nunca amplia o escopo só porque existe uma relação na hierarquia. Consultas e telas usam apenas o seu identificador.",
              "The Agent plan never expands access simply because a hierarchy connection exists. Queries and screens use only your identifier.",
            )}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Nesta primeira versão", "In this first version")}</p>
            <p className="mt-2">{copy("Troca de plano e cobrança automática ainda não estão habilitadas.", "Plan changes and automatic billing are not available yet.")}</p>
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
  canInviteAgents,
  language,
}: {
  agencyName: string;
  subscriptionStatus: string | null;
  subscriptionCurrent: boolean;
  unitAmountCents: number | null;
  canInviteAgents: boolean;
  language: UserLanguage;
}) {
  const copy = (portuguese: string, english: string) =>
    localize(language, portuguese, english);
  const price = unitAmountCents ?? INVITED_AGENT_MONTHLY_PRICE_CENTS;

  return (
    <>
      <ModuleSummary
        label={copy("Resumo do vínculo", "Connection summary")}
        items={[
          { label: copy("Plano", "Plan"), value: copy("Convidado", "Invited"), detail: copy("Assinatura individual vinculada", "Linked individual subscription") },
          { label: copy("Mensalidade", "Monthly fee"), value: formatUsd(price, language), detail: copy("Valor especial da agência", "Special agency rate"), tone: "green", compact: true },
          { label: copy("Escopo", "Scope"), value: copy("Pessoal", "Personal"), detail: copy("Você trabalha apenas nos seus dados", "You work only with your own data") },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface" aria-labelledby="member-plan-title">
          <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-teal">{copy("Agente convidado", "Invited agent")}</p>
              <h2 id="member-plan-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
                {copy(`Você está vinculado à ${agencyName}.`, `You are linked to ${agencyName}.`)}
              </h2>
            </div>
            <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} language={language} />
          </div>

          <div className="mt-6 rounded-2xl border border-teal/20 bg-teal-pale/55 p-5">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">{copy("Regra do plano", "Plan rule")}</p>
            <p className="mt-2 text-sm leading-6 text-ink">
              {copy(
                `O valor de ${formatUsd(price, language)} por mês existe enquanto esta assinatura permanecer sob o convite da agência. O agente continua vinculado durante o plano; ao encerrá-lo, o preço especial e o acesso comercial deixam de valer.`,
                `The ${formatUsd(price, language)} monthly rate applies while this subscription remains under the agency invitation. The agent stays linked during the plan; when it ends, the special price and business access also end.`,
              )}
            </p>
          </div>

          <ul className="mt-2">
            <AccessItem title={copy("Seu trabalho continua privado", "Your work remains private")} description={copy("Você acessa seus próprios clientes, oportunidades, apólices e produção.", "You access your own clients, opportunities, policies, and production.")} />
            <AccessItem title={copy("Visibilidade da assinatura", "Subscription visibility")} description={copy(`A ${agencyName} pode ver se sua assinatura está ativa, pendente ou cancelada.`, `${agencyName} can see whether your subscription is active, pending, or canceled.`)} />
            <AccessItem enabled={false} title={copy("Sem painel de gestão", "No management dashboard")} description={copy("Você não acessa a equipe, as assinaturas dos colegas nem os dados consolidados da agência.", "You cannot access the team, colleagues' subscriptions, or the agency's consolidated data.")} />
          </ul>
        </section>

        <ContextPanel eyebrow={copy("Seu acesso", "Your access")} title={copy("Individual, dentro da agência", "Individual, within the agency")}>
          <p>
            {copy(
              "O vínculo comercial não transforma seu login em uma conta de gestão. Informações de equipe e dados National Life de outros agentes permanecem restritos.",
              "The business connection does not turn your login into a management account. Team information and other agents' National Life data remain restricted.",
            )}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Mensalidade", "Monthly fee")}</p>
            <p className="mt-2 text-2xl font-medium text-paper">{formatUsd(price, language)}</p>
            <p className="mt-1 text-xs text-paper/55">{copy("por mês, por assinatura convidada", "per month, per invited subscription")}</p>
          </div>
        </ContextPanel>
      </div>

      {canInviteAgents ? (
        <section
          className="module-main-surface mt-8"
          aria-labelledby="member-invitation-title"
        >
          <div className="border-b border-border-steel pb-5">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-teal">
              {copy("Sua ramificação", "Your branch")}
            </p>
            <h2
              id="member-invitation-title"
              className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink"
            >
              {copy("Convide um agente ou uma agência.", "Invite an agent or an agency.")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
              {copy(
                `O novo vínculo permanece na ${agencyName} e aparece abaixo de você no mapa visto pelo responsável. Seu acesso continua individual e não revela dados nem assinaturas de outras pessoas da equipe.`,
                `The new connection remains within ${agencyName} and appears below you on the map seen by the owner. Your access remains individual and does not reveal other team members' data or subscriptions.`,
              )}
            </p>
          </div>
          <AgencyInvitationForm agencyName={agencyName} />
        </section>
      ) : null}
    </>
  );
}

function PausedAgencyOwnerPlan({
  agencyName,
  subscriptionStatus,
  language,
}: {
  agencyName: string;
  subscriptionStatus: string | null;
  language: UserLanguage;
}) {
  const copy = (portuguese: string, english: string) =>
    localize(language, portuguese, english);

  return (
    <div className="module-content-grid">
      <section className="module-main-surface" aria-labelledby="paused-agency-title">
        <div className="flex flex-col gap-4 border-b border-border-steel pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-teal">
              {copy("Plano Agência", "Agency plan")}
            </p>
            <h2 id="paused-agency-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">
              {copy(
                `A gestão da ${agencyName} está temporariamente limitada.`,
                `${agencyName} management is temporarily limited.`,
              )}
            </h2>
          </div>
          <StatusBadge status={subscriptionStatus} current={false} language={language} />
        </div>
        <ul className="mt-2">
          <AccessItem title={copy("Seu acesso pessoal continua disponível", "Your personal access remains available")} description={copy("Você pode trabalhar com os registros atribuídos diretamente a você.", "You can work with records assigned directly to you.")} />
          <AccessItem enabled={false} title={copy("Equipe protegida", "Protected team")} description={copy("Equipe, convites, assinaturas e dados consolidados ficam indisponíveis sem uma assinatura Agência ativa.", "Team, invitations, subscriptions, and consolidated data remain unavailable without an active Agency subscription.")} />
          <AccessItem enabled={false} title={copy("National Life da agência protegida", "Protected agency National Life")} description={copy("Fontes e totais da equipe não são liberados enquanto o plano não estiver ativo.", "Team sources and totals are not released while the plan is inactive.")} />
        </ul>
      </section>

      <ContextPanel eyebrow={copy("Acesso suspenso", "Access suspended")} title={copy("O vínculo foi preservado", "The connection was preserved")}>
        <p>
          {copy(
            `A conta continua identificada como responsável pela ${agencyName}, mas nenhum dado da equipe é exibido neste estado.`,
            `The account remains identified as the owner of ${agencyName}, but no team data is shown in this state.`,
          )}
        </p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Nesta primeira versão", "In this first version")}</p>
          <p className="mt-2">{copy("A reativação e a cobrança automática ainda não estão disponíveis nesta tela.", "Reactivation and automatic billing are not available on this screen yet.")}</p>
        </div>
      </ContextPanel>
    </div>
  );
}

async function AgencyOwnerPlan({
  agencyId,
  language,
}: {
  agencyId: string;
  language: UserLanguage;
}) {
  const copy = (portuguese: string, english: string) =>
    localize(language, portuguese, english);
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
      childAgencies: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          memberships: {
            where: { role: "OWNER", endedAt: null },
            orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              agent: {
                select: {
                  user: { select: { name: true, email: true } },
                },
              },
              acceptedInvitation: {
                select: {
                  agencyId: true,
                  status: true,
                  acceptedPlan: true,
                },
              },
            },
          },
          subscriptions: {
            where: { plan: "AGENCY" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              status: true,
              unitAmountCents: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
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
    throw new Error(copy("Agência não encontrada.", "Agency not found."));
  }

  // The active agency subscription used by the access decision is the same
  // one shown here. Reading an arbitrary historical row could make a valid
  // owner appear canceled when an older subscription still exists.
  const agencySubscription = access.subscription;
  const subscribedMembers = agency.memberships.filter((membership) => {
    if (membership.role === "OWNER") {
      return isCurrentAgencyPlanSubscription(agencySubscription, now);
    }
    return isCurrentAgencyPlanSubscription(
      currentOrLatestAgencyPlanSubscription(membership.subscriptions, now),
      now,
    );
  });
  const invitedSubagencyEntries = agency.childAgencies.flatMap((childAgency) => {
    const owner = childAgency.memberships[0];
    const subscription = getActiveDirectInvitedSubagencySubscription({
      owner: owner
        ? {
            invitation: owner.acceptedInvitation,
          }
        : null,
      subscriptions: childAgency.subscriptions,
    }, agency.id, now);
    return subscription ? [{ childAgency, owner, subscription }] : [];
  });
  const invitedSubagencySubscriptions = invitedSubagencyEntries.map(
    (entry) => entry.subscription,
  );
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

  const recruitmentStages = AGENCY_RECRUITMENT_STAGES.map((stage) => ({
    id: stage,
    label: language === "EN"
      ? AGENCY_RECRUITMENT_STAGE_LABEL_EN[stage]
      : AGENCY_RECRUITMENT_STAGE_LABEL[stage],
    shortLabel: language === "EN"
      ? AGENCY_RECRUITMENT_STAGE_SHORT_LABEL_EN[stage]
      : AGENCY_RECRUITMENT_STAGE_SHORT_LABEL[stage],
    count: stageCounts.get(stage) ?? 0,
  }));

  const memberRoster: AgencyTeamMember[] = agency.memberships.map(
    (membership) => {
      const isOwner = membership.role === "OWNER";
      const subscription = currentOrLatestAgencyPlanSubscription(
        membership.subscriptions,
        now,
      );
      const status = isOwner
        ? agencySubscription?.status ?? null
        : subscription?.status ?? null;
      const current = isCurrentAgencyPlanSubscription(
        isOwner ? agencySubscription : subscription,
        now,
      );
      const statusPresentation = getSubscriptionStatusPresentation(
        status,
        current,
        language,
      );
      const price = isOwner
        ? null
        : subscription?.unitAmountCents
          ?? INVITED_AGENT_MONTHLY_PRICE_CENTS;

      return {
        id: membership.id,
        name: membership.agent.user.name,
        email: membership.agent.user.email,
        role: isOwner ? copy("Responsável", "Owner") : copy("Agente convidado", "Invited agent"),
        statusLabel: statusPresentation.label,
        statusTone: statusPresentation.tone,
        priceLabel: price === null
          ? copy("Plano Agência", "Agency plan")
          : `${formatUsd(price, language)}${copy("/mês", "/month")}`,
      };
    },
  );

  const subagencyRoster: AgencyTeamMember[] = invitedSubagencyEntries.map(
    ({ childAgency, owner, subscription }) => {
      const statusPresentation = getSubscriptionStatusPresentation(
        subscription.status,
        isCurrentAgencyPlanSubscription(subscription, now),
        language,
      );

      return {
        id: `agency:${childAgency.id}`,
        name: childAgency.name,
        email: owner?.agent.user.email ?? copy("Responsável não identificado", "Owner not identified"),
        role: copy("Subagência convidada", "Invited sub-agency"),
        statusLabel: statusPresentation.label,
        statusTone: statusPresentation.tone,
        priceLabel: `${formatUsd(subscription.unitAmountCents, language)}${copy("/mês", "/month")}`,
      };
    },
  );
  const roster = [...memberRoster, ...subagencyRoster];

  return (
    <>
      <AgencyOverviewBento
        directLinks={roster.length}
        invitationHistory={invitations.length}
        pendingInvitations={activePendingInvitations.length}
        confirmedEntries={acceptedInvitations.length}
      />

      <div className="agency-owner-sections">
        <section
          className="module-main-surface agency-pipeline-surface"
          aria-labelledby="recruitment-pipeline-title"
        >
            <div className="flex flex-col gap-3 border-b border-border-steel pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="recruitment-pipeline-title" className="text-2xl font-medium tracking-[-0.02em] text-ink">{copy("Pipeline da equipe", "Team pipeline")}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
                  {copy(
                    `Acompanhe convites pendentes, entradas confirmadas e o histórico dos vínculos criados diretamente pela ${agency.name}.`,
                    `Track pending invitations, confirmed entries, and the history of connections created directly by ${agency.name}.`,
                  )}
                </p>
              </div>
              <span className="font-mono text-xs text-ink-muted">
                {invitations.length === 1
                  ? copy("1 registro", "1 record")
                  : copy(`${invitations.length} registros`, `${invitations.length} records`)}
              </span>
            </div>

            <AgencyRecruitmentPipeline stages={recruitmentStages} />

            {invitations.length === 0 ? (
              <div className="agency-pipeline-empty">
                <div>
                  <strong>{copy("Nenhum recrutamento registrado.", "No recruitment activity yet.")}</strong>
                  <span>{copy("Os novos convites aparecerão aqui.", "New invitations will appear here.")}</span>
                </div>
                <Link className="agency-empty-action" href="#invite-agent-title">
                  {copy("Convidar integrante", "Invite member")}
                </Link>
              </div>
            ) : (
              <div className="mt-6">
                <div className="hidden grid-cols-[minmax(0,1.15fr)_0.75fr_minmax(230px,1fr)_0.75fr_auto] gap-4 border-b border-border-steel px-2 pb-3 md:grid">
                  {[
                    copy("Pessoa ou agência", "Person or agency"),
                    copy("Entrada", "Entry"),
                    copy("Etapa", "Stage"),
                    copy("Convite", "Invitation"),
                    copy("Ações", "Actions"),
                  ].map((label) => (
                    <span key={label} className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
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
                      ? `${formatUsd(invitation.monthlyPriceCents, language)}${copy("/mês", "/month")}${
                          invitation.monthlyPriceCents === INVITED_AGENT_MONTHLY_PRICE_CENTS
                            ? copy(
                                ` · ${formatUsd(AGENCY_INVITATION_DISCOUNT_CENTS, language)} de desconto`,
                                ` · ${formatUsd(AGENCY_INVITATION_DISCOUNT_CENTS, language)} discount`,
                              )
                            : ""
                        }`
                      : resolvedType === "AGENCY"
                        ? `${formatUsd(invitation.monthlyPriceCents, language)}${copy("/mês", "/month")}${
                            invitation.monthlyPriceCents === INVITED_AGENCY_MONTHLY_PRICE_CENTS
                              ? copy(
                                  ` · ${formatUsd(AGENCY_INVITATION_DISCOUNT_CENTS, language)} de desconto`,
                                  ` · ${formatUsd(AGENCY_INVITATION_DISCOUNT_CENTS, language)} discount`,
                                )
                              : ""
                          }`
                        : copy("Plano definido no aceite", "Plan selected upon acceptance");
                    const statusDetail = invitation.effectiveStatus === "PENDING"
                      ? copy(
                          `Válido até ${formatDate(invitation.expiresAt, language)}`,
                          `Valid until ${formatDate(invitation.expiresAt, language)}`,
                        )
                      : invitation.effectiveStatus === "ACCEPTED" && invitation.acceptedAt
                        ? copy(
                            `Aceito em ${formatDate(invitation.acceptedAt, language)}`,
                            `Accepted on ${formatDate(invitation.acceptedAt, language)}`,
                          )
                        : invitation.effectiveStatus === "REVOKED" && invitation.revokedAt
                          ? copy(
                              `Revogado em ${formatDate(invitation.revokedAt, language)}`,
                              `Revoked on ${formatDate(invitation.revokedAt, language)}`,
                            )
                          : copy(
                              `Criado em ${formatDate(invitation.createdAt, language)}`,
                              `Created on ${formatDate(invitation.createdAt, language)}`,
                            );

                    return (
                      <li
                        key={invitation.id}
                        className="grid gap-4 border-b border-border-steel py-5 last:border-b-0 md:grid-cols-[minmax(0,1.15fr)_0.75fr_minmax(230px,1fr)_0.75fr_auto] md:items-start md:px-2"
                      >
                        <div className="min-w-0">
                          <strong className="block truncate text-sm font-semibold text-ink">{inviteeLabel}</strong>
                          <span className="mt-1 block truncate text-xs text-ink-muted">{invitation.email}</span>
                          <span className="mt-2 inline-flex rounded-full bg-panel px-2.5 py-1 text-xs font-semibold text-ink-muted md:hidden">
                            {language === "EN"
                              ? AGENCY_RECRUITMENT_STAGE_LABEL_EN[invitation.sanitizedStage]
                              : agencyRecruitmentStageLabel(invitation.sanitizedStage)}
                          </span>
                        </div>

                        <div>
                          <span className="block text-xs font-semibold text-ink">
                            {resolvedType === "AGENT"
                              ? copy("Agente", "Agent")
                              : resolvedType === "AGENCY"
                                ? copy("Agência", "Agency")
                                : copy("Definido no aceite", "Selected upon acceptance")}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-ink-muted">{planDetail}</span>
                          <span className="mt-1 block text-xs leading-5 text-ink-muted">
                            {copy(`Direto em ${agency.name}`, `Directly linked to ${agency.name}`)}
                          </span>
                        </div>

                        <RecruitmentStageForm
                          key={`${invitation.id}:${invitation.sanitizedStage}:${invitation.stageUpdatedAt.toISOString()}`}
                          invitationId={invitation.id}
                          inviteeLabel={inviteeLabel}
                          currentStage={invitation.sanitizedStage}
                          expectedStageUpdatedAt={invitation.stageUpdatedAt.toISOString()}
                        />

                        <div>
                          <InvitationStatusBadge status={invitation.effectiveStatus} language={language} />
                          <span className="mt-2 block text-xs leading-5 text-ink-muted">{statusDetail}</span>
                        </div>

                        <div className="flex min-h-11 items-start justify-start md:justify-end">
                          {invitation.effectiveStatus === "PENDING" ? (
                            <RevokeInvitationForm
                              invitationId={invitation.id}
                              inviteeLabel={inviteeLabel}
                            />
                          ) : (
                            <span className="py-2 text-xs text-ink-muted">{copy("Histórico", "History")}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

        <section
          className="module-main-surface agency-roster-surface"
          aria-labelledby="team-subscriptions-title"
        >
          <div className="agency-section-heading">
            <div>
              <h2 id="team-subscriptions-title">{copy("Equipe e assinaturas", "Team and subscriptions")}</h2>
              <span>
                {copy(
                  `Acompanhe os vínculos diretos e convide novos agentes ou agências para a ${agency.name}.`,
                  `Track direct connections and invite new agents or agencies to ${agency.name}.`,
                )}
              </span>
            </div>
            <strong>
              {subscribedMembers.length + invitedSubagencySubscriptions.length}
              /{roster.length} {copy("ativas", "active")}
            </strong>
          </div>

          <AgencyTeamList members={roster} agencyName={agency.name} />

          <div
            id="invite-agent-title"
            className="agency-team-invite scroll-mt-24"
            aria-labelledby="new-invitation-title"
          >
            <div className="agency-team-invite-heading">
              <div>
                <h3 id="new-invitation-title">{copy("Adicionar novo convite", "Add a new invitation")}</h3>
                <p>
                  {copy(
                    "Informe o e-mail. O convidado cria ou acessa a conta e ativa o plano no próprio acesso.",
                    "Enter the email address. The invitee creates or accesses their account and activates the plan themselves.",
                  )}
                </p>
              </div>
              <p className="agency-invite-discount-note">
                <strong>{formatUsd(AGENCY_INVITATION_DISCOUNT_CENTS, language)}</strong>
                <span>{copy(" de desconto por mês", " monthly discount")}</span>
              </p>
            </div>

            <ol className="agency-invite-flow" aria-label={copy("Como o convite funciona", "How the invitation works")}>
              <li>
                <span aria-hidden="true">1</span>
                <div>
                  <strong>{copy("Convite por e-mail", "Email invitation")}</strong>
                  <p>
                    {copy(
                      `Enviamos um link individual, válido por ${INVITATION_VALIDITY_DAYS} dias.`,
                      `We send an individual link valid for ${INVITATION_VALIDITY_DAYS} days.`,
                    )}
                  </p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">2</span>
                <div>
                  <strong>{copy("Cadastro e ativação", "Sign-up and activation")}</strong>
                  <p>{copy("O convidado cria ou acessa a conta e ativa o próprio plano.", "The invitee creates or accesses their account and activates their own plan.")}</p>
                </div>
              </li>
              <li>
                <span aria-hidden="true">3</span>
                <div>
                  <strong>{copy("Entrada na equipe", "Joining the team")}</strong>
                  <p>{copy("Com o plano ativo, o vínculo aparece na equipe e no mapa.", "Once the plan is active, the connection appears in the team and on the map.")}</p>
                </div>
              </li>
            </ol>

            <AgencyInvitationForm agencyName={agency.name} />
          </div>
        </section>

      </div>
    </>
  );
}

export default async function AgencyPage() {
  const { language, copy } = await getServerI18n();
  const access = await getCurrentAgentAccess();
  const currentAgent = await prisma.agent.findUnique({
    where: { id: access.agentId },
    select: { user: { select: { name: true } } },
  });
  const agencyName = access.agency?.name ?? copy("sua agência", "your agency");
  const subscriptionStatus = access.subscription?.status ?? null;
  const subscriptionCurrent = isCurrentAgencyPlanSubscription(
    access.subscription,
    new Date(),
  );

  return (
    <Shell role="AGENT" userName={currentAgent?.user.name ?? ""}>
      <PageHeader
        title={
          access.kind === "AGENCY_OWNER"
            ? copy("Sua agência, em uma única visão.", "Your agency, all in one view.")
            : access.kind === "AGENCY_MEMBER"
              ? copy("Seu plano dentro da agência.", "Your plan within the agency.")
              : copy("Seu plano, do seu jeito.", "Your plan, your way.")
        }
        eyebrow={
          access.kind === "AGENCY_OWNER"
            ? copy(`Plano Agência · ${agencyName}`, `Agency plan · ${agencyName}`)
            : access.kind === "AGENCY_MEMBER"
              ? copy("Plano Agente convidado", "Invited agent plan")
              : copy("Plano Agente", "Agent plan")
        }
        description={
          access.kind === "AGENCY_OWNER"
            ? access.canViewTeamSubscriptions
              ? copy(
                  "Gerencie o vínculo da equipe, acompanhe quem está assinando e mantenha os dados consolidados sob o acesso da agência.",
                  "Manage team connections, track active subscriptions, and keep consolidated data under agency access.",
                )
              : copy(
                  "O vínculo da agência foi preservado, mas os dados e controles da equipe permanecem protegidos até a reativação do plano.",
                  "The agency connection was preserved, but team data and controls remain protected until the plan is reactivated.",
                )
            : access.kind === "AGENCY_MEMBER"
              ? copy(
                  "Seu acesso continua individual, com a mensalidade especial e o vínculo definidos pela agência.",
                  "Your access remains individual, with the special monthly rate and connection defined by the agency.",
                )
              : copy(
                  "Uma operação individual com limites claros: seus dados, sua carteira e sua produção.",
                  "An individual operation with clear boundaries: your data, your portfolio, and your production.",
                )
        }
      >
        <StatusBadge status={subscriptionStatus} current={subscriptionCurrent} language={language} />
      </PageHeader>

      {access.kind === "AGENCY_OWNER" && access.agency ? (
        access.canViewTeamSubscriptions ? (
          <AgencyOwnerPlan agencyId={access.agency.id} language={language} />
        ) : (
          <PausedAgencyOwnerPlan
            agencyName={access.agency.name}
            subscriptionStatus={subscriptionStatus}
            language={language}
          />
        )
      ) : access.kind === "AGENCY_MEMBER" && access.agency ? (
        <AgencyMemberPlan
          agencyName={access.agency.name}
          subscriptionStatus={subscriptionStatus}
          subscriptionCurrent={subscriptionCurrent}
          unitAmountCents={access.subscription?.unitAmountCents ?? null}
          canInviteAgents={access.canInviteAgents}
          language={language}
        />
      ) : (
        <IndividualPlan
          subscriptionStatus={subscriptionStatus}
          subscriptionCurrent={subscriptionCurrent}
          unitAmountCents={access.subscription?.unitAmountCents ?? null}
          language={language}
        />
      )}
    </Shell>
  );
}
