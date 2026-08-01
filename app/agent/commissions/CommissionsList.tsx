"use client";

import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

type CommissionType = "DIRECT" | "OVERRIDE";

type Record_ = {
  id: string;
  policyNumber: string | null;
  policyId: string | null;
  agentName: string;
  type: CommissionType;
  level: number;
  amount: string;
};

type PeriodGroup = { period: string; rows: Record_[] };
type OriginFilter = "all" | "direct" | "override";
type PeriodFilter = "all" | string;
type SortMode = "period-desc" | "period-asc" | "amount-desc" | "amount-asc";
type CommissionRecord = Record_ & { period: string; numericAmount: number };

const ROWS_PER_PAGE = 12;
const COUNT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const MONEY_NUMBER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PERIOD = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const PERIOD_LABEL_CACHE = new Map<string, string>();

function periodLabel(period: string) {
  if (period === "sem-periodo") return "Sem data informada";
  const cached = PERIOD_LABEL_CACHE.get(period);
  if (cached) return cached;

  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;

  const label = PERIOD.format(new Date(Date.UTC(year, month - 1, 1)));
  PERIOD_LABEL_CACHE.set(period, label);
  return label;
}

function paginationItems(page: number, pageCount: number) {
  const pages = Array.from(
    new Set(
      [1, page - 1, page, page + 1, pageCount].filter(
        (item) => item >= 1 && item <= pageCount,
      ),
    ),
  ).sort((left, right) => left - right);
  const items: Array<number | "ellipsis"> = [];

  pages.forEach((item, index) => {
    const previous = pages[index - 1];
    if (previous && item - previous > 1) items.push("ellipsis");
    items.push(item);
  });

  return items;
}

function MoneyValue({
  value,
  compact = false,
  inverse = false,
}: {
  value: number;
  compact?: boolean;
  inverse?: boolean;
}) {
  const [whole, fraction = "00"] = MONEY_NUMBER.format(Math.abs(value)).split(".");

  return (
    <span
      className="commission-money"
      data-compact={compact || undefined}
      data-inverse={inverse || undefined}
      data-negative={value < 0 || undefined}
      aria-label={`${value < 0 ? "menos " : ""}${Math.abs(value).toFixed(2)} dólares`}
    >
      <span>US$</span>
      <strong>{value < 0 ? `−${whole}` : whole}</strong>
      <small>.{fraction}</small>
    </span>
  );
}

export function CommissionsList({ byPeriod }: { byPeriod: PeriodGroup[] }) {
  const root = useRef<HTMLDivElement>(null);
  const listStart = useRef<HTMLElement>(null);
  const searchId = useId();
  const periodId = useId();
  const sortId = useId();
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("period-desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(
    byPeriod[0]?.rows[0]?.id ?? null,
  );
  const deferredQuery = useDeferredValue(query);

  const records = useMemo<CommissionRecord[]>(
    () =>
      byPeriod.flatMap(({ period, rows }) =>
        rows.map((record) => {
          const numericAmount = Number(record.amount);
          return {
            ...record,
            period,
            numericAmount: Number.isFinite(numericAmount) ? numericAmount : 0,
          };
        }),
      ),
    [byPeriod],
  );

  const summary = useMemo(() => {
    let direct = 0;
    let override = 0;
    let directCount = 0;
    let overrideCount = 0;

    for (const record of records) {
      if (record.type === "DIRECT") {
        direct += record.numericAmount;
        directCount += 1;
      } else {
        override += record.numericAmount;
        overrideCount += 1;
      }
    }

    return {
      total: direct + override,
      direct,
      override,
      directCount,
      overrideCount,
      periods: new Set(records.map((record) => record.period)).size,
    };
  }, [records]);

  const periodOptions = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.period))).sort(
        (left, right) => {
          if (left === "sem-periodo") return 1;
          if (right === "sem-periodo") return -1;
          return right.localeCompare(left);
        },
      ),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("pt-BR");

    const result = records.filter((record) => {
      const matchesOrigin =
        origin === "all" ||
        (origin === "direct"
          ? record.type === "DIRECT"
          : record.type === "OVERRIDE");
      const matchesPeriod =
        periodFilter === "all" || record.period === periodFilter;

      if (!matchesOrigin || !matchesPeriod) return false;
      if (!normalizedQuery) return true;

      return [
        record.policyNumber ?? "",
        record.agentName,
        periodLabel(record.period),
        record.type === "DIRECT" ? "direta" : "repasse equipe override",
        record.numericAmount.toFixed(2),
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery);
    });

    return result.sort((left, right) => {
      if (sortMode === "amount-desc") {
        return (
          right.numericAmount - left.numericAmount ||
          right.period.localeCompare(left.period)
        );
      }
      if (sortMode === "amount-asc") {
        return (
          left.numericAmount - right.numericAmount ||
          right.period.localeCompare(left.period)
        );
      }
      if (left.period !== right.period) {
        if (left.period === "sem-periodo") return 1;
        if (right.period === "sem-periodo") return -1;
      }
      if (sortMode === "period-asc") {
        return (
          left.period.localeCompare(right.period) ||
          right.numericAmount - left.numericAmount
        );
      }
      return (
        right.period.localeCompare(left.period) ||
        right.numericAmount - left.numericAmount
      );
    });
  }, [deferredQuery, origin, periodFilter, records, sortMode]);

  const filteredSummary = useMemo(() => {
    let total = 0;
    let direct = 0;
    let override = 0;
    const byPeriodMap = new Map<string, { count: number; total: number }>();

    for (const record of filteredRecords) {
      total += record.numericAmount;
      if (record.type === "DIRECT") direct += record.numericAmount;
      else override += record.numericAmount;

      const current = byPeriodMap.get(record.period) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total += record.numericAmount;
      byPeriodMap.set(record.period, current);
    }

    return { total, direct, override, byPeriod: byPeriodMap };
  }, [filteredRecords]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredRecords.length / ROWS_PER_PAGE),
  );
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const pageStart =
    filteredRecords.length > 0 ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0;
  const pageEnd = Math.min(
    currentPage * ROWS_PER_PAGE,
    filteredRecords.length,
  );
  const pageRecords = filteredRecords.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );
  const pageGroups = useMemo(() => {
    const groups: Array<{ period: string; rows: CommissionRecord[] }> = [];

    for (const record of pageRecords) {
      const current = groups[groups.length - 1];
      if (!current || current.period !== record.period) {
        groups.push({ period: record.period, rows: [record] });
      } else {
        current.rows.push(record);
      }
    }

    return groups;
  }, [pageRecords]);
  const selectedIndex = filteredRecords.findIndex(
    (record) => record.id === selectedId,
  );
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = filteredRecords[activeIndex] ?? null;
  const hasActiveControls =
    query.trim().length > 0 ||
    origin !== "all" ||
    periodFilter !== "all" ||
    sortMode !== "period-desc";
  const metricScale = Math.max(
    Math.abs(summary.total),
    Math.abs(summary.direct),
    Math.abs(summary.override),
    1,
  );

  useGSAP(
    () => {
      if (
        records.length === 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .from("[data-commission-metric]", {
          y: 22,
          scale: 0.975,
          opacity: 0,
          duration: 0.62,
          stagger: 0.07,
          clearProps: "transform,opacity",
        })
        .from(
          "[data-commission-control]",
          {
            y: 15,
            opacity: 0,
            duration: 0.48,
            stagger: 0.05,
            clearProps: "transform,opacity",
          },
          "-=0.3",
        )
        .from(
          "[data-commission-bar]",
          {
            scaleX: 0,
            duration: 0.72,
            stagger: 0.07,
            transformOrigin: "left center",
            clearProps: "transform",
          },
          "-=0.42",
        );
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (
        records.length === 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const rows = gsap.utils.toArray<HTMLElement>("[data-commission-row]");
      gsap.killTweensOf(rows);
      gsap.fromTo(
        rows,
        { y: 12, scale: 0.992, opacity: 0 },
        {
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 0.34,
          stagger: 0.026,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: root,
      dependencies: [
        currentPage,
        deferredQuery,
        origin,
        periodFilter,
        sortMode,
      ],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      if (
        !selected ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const preview = gsap.utils.toArray<HTMLElement>(
        "[data-commission-preview-body]",
      );
      gsap.killTweensOf(preview);
      gsap.fromTo(
        preview,
        { y: 9, opacity: 0.35 },
        {
          y: 0,
          opacity: 1,
          duration: 0.36,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: root,
      dependencies: [selected?.id],
      revertOnUpdate: true,
    },
  );

  function selectOrigin(nextOrigin: OriginFilter) {
    setOrigin(nextOrigin);
    setPage(1);
  }

  function resetFilters() {
    setQuery("");
    setOrigin("all");
    setPeriodFilter("all");
    setSortMode("period-desc");
    setPage(1);
  }

  function changePage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), pageCount);
    setPage(safePage);
    const firstRecord = filteredRecords[(safePage - 1) * ROWS_PER_PAGE];
    if (firstRecord) setSelectedId(firstRecord.id);
    window.requestAnimationFrame(() => {
      listStart.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function changeSelected(direction: -1 | 1) {
    if (filteredRecords.length === 0) return;
    const nextIndex =
      (activeIndex + direction + filteredRecords.length) % filteredRecords.length;
    const nextRecord = filteredRecords[nextIndex];
    setSelectedId(nextRecord.id);
    setPage(Math.floor(nextIndex / ROWS_PER_PAGE) + 1);
  }

  const metricItems = [
    {
      key: "all" as const,
      label: "Saldo do extrato",
      detail: `${COUNT.format(records.length)} lançamentos em ${COUNT.format(summary.periods)} período${summary.periods === 1 ? "" : "s"}`,
      value: summary.total,
      fill: Math.abs(summary.total) / metricScale,
    },
    {
      key: "direct" as const,
      label: "Produção direta",
      detail: `${COUNT.format(summary.directCount)} lançamentos da sua produção`,
      value: summary.direct,
      fill: Math.abs(summary.direct) / metricScale,
    },
    {
      key: "override" as const,
      label: "Repasses da equipe",
      detail: `${COUNT.format(summary.overrideCount)} repasses da sua hierarquia`,
      value: summary.override,
      fill: Math.abs(summary.override) / metricScale,
    },
  ];

  return (
    <div ref={root} className="commissions-workspace">
      {records.length > 0 ? (
        <>
          <section className="commission-metrics" aria-label="Resumo do extrato">
            {metricItems.map((item) => (
              <button
                key={item.key}
                type="button"
                data-commission-metric
                data-tone={item.key}
                data-active={origin === item.key || undefined}
                aria-pressed={origin === item.key}
                onClick={() => selectOrigin(item.key)}
              >
                <span className="commission-metric-heading">
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <path d="M5 10h10M11 6l4 4-4 4" />
                  </svg>
                </span>
                <MoneyValue value={item.value} />
                <span className="commission-metric-track" aria-hidden="true">
                  <i
                    data-commission-bar
                    style={{ width: `${Math.max(item.fill * 100, 3)}%` }}
                  />
                </span>
              </button>
            ))}
          </section>

          <section className="commission-command-deck" data-commission-control>
            <header className="commission-command-heading">
              <div>
                <h2>Encontre cada valor sem perder a origem.</h2>
                <p>
                  Busque por apólice ou agente, selecione o período e compare
                  produção direta com repasses.
                </p>
              </div>
              <div className="commission-command-balance" aria-live="polite">
                <span>Saldo desta visão</span>
                <MoneyValue value={filteredSummary.total} compact />
                <small>
                  {COUNT.format(filteredRecords.length)} {filteredRecords.length === 1 ? "lançamento" : "lançamentos"}
                </small>
              </div>
            </header>

            <div className="commission-command-grid">
              <label htmlFor={searchId} className="commission-search-control">
                <span>Buscar no extrato</span>
                <span className="commission-search-field">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <circle cx="8.7" cy="8.7" r="4.8" />
                    <path d="m12.2 12.2 3.3 3.3" />
                  </svg>
                  <input
                    id={searchId}
                    type="search"
                    value={query}
                    aria-controls="commission-results"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setQuery("");
                    }}
                    placeholder="Apólice, agente, período ou valor"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Limpar busca"
                      onClick={() => {
                        setQuery("");
                        setPage(1);
                      }}
                    >
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="m5.5 5.5 7 7M12.5 5.5l-7 7" />
                      </svg>
                    </button>
                  ) : null}
                </span>
              </label>

              <label htmlFor={periodId} className="commission-select-control">
                <span>Período</span>
                <select
                  id={periodId}
                  value={periodFilter}
                  onChange={(event) => {
                    setPeriodFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Todos os períodos</option>
                  {periodOptions.map((period) => (
                    <option key={period} value={period}>
                      {periodLabel(period)}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor={sortId} className="commission-select-control">
                <span>Ordenar</span>
                <select
                  id={sortId}
                  value={sortMode}
                  onChange={(event) => {
                    setSortMode(event.target.value as SortMode);
                    setPage(1);
                  }}
                >
                  <option value="period-desc">Mais recentes</option>
                  <option value="period-asc">Mais antigos</option>
                  <option value="amount-desc">Maior valor</option>
                  <option value="amount-asc">Menor valor</option>
                </select>
              </label>
            </div>

            <fieldset className="commission-origin-accordion">
              <legend>Origem do lançamento</legend>
              <div>
                {(
                  [
                    ["all", "Todos", records.length, summary.total],
                    ["direct", "Direta", summary.directCount, summary.direct],
                    ["override", "Equipe", summary.overrideCount, summary.override],
                  ] as const
                ).map(([value, label, count, amount]) => (
                  <button
                    key={value}
                    type="button"
                    data-active={origin === value || undefined}
                    aria-pressed={origin === value}
                    onClick={() => selectOrigin(value)}
                  >
                    <span>{label}</span>
                    <small>{COUNT.format(count)}</small>
                    <strong>US$ {MONEY_NUMBER.format(amount)}</strong>
                  </button>
                ))}
              </div>
            </fieldset>

            {hasActiveControls ? (
              <button
                type="button"
                className="commission-clear-controls"
                onClick={resetFilters}
              >
                Limpar filtros
                <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                  <path d="m5.5 5.5 7 7M12.5 5.5l-7 7" />
                </svg>
              </button>
            ) : null}
          </section>

          <div className="commission-browser" data-commission-control>
            <aside className="commission-preview" aria-label="Lançamento selecionado">
              {selected ? (
                <div data-commission-preview-body>
                  <header>
                    <span>Lançamento selecionado</span>
                    <div>
                      <button
                        type="button"
                        aria-label="Lançamento anterior"
                        onClick={() => changeSelected(-1)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                          <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Próximo lançamento"
                        onClick={() => changeSelected(1)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                          <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
                        </svg>
                      </button>
                    </div>
                  </header>

                  <div className="commission-preview-index">
                    <span>
                      {COUNT.format(activeIndex + 1)} de {COUNT.format(filteredRecords.length)}
                    </span>
                    <i />
                  </div>

                  <MoneyValue value={selected.numericAmount} inverse />
                  <p className="commission-preview-caption">
                    {selected.numericAmount < 0
                      ? "Valor negativo registrado no extrato"
                      : selected.type === "DIRECT"
                        ? "Comissão da sua produção direta"
                        : "Repasse gerado pela produção da equipe"}
                  </p>

                  <dl>
                    <div>
                      <dt>Período</dt>
                      <dd>{periodLabel(selected.period)}</dd>
                    </div>
                    <div>
                      <dt>Apólice</dt>
                      <dd>{selected.policyNumber ?? "Não informada"}</dd>
                    </div>
                    <div>
                      <dt>Agente de origem</dt>
                      <dd>{selected.agentName}</dd>
                    </div>
                    <div>
                      <dt>Origem</dt>
                      <dd>
                        {selected.type === "DIRECT"
                          ? "Produção direta"
                          : `Repasse · nível ${selected.level}`}
                      </dd>
                    </div>
                  </dl>

                  {selected.policyId ? (
                    <Link href={`/agent/policies/${selected.policyId}`}>
                      Abrir apólice
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="M5 13 13 5M7 5h6v6" />
                      </svg>
                    </Link>
                  ) : (
                    <p className="commission-preview-note">
                      Esta apólice não está na carteira atual, mas o número foi
                      preservado para conferência.
                    </p>
                  )}
                </div>
              ) : null}
            </aside>

            <section
              ref={listStart}
              id="commission-results"
              className="commission-results"
              aria-labelledby="commission-results-title"
              tabIndex={-1}
            >
              <header className="commission-results-heading">
                <div>
                  <h2 id="commission-results-title">Lançamentos</h2>
                  <p>Selecione uma linha para conferir todos os detalhes.</p>
                </div>
                <p aria-live="polite">
                  <strong>{pageStart}–{pageEnd}</strong>
                  <span>de {COUNT.format(filteredRecords.length)}</span>
                </p>
              </header>

              {pageRecords.length > 0 ? (
                <div className="commission-periods">
                  {pageGroups.map((group) => {
                    const periodSummary = filteredSummary.byPeriod.get(group.period);

                    return (
                      <section key={group.period} className="commission-period-group">
                        <header>
                          <div>
                            <time dateTime={group.period}>{periodLabel(group.period)}</time>
                            <span>
                              {COUNT.format(periodSummary?.count ?? group.rows.length)} {periodSummary?.count === 1 ? "lançamento" : "lançamentos"}
                            </span>
                          </div>
                          <div>
                            <span>Subtotal do período</span>
                            <MoneyValue value={periodSummary?.total ?? 0} compact />
                          </div>
                        </header>

                        <ul>
                          {group.rows.map((record) => (
                            <li key={record.id} data-commission-row>
                              <button
                                type="button"
                                data-active={selected?.id === record.id || undefined}
                                aria-pressed={selected?.id === record.id}
                                aria-label={`Ver lançamento da apólice ${record.policyNumber ?? "não informada"}, ${MONEY_NUMBER.format(record.numericAmount)} dólares`}
                                onClick={() => setSelectedId(record.id)}
                              >
                                <span className="commission-row-policy">
                                  <small>Apólice</small>
                                  <strong>{record.policyNumber ?? "Não informada"}</strong>
                                </span>
                                <span className="commission-row-agent">
                                  <small>Agente de origem</small>
                                  <strong>{record.agentName}</strong>
                                </span>
                                <span
                                  className="commission-row-origin"
                                  data-type={record.type}
                                  data-negative={record.numericAmount < 0 || undefined}
                                >
                                  <i />
                                  {record.numericAmount < 0
                                    ? "Valor negativo"
                                    : record.type === "DIRECT"
                                      ? "Direta"
                                      : `Repasse · N${record.level}`}
                                </span>
                                <MoneyValue value={record.numericAmount} compact />
                                <span className="commission-row-arrow" aria-hidden="true">
                                  <svg viewBox="0 0 18 18" fill="none">
                                    <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
                                  </svg>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="commission-empty-state">
                  <span aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <h3>Nenhum lançamento nesta visão.</h3>
                  <p>
                    Ajuste a busca ou volte ao extrato completo para continuar a
                    conferência.
                  </p>
                  <button type="button" onClick={resetFilters}>
                    Limpar filtros
                  </button>
                </div>
              )}

              {pageCount > 1 ? (
                <nav className="commission-pagination" aria-label="Paginação dos lançamentos">
                  <p>
                    <strong>{pageStart}–{pageEnd}</strong>
                    <span>de {COUNT.format(filteredRecords.length)}</span>
                  </p>
                  <div>
                    <button
                      type="button"
                      aria-label="Página anterior"
                      disabled={currentPage <= 1}
                      onClick={() => changePage(currentPage - 1)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                      </svg>
                    </button>
                    {paginationItems(currentPage, pageCount).map((item, index) =>
                      item === "ellipsis" ? (
                        <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
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
                      aria-label="Próxima página"
                      disabled={currentPage >= pageCount}
                      onClick={() => changePage(currentPage + 1)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="m7.5 5.5 3.5 3.5-3.5 3.5" />
                      </svg>
                    </button>
                  </div>
                </nav>
              ) : null}
            </section>
          </div>

          <aside className="commission-footnote">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 8.5v4M10 6.2v.2" />
            </svg>
            <p>
              Valores em dólares americanos. Lançamentos negativos reduzem o
              saldo da visão; produção direta e repasses seguem a classificação
              recebida da operação.
            </p>
          </aside>
        </>
      ) : (
        <section className="commission-empty-state commission-empty-state--page">
          <span aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <h2>Seu extrato começa com a primeira comissão.</h2>
          <p>
            Quando os lançamentos forem importados, você poderá conferir valor,
            origem e apólice neste espaço.
          </p>
          <Link href="/agent/policies">Ver apólices</Link>
        </section>
      )}
    </div>
  );
}
