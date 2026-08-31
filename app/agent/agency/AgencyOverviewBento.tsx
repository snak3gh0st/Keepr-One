"use client";

import { useI18n } from "@/components/i18n/LanguageProvider";

type AgencyOverviewBentoProps = {
  directLinks: number;
  invitationHistory: number;
  pendingInvitations: number;
  confirmedEntries: number;
};

export function AgencyOverviewBento({
  directLinks,
  invitationHistory,
  pendingInvitations,
  confirmedEntries,
}: AgencyOverviewBentoProps) {
  const { copy } = useI18n();
  const metrics = [
    {
      label: copy("Vínculos diretos", "Direct connections"),
      value: directLinks,
      detail: directLinks === 1
        ? copy("pessoa ou agência", "person or agency")
        : copy("pessoas e agências", "people and agencies"),
    },
    {
      label: copy("Histórico", "History"),
      value: invitationHistory,
      detail: invitationHistory === 1
        ? copy("convite criado", "invitation created")
        : copy("convites criados", "invitations created"),
    },
    {
      label: copy("Pendentes", "Pending"),
      value: pendingInvitations,
      detail: copy("aguardando aceite", "awaiting acceptance"),
    },
    {
      label: copy("Confirmados", "Confirmed"),
      value: confirmedEntries,
      detail: confirmedEntries === 1
        ? copy("entrada concluída", "completed entry")
        : copy("entradas concluídas", "completed entries"),
    },
  ];

  return (
    <section
      className="agency-overview-bento"
      aria-label={copy("Visão geral da agência", "Agency overview")}
    >
      <h2 className="sr-only">{copy("Resumo da agência", "Agency summary")}</h2>
      <dl>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>
              <strong>{metric.value}</strong>
              <span>{metric.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
