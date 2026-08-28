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
  const metrics = [
    {
      label: "Vínculos diretos",
      value: directLinks,
      detail: directLinks === 1 ? "pessoa ou agência" : "pessoas e agências",
    },
    {
      label: "Histórico",
      value: invitationHistory,
      detail: invitationHistory === 1 ? "convite criado" : "convites criados",
    },
    {
      label: "Pendentes",
      value: pendingInvitations,
      detail: pendingInvitations === 1 ? "aguardando aceite" : "aguardando aceite",
    },
    {
      label: "Confirmados",
      value: confirmedEntries,
      detail: confirmedEntries === 1 ? "entrada concluída" : "entradas concluídas",
    },
  ];

  return (
    <section
      className="agency-overview-bento"
      aria-label="Visão geral da agência"
    >
      <h2 className="sr-only">Resumo da agência</h2>
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
