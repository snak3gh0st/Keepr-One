"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CrmNavigation } from "@/components/CrmNavigation";
import { Pagination, clampPage } from "@/components/Pagination";
import type { CrmStageView } from "@/lib/crm";
import {
  PipelineRail,
  pipelineTabId,
} from "@/components/crm/PipelineRail";
import { CrmStageSelect } from "@/components/crm/CrmStageSelect";
import { FollowUpModal } from "@/components/crm/FollowUpModal";
import { StageManagerDrawer } from "@/components/crm/StageManagerDrawer";
import {
  archiveStageAction,
  createStageAction,
  moveCaseAndScheduleAction,
  moveCaseStageAction,
  renameStageAction,
  reorderStagesAction,
} from "./actions";

type Case = {
  id: string;
  assignedAgentId: string;
  crmStage: Pick<CrmStageView, "id" | "name" | "systemKey"> | null;
  prospectName: string;
  agentName: string;
  productType: string;
  objective: string;
  targetCoverage: string | null;
  monthlyBudget: string | null;
  updatedAt: string;
};

type SortMode = "recent" | "oldest" | "name";

const PRODUCT_LABEL: Record<string, string> = {
  TERM: "Term",
  IUL: "IUL",
  UNDECIDED: "Produto a definir",
};

const OBJECTIVE_LABEL: Record<string, string> = {
  PROTECTION: "Proteção",
  ACCUMULATION: "Acumulação",
  RETIREMENT: "Aposentadoria",
  LEGACY: "Legado",
};

const PIPELINE_SIGNALS = [
  "Novo atendimento",
  "Diagnóstico",
  "Proposta",
  "Aplicação",
  "Análise",
  "Emissão",
  "Relacionamento",
];

const PAGE_SIZE = 10;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/New_York",
});

function updatedLabel(iso: string): string {
  return SHORT_DATE.format(new Date(iso));
}

function moneyLabel(value: string | null, suffix = "") {
  if (!value) return "A definir";
  return `${USD.format(Number(value))}${suffix}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function PipelineSignalGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="cases-marquee-group" aria-hidden={hidden || undefined}>
      {PIPELINE_SIGNALS.map((signal) => (
        <span key={signal}>
          {signal}
          <i />
        </span>
      ))}
    </div>
  );
}

export function CasesBoard({
  cases,
  stages,
  stageOptionsByAgent,
}: {
  cases: Case[];
  stages: CrmStageView[];
  stageOptionsByAgent: Record<string, CrmStageView[]>;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [activeStageKey, setActiveStageKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [page, setPage] = useState(1);
  const [managerOpen, setManagerOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<{
    caseId: string;
    prospectName: string;
    stageId: string;
  } | null>(null);

  const effectiveStageKey = useMemo(() => {
    if (!activeStageKey) return null;
    const validStageKeys = new Set(
      stages.map((stage) =>
        stage.systemKey ? `system:${stage.systemKey}` : `stage:${stage.id}`,
      ),
    );
    return validStageKeys.has(activeStageKey) ? activeStageKey : null;
  }, [activeStageKey, stages]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    const result = cases.filter((caseItem) => {
      const belongsToStage =
        !effectiveStageKey ||
        (effectiveStageKey.startsWith("system:")
          ? caseItem.crmStage?.systemKey === effectiveStageKey.slice(7)
          : caseItem.crmStage?.id === effectiveStageKey.slice(6));
      if (!belongsToStage) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        caseItem.prospectName,
        caseItem.agentName,
        PRODUCT_LABEL[caseItem.productType] ?? caseItem.productType,
        OBJECTIVE_LABEL[caseItem.objective] ?? caseItem.objective,
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR");

      return searchable.includes(normalizedQuery);
    });

    return result.sort((left, right) => {
      if (sortMode === "name") {
        return left.prospectName.localeCompare(right.prospectName, "pt-BR");
      }
      if (sortMode === "oldest") {
        return left.updatedAt.localeCompare(right.updatedAt);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [cases, effectiveStageKey, query, sortMode]);

  const railStages = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        caseCount: cases.filter((caseItem) =>
          stage.systemKey
            ? caseItem.crmStage?.systemKey === stage.systemKey
            : caseItem.crmStage?.id === stage.id,
        ).length,
      })),
    [cases, stages],
  );

  const activeCases = cases.filter(
    (caseItem) => !["ACTIVE_CLIENT", "LOST"].includes(caseItem.crmStage?.systemKey ?? ""),
  ).length;
  const followUpCases = cases.filter((caseItem) => caseItem.crmStage?.systemKey === "FOLLOW_UP").length;
  const convertedCases = cases.filter((caseItem) =>
    ["CONTRACT_CLOSED", "POLICY_ISSUED", "ACTIVE_CLIENT"].includes(caseItem.crmStage?.systemKey ?? ""),
  ).length;

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const pageCases = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  function resetFilters() {
    setActiveStageKey(null);
    setQuery("");
    setSortMode("recent");
    setPage(1);
  }

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const intro = gsap.timeline({
        defaults: { ease: "power3.out" },
      });

      intro
        .from("[data-cases-hero-item]", {
          y: 24,
          opacity: 0,
          duration: 0.72,
          stagger: 0.08,
        })
        .from(
          "[data-cases-metric]",
          {
            y: 30,
            scale: 0.94,
            opacity: 0,
            duration: 0.68,
            stagger: 0.08,
          },
          "-=0.36",
        )
        .from(
          "[data-cases-panel]",
          {
            y: 42,
            scale: 0.975,
            opacity: 0,
            duration: 0.82,
            stagger: 0.1,
          },
          "-=0.38",
        );

      const marquee = gsap.utils.toArray("[data-cases-marquee]");
      let marqueeObserver: IntersectionObserver | null = null;
      if (marquee.length > 0) {
        const marqueeTween = gsap.to(marquee, {
          xPercent: -50,
          duration: 28,
          ease: "none",
          repeat: -1,
          paused: true,
        });
        const hero = root.current?.querySelector(".cases-hero");

        if (hero) {
          marqueeObserver = new IntersectionObserver(([entry]) => {
            marqueeTween.paused(!entry.isIntersecting);
          });
          marqueeObserver.observe(hero);
        } else {
          marqueeTween.play();
        }
      }

      const emptyVisual = gsap.utils.toArray("[data-empty-visual]");
      const emptyCards = gsap.utils.toArray("[data-empty-card]");
      if (emptyVisual.length > 0) {
        gsap.from(emptyVisual, {
          scale: 0.82,
          opacity: 0.18,
          duration: 1,
          ease: "power3.out",
        });
      }
      if (emptyCards.length > 0) {
        gsap.from(emptyCards, {
          y: 72,
          scale: 0.88,
          opacity: 0,
          duration: 0.86,
          stagger: 0.1,
          ease: "power3.out",
        });
      }

      return () => marqueeObserver?.disconnect();
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const rows = gsap.utils.toArray("[data-case-row]");
      if (rows.length > 0) {
        gsap.fromTo(
          rows,
          { y: 18, scale: 0.985, opacity: 0 },
          {
            y: 0,
            scale: 1,
            opacity: 1,
            duration: 0.48,
            stagger: 0.045,
            ease: "power3.out",
          },
        );
      }
    },
    {
      scope: root,
      dependencies: [effectiveStageKey, sortMode, currentPage],
      revertOnUpdate: true,
    },
  );

  return (
    <div ref={root} className="cases-workspace">
      <CrmNavigation active="opportunities" />

      <section
        className="cases-hero keepr-noise"
        aria-labelledby="cases-page-title"
      >
        <div className="cases-hero-main">
          <div className="cases-hero-copy">
            <p data-cases-hero-item>Central de relacionamento e vendas</p>
            <h1 data-cases-hero-item id="cases-page-title">
              Seu CRM, do primeiro contato à apólice.
              <span className="cases-inline-flow" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </h1>
            <p data-cases-hero-item>
              Organize clientes, oportunidades e próximas ações em uma única
              visão, do novo atendimento ao relacionamento.
            </p>
          </div>

          <div className="cases-hero-actions" data-cases-hero-item>
            <Link href="/agent/activities" className="cases-hero-secondary">
              Ver atividades
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/agent/cases/new" className="cases-hero-primary">
              <span aria-hidden="true">+</span>
              Novo atendimento
            </Link>
          </div>
        </div>

        <div className="cases-pipeline-marquee" aria-hidden="true">
          <div className="cases-marquee-track" data-cases-marquee>
            <PipelineSignalGroup />
            <PipelineSignalGroup hidden />
          </div>
        </div>
      </section>

      <section className="cases-summary-grid" aria-label="Resumo da fila">
        {[
          {
            label: "Em andamento",
            value: activeCases,
            detail: "Oportunidades que ainda pedem ação",
          },
          {
            label: "Em follow-up",
            value: followUpCases,
            detail: "Leads com próximo contato definido",
          },
          {
            label: "Convertidos",
            value: convertedCases,
            detail: "Contratos, apólices e clientes ativos",
          },
        ].map((metric) => (
          <div className="cases-summary-card" data-cases-metric key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <p>{metric.detail}</p>
            </div>
            <strong>{String(metric.value).padStart(2, "0")}</strong>
          </div>
        ))}
      </section>

      <div className="cases-content-grid">
        <section
          className="cases-board-shell"
          data-cases-panel
          aria-labelledby="cases-list-title"
        >
          <div className="cases-board-heading">
            <div>
              <p>Pipeline de oportunidades</p>
              <h2 id="cases-list-title">Escolha a próxima ação.</h2>
            </div>
            <span role="status" aria-live="polite">
              {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
            </span>
          </div>

          <div className="cases-toolbar">
            <label className="cases-search">
              <span>Buscar</span>
              <input
                type="search"
                aria-controls="crm-pipeline-results"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Cliente, agente, produto ou objetivo"
              />
            </label>

            <label className="cases-sort">
              <span>Ordenar</span>
              <select
                aria-controls="crm-pipeline-results"
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as SortMode);
                  setPage(1);
                }}
              >
                <option value="recent">Atualizados recentemente</option>
                <option value="oldest">Atualizados há mais tempo</option>
                <option value="name">Nome do cliente</option>
              </select>
            </label>
          </div>

          <PipelineRail
            stages={railStages}
            allCount={cases.length}
            activeStageKey={effectiveStageKey}
            panelId="crm-pipeline-results"
            onStageChange={(stageKey) => {
              setActiveStageKey(stageKey);
              setPage(1);
            }}
            onManage={() => setManagerOpen(true)}
          />

          <div
            id="crm-pipeline-results"
            role="tabpanel"
            aria-labelledby={pipelineTabId(effectiveStageKey)}
            className="cases-results"
          >
            {filtered.length === 0 ? (
              <div className="cases-empty-state">
                <div className="cases-empty-visual" data-empty-visual aria-hidden="true">
                  <span data-empty-card>
                    <i />
                    Atendimento registrado
                  </span>
                  <span data-empty-card>
                    <i />
                    Próximo passo definido
                  </span>
                  <span data-empty-card>
                    <i />
                    Apólice acompanhada
                  </span>
                </div>

                <div className="cases-empty-copy">
                  <p>{cases.length === 0 ? "Seu CRM está pronto." : "A busca terminou."}</p>
                  <h3>
                    {cases.length === 0
                      ? "Comece pelo primeiro atendimento."
                      : "Nenhuma oportunidade corresponde a esta visão."}
                  </h3>
                  <p>
                    {cases.length === 0
                      ? "Inicie um atendimento para reunir cliente, objetivo, documentos e próxima ação em um único fluxo."
                      : "Ajuste a busca ou limpe os filtros para voltar a ver toda a sua fila."}
                  </p>
                  <div>
                    {cases.length === 0 ? (
                      <Link href="/agent/cases/new">
                        Criar primeiro atendimento
                        <span aria-hidden="true">↗</span>
                      </Link>
                    ) : (
                      <button type="button" onClick={resetFilters}>
                        Limpar filtros
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="cases-list-head" aria-hidden="true">
                  <span>Cliente e responsável</span>
                  <span>Produto e objetivo</span>
                  <span>Valores</span>
                  <span>Etapa</span>
                  <i />
                </div>

                <ul className="cases-list">
                  {pageCases.map((caseItem) => (
                    <li key={caseItem.id} className="cases-row" data-case-row>
                      <Link href={`/agent/cases/${caseItem.id}`} className="cases-row-link" aria-label={`Abrir lead ${caseItem.prospectName}`}>
                        <div className="cases-row-person">
                          <span aria-hidden="true">
                            {initials(caseItem.prospectName) || "CL"}
                          </span>
                          <div>
                            <span className="sr-only">Cliente: </span>
                            <strong>{caseItem.prospectName}</strong>
                            <small>
                              <span className="sr-only">Responsável e atualização: </span>
                              {caseItem.agentName} · atualizado{" "}
                              em {updatedLabel(caseItem.updatedAt)}
                            </small>
                          </div>
                        </div>

                        <div className="cases-row-product">
                          <span className="sr-only">Produto: </span>
                          <strong>
                            {PRODUCT_LABEL[caseItem.productType] ??
                              caseItem.productType}
                          </strong>
                          <small>
                            <span className="sr-only">Objetivo: </span>
                            {OBJECTIVE_LABEL[caseItem.objective] ??
                              caseItem.objective}
                          </small>
                        </div>

                        <div className="cases-row-values">
                          <strong>
                            <span className="sr-only">Cobertura: </span>
                            {moneyLabel(caseItem.targetCoverage)}
                          </strong>
                          <small>
                            <span className="sr-only">Orçamento mensal: </span>
                            {moneyLabel(caseItem.monthlyBudget, "/mês")}
                          </small>
                        </div>

                      </Link>
                      <div className="cases-row-stage">
                        <CrmStageSelect
                          caseId={caseItem.id}
                          stage={caseItem.crmStage}
                          stages={stageOptionsByAgent[caseItem.assignedAgentId] ?? []}
                          onChange={async (caseId, stageId) => {
                            const result = await moveCaseStageAction(caseId, stageId);
                            if (result.ok) router.refresh();
                            return result;
                          }}
                          onFollowUpRequired={(stageId) =>
                            setFollowUpTarget({
                              caseId: caseItem.id,
                              prospectName: caseItem.prospectName,
                              stageId,
                            })
                          }
                          compact
                        />
                      </div>
                      <Link href={`/agent/cases/${caseItem.id}`} className="cases-row-arrow" aria-hidden="true" tabIndex={-1}>→</Link>
                    </li>
                  ))}
                </ul>

                <Pagination
                  page={currentPage}
                  pageCount={pageCount}
                  onPageChange={setPage}
                  className="cases-pagination"
                />
              </>
            )}
          </div>
        </section>

        <aside
          className="cases-navigation-panel"
          data-cases-panel
          aria-labelledby="cases-navigation-title"
        >
          <div>
            <p>Próxima etapa</p>
            <h2 id="cases-navigation-title">Tudo continua conectado.</h2>
            <p>
              Avance pelo relacionamento sem perder o histórico, as pendências
              ou a próxima ação.
            </p>
          </div>

          <nav aria-label="Atalhos da operação">
            {[
              {
                href: "/agent/cases/new",
                label: "Novo atendimento",
                detail: "Registre a oportunidade e defina a próxima ação.",
              },
              {
                href: "/agent/clients",
                label: "Clientes",
                detail: "Consulte histórico e dados do relacionamento.",
              },
              {
                href: "/agent/activities",
                label: "Atividades",
                detail: "Revise retornos e pendências da operação.",
              },
            ].map((item) => (
              <Link href={item.href} key={item.href}>
                <span>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </span>
                <i aria-hidden="true">↗</i>
              </Link>
            ))}
          </nav>

          <div className="cases-navigation-foot">
            <span>
              <i aria-hidden="true" />
              Fluxo do CRM
            </span>
            <b>Atendimento → Relacionamento</b>
          </div>
        </aside>
      </div>

      <StageManagerDrawer
        key={stages.map((stage) => `${stage.id}:${stage.name}:${stage.position}:${stage.caseCount}`).join("|")}
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        stages={stages}
        actions={{
          create: createStageAction,
          rename: renameStageAction,
          reorder: reorderStagesAction,
          archive: archiveStageAction,
        }}
        onChanged={() => router.refresh()}
      />

      <FollowUpModal
        key={followUpTarget?.caseId ?? "closed"}
        open={Boolean(followUpTarget)}
        onClose={() => setFollowUpTarget(null)}
        prospectName={followUpTarget?.prospectName ?? "este lead"}
        onSubmit={async ({ title, scheduledAt }) => {
          if (!followUpTarget) return { ok: false, message: "Lead não encontrado." };
          const result = await moveCaseAndScheduleAction({
            caseId: followUpTarget.caseId,
            stageId: followUpTarget.stageId,
            title,
            scheduledAt,
          });
          if (result.ok) router.refresh();
          return result;
        }}
      />
    </div>
  );
}
