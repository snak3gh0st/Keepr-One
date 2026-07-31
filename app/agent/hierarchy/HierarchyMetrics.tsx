"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

type HierarchyMetric = {
  key: "upline" | "downline" | "depth";
  label: string;
  value: number;
  detail: string;
  unit: string;
};

function MetricIcon({ type }: { type: HierarchyMetric["key"] }) {
  if (type === "upline") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="5" r="2.25" />
        <circle cx="12" cy="18.5" r="2.25" />
        <path d="M12 16.25V8M8.5 11.5 12 8l3.5 3.5" />
      </svg>
    );
  }

  if (type === "downline") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="5" r="2.25" />
        <circle cx="6" cy="18.5" r="2.25" />
        <circle cx="18" cy="18.5" r="2.25" />
        <path d="M12 7.25v4.5M6 16.25v-2.5h12v2.5" />
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
  uplineCount,
  downlineCount,
  depth,
}: {
  uplineCount: number;
  downlineCount: number;
  depth: number;
}) {
  const root = useRef<HTMLElement>(null);
  const metrics: HierarchyMetric[] = [
    {
      key: "upline",
      label: "Linha de liderança",
      value: uplineCount,
      detail:
        uplineCount > 0
          ? "Pessoas conectadas acima da sua posição"
          : "Sua posição inicia esta linha",
      unit: uplineCount === 1 ? "liderança" : "lideranças",
    },
    {
      key: "downline",
      label: "Equipe conectada",
      value: downlineCount,
      detail:
        downlineCount > 0
          ? "Agentes que fazem parte da sua estrutura"
          : "Nenhum agente conectado abaixo de você",
      unit: downlineCount === 1 ? "agente" : "agentes",
    },
    {
      key: "depth",
      label: "Camadas da equipe",
      value: depth,
      detail:
        depth > 0
          ? "Maior distância entre você e sua equipe"
          : "Sua estrutura ainda não possui novas camadas",
      unit: depth === 1 ? "nível" : "níveis",
    },
  ];

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-hierarchy-metric]", {
          y: 24,
          scale: 0.965,
          opacity: 0,
          duration: 0.64,
          stagger: 0.075,
          ease: "power3.out",
          clearProps: "transform,opacity",
        });

        gsap.from("[data-hierarchy-signal]", {
          scaleX: 0,
          transformOrigin: "left center",
          duration: 0.72,
          stagger: 0.07,
          ease: "power3.out",
          clearProps: "transform",
        });
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="hierarchy-metrics" aria-label="Resumo da estrutura">
      {metrics.map((metric) => (
        <article key={metric.key} data-hierarchy-metric data-tone={metric.key}>
          <header>
            <div>
              <strong>{metric.label}</strong>
              <p>{metric.detail}</p>
            </div>
            <span className="hierarchy-metric-icon">
              <MetricIcon type={metric.key} />
            </span>
          </header>

          <div className="hierarchy-metric-value">
            <strong>{metric.value.toLocaleString("pt-BR")}</strong>
            <span>{metric.unit}</span>
          </div>

          <footer>
            <span className="hierarchy-metric-signal" aria-hidden="true">
              <i data-hierarchy-signal />
              <i data-hierarchy-signal />
              <i data-hierarchy-signal />
            </span>
            <small>
              {metric.key === "upline"
                ? "Sua referência"
                : metric.key === "downline"
                  ? "Sua estrutura"
                  : "Alcance atual"}
            </small>
          </footer>
        </article>
      ))}
    </section>
  );
}
