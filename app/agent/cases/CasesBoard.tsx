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
import { useI18n } from "@/components/i18n/LanguageProvider";
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

const PAGE_SIZE = 10;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function PipelineSignalGroup({ signals, hidden = false }: { signals: string[]; hidden?: boolean }) {
  return (
    <div className="cases-marquee-group" aria-hidden={hidden || undefined}>
      {signals.map((signal) => (
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
  const { copy, locale } = useI18n();
  const productLabel = useMemo<Record<string, string>>(() => ({
    TERM: "Term", IUL: "IUL", UNDECIDED: copy("Produto a definir", "Product undecided"),
  }), [copy]);
  const objectiveLabel = useMemo<Record<string, string>>(() => ({
    PROTECTION: copy("Proteção", "Protection"), ACCUMULATION: copy("Acumulação", "Accumulation"),
    RETIREMENT: copy("Aposentadoria", "Retirement"), LEGACY: copy("Legado", "Legacy"),
  }), [copy]);
  const pipelineSignals = useMemo(() => [
    copy("Novo atendimento", "New case"), copy("Diagnóstico", "Discovery"),
    copy("Proposta", "Proposal"), copy("Aplicação", "Application"),
    copy("Análise", "Underwriting"), copy("Emissão", "Issuance"),
    copy("Relacionamento", "Relationship"),
  ], [copy]);
  const usd = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }), [locale]);
  const shortDate = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "America/New_York" }), [locale]);
  const updatedLabel = (iso: string) => shortDate.format(new Date(iso));
  const moneyLabel = (value: string | null, suffix = "") => value ? `${usd.format(Number(value))}${suffix}` : copy("A definir", "To be defined");
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
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);

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
        productLabel[caseItem.productType] ?? caseItem.productType,
        objectiveLabel[caseItem.objective] ?? caseItem.objective,
      ]
        .join(" ")
        .toLocaleLowerCase(locale);

      return searchable.includes(normalizedQuery);
    });

    return result.sort((left, right) => {
      if (sortMode === "name") {
        return left.prospectName.localeCompare(right.prospectName, locale);
      }
      if (sortMode === "oldest") {
        return left.updatedAt.localeCompare(right.updatedAt);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [cases, effectiveStageKey, query, sortMode, locale, productLabel, objectiveLabel]);

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
            <p data-cases-hero-item>{copy("Central de relacionamento e vendas", "Relationship and sales hub")}</p>
            <h1 data-cases-hero-item id="cases-page-title">
              {copy("Seu CRM, do primeiro contato à apólice.", "Your CRM, from first contact to policy.")}
              <span className="cases-inline-flow" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </h1>
            <p data-cases-hero-item>
              {copy("Organize clientes, oportunidades e próximas ações em uma única visão, do novo atendimento ao relacionamento.", "Organize clients, opportunities, and next actions in one view, from a new case through the relationship.")}
            </p>
          </div>

          <div className="cases-hero-actions" data-cases-hero-item>
            <Link href="/agent/activities" className="cases-hero-secondary">
              {copy("Ver atividades", "View activities")}
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/agent/cases/new" className="cases-hero-primary">
              <span aria-hidden="true">+</span>
              {copy("Novo atendimento", "New case")}
            </Link>
          </div>
        </div>

        <div className="cases-pipeline-marquee" aria-hidden="true">
          <div className="cases-marquee-track" data-cases-marquee>
            <PipelineSignalGroup signals={pipelineSignals} />
            <PipelineSignalGroup signals={pipelineSignals} hidden />
          </div>
        </div>
      </section>

      <section className="cases-summary-grid" aria-label={copy("Resumo da fila", "Queue summary")}>
        {[
          {
            label: copy("Em andamento", "In progress"),
            value: activeCases,
            detail: copy("Oportunidades que ainda pedem ação", "Opportunities that still need action"),
          },
          {
            label: copy("Em follow-up", "In follow-up"),
            value: followUpCases,
            detail: copy("Leads com próximo contato definido", "Leads with a defined next contact"),
          },
          {
            label: copy("Convertidos", "Converted"),
            value: convertedCases,
            detail: copy("Contratos, apólices e clientes ativos", "Contracts, policies, and active clients"),
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
              <p>{copy("Pipeline de oportunidades", "Opportunity pipeline")}</p>
              <h2 id="cases-list-title">{copy("Escolha a próxima ação.", "Choose the next action.")}</h2>
            </div>
            <span role="status" aria-live="polite">
              {filtered.length === 1 ? copy("1 resultado", "1 result") : copy("{count} resultados", "{count} results", { count: filtered.length })}
            </span>
          </div>

          <div className="cases-toolbar">
            <label className="cases-search">
              <span>{copy("Buscar", "Search")}</span>
              <input
                type="search"
                aria-controls="crm-pipeline-results"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={copy("Cliente, agente, produto ou objetivo", "Client, agent, product, or objective")}
              />
            </label>

            <label className="cases-sort">
              <span>{copy("Ordenar", "Sort")}</span>
              <select
                aria-controls="crm-pipeline-results"
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as SortMode);
                  setPage(1);
                }}
              >
                <option value="recent">{copy("Atualizados recentemente", "Recently updated")}</option>
                <option value="oldest">{copy("Atualizados há mais tempo", "Oldest updates")}</option>
                <option value="name">{copy("Nome do cliente", "Client name")}</option>
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
                    {copy("Atendimento registrado", "Case registered")}
                  </span>
                  <span data-empty-card>
                    <i />
                    {copy("Próximo passo definido", "Next step defined")}
                  </span>
                  <span data-empty-card>
                    <i />
                    {copy("Apólice acompanhada", "Policy tracked")}
                  </span>
                </div>

                <div className="cases-empty-copy">
                  <p>{cases.length === 0 ? copy("Seu CRM está pronto.", "Your CRM is ready.") : copy("A busca terminou.", "Search complete.")}</p>
                  <h3>
                    {cases.length === 0
                      ? copy("Comece pelo primeiro atendimento.", "Start with your first case.")
                      : copy("Nenhuma oportunidade corresponde a esta visão.", "No opportunity matches this view.")}
                  </h3>
                  <p>
                    {cases.length === 0
                      ? copy("Inicie um atendimento para reunir cliente, objetivo, documentos e próxima ação em um único fluxo.", "Start a case to bring the client, objective, documents, and next action into one workflow.")
                      : copy("Ajuste a busca ou limpe os filtros para voltar a ver toda a sua fila.", "Adjust the search or clear filters to see your full queue again.")}
                  </p>
                  <div>
                    {cases.length === 0 ? (
                      <Link href="/agent/cases/new">
                        {copy("Criar primeiro atendimento", "Create first case")}
                        <span aria-hidden="true">↗</span>
                      </Link>
                    ) : (
                      <button type="button" onClick={resetFilters}>
                        {copy("Limpar filtros", "Clear filters")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="cases-list-head" aria-hidden="true">
                  <span>{copy("Cliente e responsável", "Client and owner")}</span>
                  <span>{copy("Produto e objetivo", "Product and objective")}</span>
                  <span>{copy("Valores", "Amounts")}</span>
                  <span>{copy("Etapa", "Stage")}</span>
                  <i />
                </div>

                <ul className="cases-list">
                  {pageCases.map((caseItem) => (
                    <li key={caseItem.id} className="cases-row" data-case-row>
                      <Link href={`/agent/cases/${caseItem.id}`} className="cases-row-link" aria-label={copy("Abrir lead {name}", "Open lead {name}", { name: caseItem.prospectName })}>
                        <div className="cases-row-person">
                          <span aria-hidden="true">
                            {initials(caseItem.prospectName) || "CL"}
                          </span>
                          <div>
                            <span className="sr-only">{copy("Cliente:", "Client:")} </span>
                            <strong>{caseItem.prospectName}</strong>
                            <small>
                              <span className="sr-only">{copy("Responsável e atualização:", "Owner and update:")} </span>
                              {caseItem.agentName} · {copy("atualizado em {date}", "updated on {date}", { date: updatedLabel(caseItem.updatedAt) })}
                            </small>
                          </div>
                        </div>

                        <div className="cases-row-product">
                          <span className="sr-only">{copy("Produto:", "Product:")} </span>
                          <strong>
                            {productLabel[caseItem.productType] ??
                              caseItem.productType}
                          </strong>
                          <small>
                            <span className="sr-only">{copy("Objetivo:", "Objective:")} </span>
                            {objectiveLabel[caseItem.objective] ??
                              caseItem.objective}
                          </small>
                        </div>

                        <div className="cases-row-values">
                          <strong>
                            <span className="sr-only">{copy("Cobertura:", "Coverage:")} </span>
                            {moneyLabel(caseItem.targetCoverage)}
                          </strong>
                          <small>
                            <span className="sr-only">{copy("Orçamento mensal:", "Monthly budget:")} </span>
                            {moneyLabel(caseItem.monthlyBudget, copy("/mês", "/month"))}
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
            <p>{copy("Próxima etapa", "Next stage")}</p>
            <h2 id="cases-navigation-title">{copy("Tudo continua conectado.", "Everything stays connected.")}</h2>
            <p>
              {copy("Avance pelo relacionamento sem perder o histórico, as pendências ou a próxima ação.", "Move the relationship forward without losing history, pending items, or the next action.")}
            </p>
          </div>

          <nav aria-label={copy("Atalhos da operação", "Operation shortcuts")}>
            {[
              {
                href: "/agent/cases/new",
                label: copy("Novo atendimento", "New case"),
                detail: copy("Registre a oportunidade e defina a próxima ação.", "Register the opportunity and define the next action."),
              },
              {
                href: "/agent/clients",
                label: copy("Clientes", "Clients"),
                detail: copy("Consulte histórico e dados do relacionamento.", "Review relationship history and details."),
              },
              {
                href: "/agent/activities",
                label: copy("Atividades", "Activities"),
                detail: copy("Revise retornos e pendências da operação.", "Review follow-ups and pending items."),
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
              {copy("Fluxo do CRM", "CRM flow")}
            </span>
            <b>{copy("Atendimento → Relacionamento", "Case → Relationship")}</b>
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
        prospectName={followUpTarget?.prospectName ?? copy("este lead", "this lead")}
        onSubmit={async ({ title, scheduledAt }) => {
          if (!followUpTarget) return { ok: false, message: copy("Lead não encontrado.", "Lead not found.") };
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
