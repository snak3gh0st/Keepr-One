"use client";

import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { buildCommissionAgentBreakdown } from "@/lib/commission-attribution";

type CommissionType = "DIRECT" | "OVERRIDE";

type Record_ = {
  id: string;
  policyNumber: string | null;
  policyId: string | null;
  agentName: string;
  agentNumber: string | null;
  payeeName: string | null;
  payeeNumber: string | null;
  agencyName: string | null;
  source: "NATIONAL_LIFE" | "KEEPRONE";
  type: CommissionType;
  level: number;
  amount: string;
};

type PeriodGroup = { period: string; rows: Record_[] };
type OriginFilter = "all" | "direct" | "override";
type PeriodFilter = "all" | string;
type SortMode = "period-desc" | "period-asc" | "amount-desc" | "amount-asc";
type CommissionRecord = Record_ & { period: string; numericAmount: number };
type CommissionAudit = {
  partial: boolean;
  rejectedCount: number;
  duplicateCount: number;
};

const ROWS_PER_PAGE = 12;
function periodLabel(period: string, locale: string, noDateLabel: string) {
  if (period === "sem-periodo") return noDateLabel;
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
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
  const { copy, locale } = useI18n();
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Math.abs(value));
  const whole = formatted
    .filter((part) => part.type === "integer" || part.type === "group")
    .map((part) => part.value)
    .join("");
  const fraction = formatted.find((part) => part.type === "fraction")?.value ?? "00";
  const decimal = formatted.find((part) => part.type === "decimal")?.value ?? ".";

  return (
    <span
      className="commission-money"
      data-compact={compact || undefined}
      data-inverse={inverse || undefined}
      data-negative={value < 0 || undefined}
      aria-label={copy(
        `${value < 0 ? "menos " : ""}{amount} dólares`,
        `${value < 0 ? "minus " : ""}{amount} dollars`,
        { amount: Math.abs(value).toFixed(2) },
      )}
    >
      <span>US$</span>
      <strong>{value < 0 ? `−${whole}` : whole}</strong>
      <small>{decimal}{fraction}</small>
    </span>
  );
}

export function CommissionsList({
  byPeriod,
  audit,
}: {
  byPeriod: PeriodGroup[];
  audit: CommissionAudit;
}) {
  const { copy, locale } = useI18n();
  const count = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const moneyNumber = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale],
  );
  const formatPeriod = useCallback(
    (period: string) =>
      periodLabel(period, locale, copy("Sem data informada", "Date not provided")),
    [copy, locale],
  );
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
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase(locale);

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
        record.agentNumber ?? "",
        record.payeeName ?? "",
        record.payeeNumber ?? "",
        record.agencyName ?? "",
        formatPeriod(record.period),
        record.type === "DIRECT"
          ? copy("direta", "direct")
          : copy("agência override", "agency override"),
        record.numericAmount.toFixed(2),
      ]
        .join(" ")
        .toLocaleLowerCase(locale)
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
  }, [copy, deferredQuery, formatPeriod, locale, origin, periodFilter, records, sortMode]);

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

  const agentBreakdown = useMemo(
    () => buildCommissionAgentBreakdown(filteredRecords.map((record) => ({
      agentName: record.agentName,
      agentNumber: record.agentNumber,
      type: record.type,
      amount: record.numericAmount,
    }))),
    [filteredRecords],
  );

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
      label: audit.partial
        ? copy("Subtotal auditado", "Audited subtotal")
        : copy("Total do extrato", "Statement total"),
      detail: copy(
        "{entries} lançamentos em {periods} {periodLabel}",
        "{entries} entries across {periods} {periodLabel}",
        {
          entries: count.format(records.length),
          periods: count.format(summary.periods),
          periodLabel: summary.periods === 1 ? copy("período", "period") : copy("períodos", "periods"),
        },
      ),
      value: summary.total,
      fill: Math.abs(summary.total) / metricScale,
    },
    {
      key: "direct" as const,
      label: copy("Produção direta", "Direct production"),
      detail: copy(
        "{count} lançamentos Personal da National",
        "{count} National Life Personal entries",
        { count: count.format(summary.directCount) },
      ),
      value: summary.direct,
      fill: Math.abs(summary.direct) / metricScale,
    },
    {
      key: "override" as const,
      label: copy("Agência · Override", "Agency · Override"),
      detail: copy(
        "{count} lançamentos Override da National",
        "{count} National Life Override entries",
        { count: count.format(summary.overrideCount) },
      ),
      value: summary.override,
      fill: Math.abs(summary.override) / metricScale,
    },
  ];

  return (
    <div ref={root} className="commissions-workspace">
      {records.length > 0 ? (
        <>
          {audit.partial ? (
            <aside className="commission-audit-warning" role="status">
              <strong>{copy("Extrato parcial, sem estimativas", "Partial statement, with no estimates")}</strong>
              <p>
                {copy(
                  "{rejected} lançamento(s) sem evidência completa ficaram fora dos valores. {duplicates} cópia(s) de sincronização também foram removidas. O demonstrativo abaixo contém somente linhas atribuíveis e auditáveis da National Life.",
                  "{rejected} entry or entries without complete evidence were excluded. {duplicates} sync copies were also removed. The statement below contains only attributable, auditable National Life rows.",
                  {
                    rejected: count.format(audit.rejectedCount),
                    duplicates: count.format(audit.duplicateCount),
                  },
                )}
              </p>
            </aside>
          ) : null}

          <section className="commission-metrics" aria-label={copy("Resumo do extrato", "Statement summary")}>
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

          <section className="commission-agent-statement" aria-labelledby="commission-agent-statement-title">
            <header>
              <div>
                <span>{copy("Rastreabilidade National Life", "National Life traceability")}</span>
                <h2 id="commission-agent-statement-title">{copy("Demonstrativo por agente", "Statement by agent")}</h2>
                <p>
                  {copy(
                    "Cada linha usa o número do agente produtor informado pela National. Direta corresponde a Personal; agência corresponde a Override recebido sobre a produção daquele agente.",
                    "Each row uses the writing-agent number reported by National Life. Direct means Personal; agency means an Override received from that agent's production.",
                  )}
                </p>
              </div>
              <small>
                {count.format(agentBreakdown.length)} {agentBreakdown.length === 1
                  ? copy("agente nesta visão", "agent in this view")
                  : copy("agentes nesta visão", "agents in this view")}
              </small>
            </header>
            <div className="commission-agent-table" role="table" aria-label={copy("Valores diretos e de agência por agente", "Direct and agency values by agent")}>
              <div className="commission-agent-table-head" role="row">
                <span role="columnheader">{copy("Agente produtor", "Writing agent")}</span>
                <span role="columnheader">{copy("Direta · Personal", "Direct · Personal")}</span>
                <span role="columnheader">{copy("Agência · Override", "Agency · Override")}</span>
                <span role="columnheader">{copy("Total atribuído", "Attributed total")}</span>
              </div>
              <div className="commission-agent-table-body" role="rowgroup">
                {agentBreakdown.map((row) => (
                  <div key={row.key} className="commission-agent-table-row" role="row">
                    <span className="commission-agent-identity" role="cell">
                      <strong>{row.agentName === "Not provided" ? copy("Nome não informado", "Name not provided") : row.agentName}</strong>
                      <small>{row.agentNumber ? copy("Agente #{number}", "Agent #{number}", { number: row.agentNumber }) : copy("Número não informado", "Number not provided")}</small>
                    </span>
                    <span role="cell">
                      <strong>US$ {moneyNumber.format(row.directAmount)}</strong>
                      <small>{count.format(row.directCount)} {copy("lanç.", "entries")}</small>
                    </span>
                    <span role="cell">
                      <strong>US$ {moneyNumber.format(row.overrideAmount)}</strong>
                      <small>{count.format(row.overrideCount)} {copy("lanç.", "entries")}</small>
                    </span>
                    <span className="commission-agent-total" role="cell">
                      US$ {moneyNumber.format(row.totalAmount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="commission-command-deck" data-commission-control>
            <header className="commission-command-heading">
              <div>
                <h2>{copy("Encontre cada valor sem perder a origem.", "Find every amount without losing its source.")}</h2>
                <p>
                  {copy(
                    "Busque por apólice, produtor ou recebedor e compare direta Personal com agência Override.",
                    "Search by policy, writing agent, or payee and compare Personal direct with agency Override.",
                  )}
                </p>
              </div>
              <div className="commission-command-balance" aria-live="polite">
                <span>{copy("Saldo desta visão", "Balance in this view")}</span>
                <MoneyValue value={filteredSummary.total} compact />
                <small>
                  {count.format(filteredRecords.length)} {filteredRecords.length === 1
                    ? copy("lançamento", "entry")
                    : copy("lançamentos", "entries")}
                </small>
              </div>
            </header>

            <div className="commission-command-grid">
              <label htmlFor={searchId} className="commission-search-control">
                <span>{copy("Buscar no extrato", "Search statement")}</span>
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
                    placeholder={copy("Apólice, agente, período ou valor", "Policy, agent, period, or amount")}
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label={copy("Limpar busca", "Clear search")}
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
                <span>{copy("Período", "Period")}</span>
                <select
                  id={periodId}
                  value={periodFilter}
                  onChange={(event) => {
                    setPeriodFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">{copy("Todos os períodos", "All periods")}</option>
                  {periodOptions.map((period) => (
                    <option key={period} value={period}>
                      {formatPeriod(period)}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor={sortId} className="commission-select-control">
                <span>{copy("Ordenar", "Sort")}</span>
                <select
                  id={sortId}
                  value={sortMode}
                  onChange={(event) => {
                    setSortMode(event.target.value as SortMode);
                    setPage(1);
                  }}
                >
                  <option value="period-desc">{copy("Mais recentes", "Newest")}</option>
                  <option value="period-asc">{copy("Mais antigos", "Oldest")}</option>
                  <option value="amount-desc">{copy("Maior valor", "Highest amount")}</option>
                  <option value="amount-asc">{copy("Menor valor", "Lowest amount")}</option>
                </select>
              </label>
            </div>

            <fieldset className="commission-origin-accordion">
              <legend>{copy("Origem do lançamento", "Entry source")}</legend>
              <div>
                {(
                  [
                    ["all", copy("Todos", "All"), records.length, summary.total],
                    ["direct", copy("Direta", "Direct"), summary.directCount, summary.direct],
                    ["override", copy("Agência", "Agency"), summary.overrideCount, summary.override],
                  ] as const
                ).map(([value, label, entryCount, amount]) => (
                  <button
                    key={value}
                    type="button"
                    data-active={origin === value || undefined}
                    aria-pressed={origin === value}
                    onClick={() => selectOrigin(value)}
                  >
                    <span>{label}</span>
                    <small>{count.format(entryCount)}</small>
                    <strong>US$ {moneyNumber.format(amount)}</strong>
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
                {copy("Limpar filtros", "Clear filters")}
                <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                  <path d="m5.5 5.5 7 7M12.5 5.5l-7 7" />
                </svg>
              </button>
            ) : null}
          </section>

          <div className="commission-browser" data-commission-control>
            <aside className="commission-preview" aria-label={copy("Lançamento selecionado", "Selected entry")}>
              {selected ? (
                <div data-commission-preview-body>
                  <header>
                    <span>{copy("Lançamento selecionado", "Selected entry")}</span>
                    <div>
                      <button
                        type="button"
                        aria-label={copy("Lançamento anterior", "Previous entry")}
                        onClick={() => changeSelected(-1)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                          <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label={copy("Próximo lançamento", "Next entry")}
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
                      {count.format(activeIndex + 1)} {copy("de", "of")} {count.format(filteredRecords.length)}
                    </span>
                    <i />
                  </div>

                  <MoneyValue value={selected.numericAmount} inverse />
                  <p className="commission-preview-caption">
                    {selected.numericAmount < 0
                      ? copy("Valor negativo registrado no extrato", "Negative amount recorded in the statement")
                      : selected.type === "DIRECT"
                        ? copy("Comissão direta classificada como Personal pela National", "Direct commission classified as Personal by National Life")
                        : copy("Comissão da agência classificada como Override pela National", "Agency commission classified as Override by National Life")}
                  </p>

                  <dl>
                    <div>
                      <dt>{copy("Período", "Period")}</dt>
                      <dd>{formatPeriod(selected.period)}</dd>
                    </div>
                    <div>
                      <dt>{copy("Apólice", "Policy")}</dt>
                      <dd>{selected.policyNumber ?? copy("Não informada", "Not provided")}</dd>
                    </div>
                    <div>
                      <dt>{copy("Agente produtor", "Writing agent")}</dt>
                      <dd>
                        {selected.agentName}
                        {selected.agentNumber ? ` · #${selected.agentNumber}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>{copy("Classificação National", "National Life classification")}</dt>
                      <dd>
                        {selected.type === "DIRECT"
                          ? copy("Direta · Personal", "Direct · Personal")
                          : copy("Agência · Override", "Agency · Override")}
                      </dd>
                    </div>
                    <div>
                      <dt>{copy("Recebedor", "Payee")}</dt>
                      <dd>
                        {selected.payeeName ?? copy("Não informado", "Not provided")}
                        {selected.payeeNumber ? ` · #${selected.payeeNumber}` : ""}
                      </dd>
                    </div>
                    {selected.agencyName ? (
                      <div>
                        <dt>{copy("Agência informada", "Reported agency")}</dt>
                        <dd>{selected.agencyName}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{copy("Fonte", "Source")}</dt>
                      <dd>{selected.source === "NATIONAL_LIFE" ? "National Life" : "KeeprOne"}</dd>
                    </div>
                  </dl>

                  {selected.policyId ? (
                    <Link href={`/agent/policies/${selected.policyId}`}>
                      {copy("Abrir apólice", "Open policy")}
                      <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                        <path d="M5 13 13 5M7 5h6v6" />
                      </svg>
                    </Link>
                  ) : (
                    <p className="commission-preview-note">
                      {copy(
                        "Esta apólice não está na carteira atual, mas o número foi preservado para conferência.",
                        "This policy is not in the current book, but its number was preserved for reconciliation.",
                      )}
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
                  <h2 id="commission-results-title">{copy("Lançamentos", "Entries")}</h2>
                  <p>{copy("Selecione uma linha para conferir todos os detalhes.", "Select a row to review all details.")}</p>
                </div>
                <p aria-live="polite">
                  <strong>{pageStart}–{pageEnd}</strong>
                  <span>{copy("de", "of")} {count.format(filteredRecords.length)}</span>
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
                            <time dateTime={group.period}>{formatPeriod(group.period)}</time>
                            <span>
                              {count.format(periodSummary?.count ?? group.rows.length)} {periodSummary?.count === 1
                                ? copy("lançamento", "entry")
                                : copy("lançamentos", "entries")}
                            </span>
                          </div>
                          <div>
                            <span>{copy("Subtotal do período", "Period subtotal")}</span>
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
                                aria-label={copy(
                                  "Ver lançamento da apólice {policy}, {amount} dólares",
                                  "View entry for policy {policy}, {amount} dollars",
                                  {
                                    policy: record.policyNumber ?? copy("não informada", "not provided"),
                                    amount: moneyNumber.format(record.numericAmount),
                                  },
                                )}
                                onClick={() => setSelectedId(record.id)}
                              >
                                <span className="commission-row-policy">
                                  <small>{copy("Apólice", "Policy")}</small>
                                  <strong>{record.policyNumber ?? copy("Não informada", "Not provided")}</strong>
                                </span>
                                <span className="commission-row-agent">
                                  <small>{copy("Agente produtor", "Writing agent")}</small>
                                  <strong>{record.agentName}</strong>
                                  {record.agentNumber ? <small>#{record.agentNumber}</small> : null}
                                </span>
                                <span
                                  className="commission-row-origin"
                                  data-type={record.type}
                                  data-negative={record.numericAmount < 0 || undefined}
                                >
                                  <i />
                                  {record.numericAmount < 0
                                    ? copy("Valor negativo", "Negative amount")
                                    : record.type === "DIRECT"
                                      ? copy("Direta · Personal", "Direct · Personal")
                                      : copy("Agência · Override", "Agency · Override")}
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
                  <h3>{copy("Nenhum lançamento nesta visão.", "No entries in this view.")}</h3>
                  <p>
                    {copy(
                      "Ajuste a busca ou volte ao extrato completo para continuar a conferência.",
                      "Adjust your search or return to the full statement to continue reconciling.",
                    )}
                  </p>
                  <button type="button" onClick={resetFilters}>
                    {copy("Limpar filtros", "Clear filters")}
                  </button>
                </div>
              )}

              {pageCount > 1 ? (
                <nav className="commission-pagination" aria-label={copy("Paginação dos lançamentos", "Entry pagination")}>
                  <p>
                    <strong>{pageStart}–{pageEnd}</strong>
                    <span>{copy("de", "of")} {count.format(filteredRecords.length)}</span>
                  </p>
                  <div>
                    <button
                      type="button"
                      aria-label={copy("Página anterior", "Previous page")}
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
                          aria-label={copy("Ir para a página {page}", "Go to page {page}", { page: item })}
                          aria-current={item === currentPage ? "page" : undefined}
                          onClick={() => changePage(item)}
                        >
                          {item}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      aria-label={copy("Próxima página", "Next page")}
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
              {copy(
                "Valores em dólares americanos. O agente produtor, o recebedor e a classificação Personal/Override vêm do extrato da National Life; o KeeprOne não presume vínculo por semelhança de nome.",
                "Amounts are in U.S. dollars. The writing agent, payee, and Personal/Override classification come from the National Life statement; KeeprOne does not infer identity from similar names.",
              )}
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
          <h2>{copy("Seu extrato começa com a primeira comissão.", "Your statement begins with the first commission.")}</h2>
          <p>
            {copy(
              "Quando os lançamentos forem importados, você poderá conferir valor, origem e apólice neste espaço.",
              "Once entries are imported, you can review the amount, source, and policy here.",
            )}
          </p>
          <Link href="/agent/policies">{copy("Ver apólices", "View policies")}</Link>
        </section>
      )}
    </div>
  );
}
