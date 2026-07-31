"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { EmptyState } from "@/components/Table";
import { ContextPanel } from "@/components/ContextPanel";
import {
  PolicyStatusPill,
  policyStatusLabel,
} from "@/components/StatusPill";
import { clampPage } from "@/components/Pagination";

type Policy = {
  id: string;
  policyNumber: string;
  carrier: string;
  product: string;
  /// null when the carrier did not supply it, which must not read as zero.
  premium: string | null;
  status: string;
  clientName: string;
};

type SortMode =
  | "default"
  | "client-asc"
  | "client-desc"
  | "premium-desc"
  | "premium-asc";

const STATUS_ORDER = [
  "INFORCE",
  "APPROVED",
  "PENDING",
  "LAPSED",
  "CANCELLED",
];
const PAGE_SIZE = 12;
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_WHOLE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

type PremiumFilter = "all" | "known";
type MetricKey = "all" | "inforce" | "premium";

function premiumValue(premium: string | null) {
  if (premium === null) return 0;
  const value = Number(premium);
  return Number.isFinite(value) ? value : 0;
}

function formatPremium(premium: string | null) {
  // An unknown premium is shown as unknown. Rendering it as $0.00 would be a
  // number the carrier never gave us.
  if (premium === null) return "—";
  const value = Number(premium);
  return Number.isFinite(value) ? USD.format(value) : "—";
}

function paginationItems(page: number, pageCount: number) {
  const candidates = new Set(
    [1, page - 1, page, page + 1, pageCount].filter(
      (item) => item >= 1 && item <= pageCount,
    ),
  );
  const pages = Array.from(candidates).sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];

  pages.forEach((item, index) => {
    const previous = pages[index - 1];
    if (previous && item - previous > 1) items.push("ellipsis");
    items.push(item);
  });

  return items;
}

export function PoliciesList({ policies }: { policies: Policy[] }) {
  const root = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [premiumFilter, setPremiumFilter] = useState<PremiumFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  const summary = useMemo(() => {
    const inForce = policies.filter((policy) => policy.status === "INFORCE").length;
    const withPremium = policies.filter((policy) => policy.premium !== null);
    const totalPremium = withPremium.reduce(
      (total, policy) => total + premiumValue(policy.premium),
      0,
    );

    return {
      total: policies.length,
      inForce,
      withPremium: withPremium.length,
      withoutPremium: policies.length - withPremium.length,
      totalPremium,
    };
  }, [policies]);

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const policy of policies) {
      counts.set(policy.status, (counts.get(policy.status) ?? 0) + 1);
    }

    const statuses = [
      ...STATUS_ORDER.filter((item) => counts.has(item)),
      ...Array.from(counts.keys())
        .filter((item) => !STATUS_ORDER.includes(item))
        .sort(),
    ];

    return statuses.map((value) => ({
      value,
      label: policyStatusLabel[value] ?? value,
      count: counts.get(value) ?? 0,
    }));
  }, [policies]);

  const filteredPolicies = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("pt-BR");
    const result = policies.filter((policy) => {
      if (status !== "all" && policy.status !== status) return false;
      if (premiumFilter === "known" && policy.premium === null) return false;
      if (!normalizedQuery) return true;

      return [
        policy.clientName,
        policy.policyNumber,
        policy.carrier,
        policy.product,
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery);
    });

    if (sortMode === "client-asc") {
      return result.sort((left, right) =>
        left.clientName.localeCompare(right.clientName, "pt-BR"),
      );
    }
    if (sortMode === "client-desc") {
      return result.sort((left, right) =>
        right.clientName.localeCompare(left.clientName, "pt-BR"),
      );
    }
    if (sortMode === "premium-desc") {
      return result.sort(
        (left, right) =>
          premiumValue(right.premium) - premiumValue(left.premium),
      );
    }
    if (sortMode === "premium-asc") {
      return result.sort(
        (left, right) =>
          premiumValue(left.premium) - premiumValue(right.premium),
      );
    }
    return result;
  }, [deferredQuery, policies, premiumFilter, sortMode, status]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredPolicies.length / PAGE_SIZE),
  );
  const currentPage = clampPage(page, pageCount);
  const pagePolicies = filteredPolicies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pageStart =
    filteredPolicies.length > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredPolicies.length);
  const hasActiveFilters =
    query.trim().length > 0 ||
    status !== "all" ||
    premiumFilter !== "all" ||
    sortMode !== "default";

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from("[data-policy-metric]", {
          y: 24,
          scale: 0.96,
          opacity: 0,
          duration: 0.68,
          stagger: 0.08,
          clearProps: "transform,opacity",
        })
        .from(
          "[data-policy-progress]",
          {
            scaleX: 0,
            duration: 0.62,
            stagger: 0.06,
            transformOrigin: "left center",
            clearProps: "transform",
          },
          "-=0.34",
        );
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        "[data-policy-row]",
        { y: 12, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.38,
          stagger: 0.035,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: navigation,
      dependencies: [currentPage, deferredQuery, premiumFilter, sortMode, status],
      revertOnUpdate: true,
    },
  );

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setPremiumFilter("all");
    setSortMode("default");
    setPage(1);
  }

  function changeStatus(nextStatus: string) {
    setStatus(nextStatus);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    window.requestAnimationFrame(() => {
      document.getElementById("policy-list")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  function selectMetric(metric: MetricKey, shouldScroll: boolean) {
    setQuery("");
    setPage(1);

    if (metric === "inforce") {
      setStatus("INFORCE");
      setPremiumFilter("all");
      setSortMode("default");
    } else if (metric === "premium") {
      setStatus("all");
      setPremiumFilter("known");
      setSortMode("premium-desc");
    } else {
      setStatus("all");
      setPremiumFilter("all");
      setSortMode("default");
    }

    if (shouldScroll) {
      window.requestAnimationFrame(() => {
        navigation.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      });
    }
  }

  const metrics = [
    {
      key: "all" as const,
      label: "Apólices",
      value: COUNT.format(summary.total),
      detail: "Toda a carteira em uma única visão",
      progress: 100,
      progressLabel: "Carteira completa",
      action: "Ver todas",
    },
    {
      key: "inforce" as const,
      label: "Em vigor",
      value: COUNT.format(summary.inForce),
      detail: "Proteções ativas neste momento",
      progress: summary.total > 0 ? (summary.inForce / summary.total) * 100 : 0,
      progressLabel: `${summary.total > 0 ? Math.round((summary.inForce / summary.total) * 100) : 0}% da carteira`,
      action: "Filtrar ativas",
    },
    {
      key: "premium" as const,
      label: "Prêmio registrado",
      value: USD_WHOLE.format(summary.totalPremium),
      prefix: "US$",
      detail: "Valores nas frequências originais",
      progress:
        summary.total > 0 ? (summary.withPremium / summary.total) * 100 : 0,
      progressLabel:
        summary.withoutPremium > 0
          ? `${COUNT.format(summary.withPremium)} com valor · ${COUNT.format(summary.withoutPremium)} sem valor`
          : `${COUNT.format(summary.withPremium)} com valor informado`,
      action: "Ver por prêmio",
    },
  ];

  const activeMetric: MetricKey | null =
    status === "INFORCE" && premiumFilter === "all"
      ? "inforce"
      : status === "all" && premiumFilter === "known"
        ? "premium"
        : status === "all" &&
            premiumFilter === "all" &&
            query.trim() === "" &&
            sortMode === "default"
          ? "all"
          : null;

  return (
    <div ref={root}>
      {policies.length > 0 && (
        <nav
          className="policy-metrics-nav"
          aria-label="Atalhos da carteira de apólices"
        >
          {metrics.map((metric) => (
            <button
              key={metric.key}
              type="button"
              className="policy-metric-card"
              data-policy-metric
              data-active={activeMetric === metric.key || undefined}
              aria-pressed={activeMetric === metric.key}
              aria-controls="policy-results"
              onClick={(event) => selectMetric(metric.key, event.detail > 0)}
            >
              <span className="policy-metric-surface">
                <span className="policy-metric-heading">
                  <span>
                    <strong>{metric.label}</strong>
                    <small>{metric.detail}</small>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                  >
                    <path d="M5.5 14.5 14.5 5.5M7 5.5h7.5V13" />
                  </svg>
                </span>
                <span className="policy-metric-value">
                  {metric.prefix && <small>{metric.prefix}</small>}
                  <strong>{metric.value}</strong>
                </span>
                <span className="policy-metric-track" aria-hidden="true">
                  <i
                    data-policy-progress
                    style={{ width: `${Math.min(100, metric.progress)}%` }}
                  />
                </span>
                <span className="policy-metric-footer">
                  <small>{metric.progressLabel}</small>
                  <strong>{metric.action}</strong>
                </span>
              </span>
            </button>
          ))}
        </nav>
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          {policies.length === 0 ? (
            <div className="space-y-4">
              <EmptyState>
                Nenhuma apólice ainda. Apólices aparecem quando uma oportunidade chega à emissão ou por importação de histórico autorizada — elas não são criadas manualmente.
              </EmptyState>
              <div className="space-y-3">
                <Link
                  href="/agent/cases/new"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
                >
                  Iniciar atendimento
                </Link>
                <Link
                  href="/agent/illustrations/new"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-ink-muted hover:bg-panel"
                >
                  Criar primeira ilustração
                </Link>
              </div>
            </div>
          ) : (
            <div
              ref={navigation}
              id="policy-results"
              className="policy-results space-y-5"
            >
              <section
                aria-labelledby="policy-navigation-title"
                className="policy-command-deck"
              >
                <header className="policy-command-heading">
                  <div>
                    <h2 id="policy-navigation-title">
                      Encontre uma apólice em segundos.
                    </h2>
                    <p>Busque pelo cliente, contrato, seguradora ou produto.</p>
                  </div>
                  <p
                    className="policy-result-count"
                    role="status"
                    aria-live="polite"
                  >
                    <span>{pageStart}–{pageEnd}</span>
                    <small>
                      de {COUNT.format(filteredPolicies.length)}
                      {filteredPolicies.length !== policies.length &&
                        ` em ${COUNT.format(policies.length)}`}
                    </small>
                  </p>
                </header>

                <div className="policy-command-grid">
                  <label className="policy-command-search" htmlFor="policy-search">
                    <span>Buscar na carteira</span>
                    <span className="policy-search-field">
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                        <circle cx="8.6" cy="8.6" r="5.1" />
                        <path d="m12.5 12.5 4 4" />
                      </svg>
                      <input
                        id="policy-search"
                        type="search"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setPage(1);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" && query) {
                            setQuery("");
                            setPage(1);
                          }
                        }}
                        aria-controls="policy-list"
                        placeholder="Nome, número, seguradora ou produto"
                      />
                      {query && (
                        <button
                          type="button"
                          aria-label="Limpar busca"
                          onClick={() => {
                            setQuery("");
                            setPage(1);
                          }}
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
                            <path d="m4 4 8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      )}
                    </span>
                  </label>

                  <label className="policy-command-sort" htmlFor="policy-sort">
                    <span>Ordenar carteira</span>
                    <select
                      id="policy-sort"
                      value={sortMode}
                      onChange={(event) => {
                        setSortMode(event.target.value as SortMode);
                        setPage(1);
                      }}
                    >
                      <option value="default">Mais recentes</option>
                      <option value="client-asc">Cliente: A–Z</option>
                      <option value="client-desc">Cliente: Z–A</option>
                      <option value="premium-desc">Maior prêmio</option>
                      <option value="premium-asc">Menor prêmio</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="policy-command-clear"
                    onClick={clearFilters}
                    disabled={!hasActiveFilters}
                  >
                    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                      <path d="M4.2 5.7h9.6M7 5.7V4.1h4v1.6m-5.8 0 .6 8.2h6.4l.6-8.2M7.8 8v3.7M10.2 8v3.7" />
                    </svg>
                    Limpar
                  </button>
                </div>

                <div className="policy-status-filter">
                  <span>Status da apólice</span>
                  <div
                    className="policy-status-rail"
                    role="group"
                    aria-label="Filtrar por status"
                  >
                    <button
                      type="button"
                      aria-pressed={status === "all"}
                      aria-controls="policy-list"
                      onClick={() => changeStatus("all")}
                    >
                      <span>Todos</span>
                      <small>{COUNT.format(policies.length)}</small>
                    </button>
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={status === option.value}
                        aria-controls="policy-list"
                        onClick={() => changeStatus(option.value)}
                      >
                        <span>{option.label}</span>
                        <small>{COUNT.format(option.count)}</small>
                      </button>
                    ))}
                  </div>
                </div>

                {premiumFilter === "known" && (
                  <div className="policy-active-filter">
                    <span>Prêmio informado</span>
                    <button
                      type="button"
                      aria-label="Remover filtro de prêmio informado"
                      onClick={() => {
                        setPremiumFilter("all");
                        setPage(1);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </section>

      {filteredPolicies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-steel bg-panel/55 px-5 py-12 text-center">
          <p className="mx-auto max-w-md text-base font-semibold text-ink">
            Nenhuma apólice corresponde a esta busca.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
            Tente outro cliente, número, seguradora ou status.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <>
          <div id="policy-list" className="policy-list-frame">
            <div className="policy-list-header" aria-hidden="true">
              <span>Cliente e apólice</span>
              <span>Seguradora e produto</span>
              <span>Prêmio</span>
              <span>Status</span>
            </div>
            <ul className="policy-list">
              {pagePolicies.map((policy) => (
                <li key={policy.id}>
                  <Link
                    href={`/agent/policies/${policy.id}`}
                    className="policy-list-row"
                    data-policy-row
                    aria-label={`Abrir apólice ${policy.policyNumber} de ${policy.clientName}`}
                  >
                    <span className="policy-list-identity">
                      <strong>{policy.clientName}</strong>
                      <small>{policy.policyNumber}</small>
                    </span>
                    <span className="policy-list-market">
                      <strong>{policy.carrier}</strong>
                      <small>{policy.product}</small>
                    </span>
                    <span className="policy-list-premium">
                      <small>Prêmio</small>
                      <strong>{formatPremium(policy.premium)}</strong>
                    </span>
                    <span className="policy-list-action">
                      <PolicyStatusPill status={policy.status} />
                      <span className="policy-list-arrow" aria-hidden="true">
                        <svg viewBox="0 0 18 18" fill="none">
                          <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
                        </svg>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {pageCount > 1 && (
            <nav className="policy-pagination" aria-label="Paginação das apólices">
              <p>
                <strong>{pageStart}–{pageEnd}</strong>
                <span>de {COUNT.format(filteredPolicies.length)}</span>
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => changePage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  aria-label="Página anterior"
                >
                  <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                    <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                  </svg>
                </button>
                {paginationItems(currentPage, pageCount).map((item, index) =>
                  item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      aria-label={`Ir para a página ${item}`}
                      aria-current={item === currentPage ? "page" : undefined}
                      onClick={() => changePage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => changePage(currentPage + 1)}
                  disabled={currentPage >= pageCount}
                  aria-label="Próxima página"
                >
                  <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                    <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
                  </svg>
                </button>
              </div>
            </nav>
          )}
        </>
      )}
            </div>
          )}
        </section>
        <ContextPanel eyebrow="Continue por aqui" title="Carteira sob controle">
          <p>O status mostra a situação atual da apólice. O prêmio preserva o valor e a frequência informados pela seguradora.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Detalhes</p>
            <p className="mt-2">Selecione uma linha para abrir a apólice completa e seus documentos.</p>
          </div>
        </ContextPanel>
      </div>
    </div>
  );
}
