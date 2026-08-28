type HierarchyMetric = {
  key: "people" | "agencies" | "depth";
  label: string;
  value: number;
  detail: string;
};

function MetricIcon({ type }: { type: HierarchyMetric["key"] }) {
  if (type === "people") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="5" r="2.25" />
        <circle cx="6" cy="18.5" r="2.25" />
        <circle cx="18" cy="18.5" r="2.25" />
        <path d="M12 7.25v4.5M6 16.25v-2.5h12v2.5" />
      </svg>
    );
  }

  if (type === "agencies") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M4.5 20V9.5L12 4l7.5 5.5V20M8 20v-6h8v6M3 20h18" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m4.5 8 7.5-4 7.5 4-7.5 4-7.5-4Z" />
      <path d="m4.5 12 7.5 4 7.5-4M4.5 16l7.5 4 7.5-4" />
    </svg>
  );
}

export function HierarchyMetrics({
  peopleBelow,
  agenciesBelow,
  depth,
}: {
  peopleBelow: number;
  agenciesBelow: number;
  depth: number;
}) {
  const metrics: HierarchyMetric[] = [
    {
      key: "people",
      label: "Pessoas na equipe",
      value: peopleBelow,
      detail: peopleBelow === 1 ? "1 agente ou responsável abaixo" : `${peopleBelow} agentes e responsáveis abaixo`,
    },
    {
      key: "agencies",
      label: "Subagências",
      value: agenciesBelow,
      detail: agenciesBelow === 1 ? "1 agência descendente" : `${agenciesBelow} agências descendentes`,
    },
    {
      key: "depth",
      label: "Camadas",
      value: depth,
      detail: depth === 1 ? "1 nível depois de você" : `${depth} níveis depois de você`,
    },
  ];

  return (
    <section className="hierarchy-metrics" aria-label="Resumo do mapa da equipe">
      {metrics.map((metric) => (
        <div key={metric.key} className="hierarchy-metric" data-tone={metric.key}>
          <span className="hierarchy-metric-icon">
            <MetricIcon type={metric.key} />
          </span>
          <span className="hierarchy-metric-copy">
            <strong>{metric.label}</strong>
            <small>{metric.detail}</small>
          </span>
          <span className="hierarchy-metric-value">
            {metric.value.toLocaleString("pt-BR")}
          </span>
        </div>
      ))}
    </section>
  );
}
