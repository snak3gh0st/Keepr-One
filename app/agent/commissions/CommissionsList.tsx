"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import { Pagination, clampPage } from "@/components/Pagination";

type Record_ = {
  id: string;
  policyNumber: string | null;
  policyId: string | null;
  agentName: string;
  typeLabel: string;
  level: number;
  amount: string;
};

type PeriodGroup = { period: string; rows: Record_[]; subtotal: string };

type OriginFilter = "all" | "direct" | "override";
type SortMode = "period-desc" | "period-asc" | "amount-desc" | "amount-asc";
type CommissionRecord = Record_ & { period: string; numericAmount: number };

const ROWS_PER_PAGE = 12;
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const PERIOD = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function periodLabel(period: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;

  return PERIOD.format(new Date(Date.UTC(year, month - 1, 1)));
}

export function CommissionsList({ byPeriod }: { byPeriod: PeriodGroup[] }) {
  const searchId = useId();
  const sortId = useId();
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("period-desc");
  const [page, setPage] = useState(1);

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

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    const result = records.filter((record) => {
      const matchesOrigin =
        origin === "all" ||
        (origin === "direct" ? record.level === 0 : record.level > 0);
      if (!matchesOrigin) return false;
      if (!normalizedQuery) return true;

      return [record.policyNumber ?? "", record.agentName]
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
  }, [origin, query, records, sortMode]);

  const total = filteredRecords.reduce(
    (sum, record) => sum + record.numericAmount,
    0,
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredRecords.length / ROWS_PER_PAGE),
  );
  const currentPage = clampPage(page, pageCount);
  const pageRecords = filteredRecords.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE,
  );

  function resetFilters() {
    setQuery("");
    setOrigin("all");
    setSortMode("period-desc");
    setPage(1);
  }

  if (records.length === 0) {
    return <EmptyState>Nenhuma comissão registrada ainda.</EmptyState>;
  }

  return (
    <section
      aria-labelledby="commissions-list-title"
      className="overflow-hidden rounded-[1.5rem] border border-border-steel bg-paper/90 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-col gap-4 border-b border-border-steel px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <h2
            id="commissions-list-title"
            className="text-xl font-semibold tracking-[-0.025em] text-ink"
          >
            Lançamentos
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Encontre vendas diretas e repasses sem perder o histórico.
          </p>
        </div>
        <div
          aria-live="polite"
          className="flex shrink-0 items-baseline gap-3 sm:text-right"
        >
          <strong className="font-mono text-2xl font-semibold tabular-nums text-ink">
            {USD.format(total)}
          </strong>
          <span className="text-xs font-medium text-ink-muted">
            {filteredRecords.length}{" "}
            {filteredRecords.length === 1 ? "lançamento" : "lançamentos"}
          </span>
        </div>
      </div>

      <div className="grid grid-flow-dense gap-4 border-b border-border-steel bg-panel/55 px-5 py-5 lg:grid-cols-12 lg:px-6">
        <label
          htmlFor={searchId}
          className="flex min-w-0 flex-col gap-2 lg:col-span-6"
        >
          <span className="text-xs font-semibold text-ink-muted">
            Buscar lançamento
          </span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Apólice ou agente"
            className="min-h-11 w-full rounded-xl border border-border-steel bg-paper px-3.5 text-sm text-ink placeholder:text-ink-muted hover:border-teal/60 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          />
        </label>

        <fieldset className="min-w-0 lg:col-span-3">
          <legend className="mb-2 text-xs font-semibold text-ink-muted">
            Origem
          </legend>
          <div className="grid grid-cols-3 rounded-xl border border-border-steel bg-paper p-1">
            {(
              [
                ["all", "Todas"],
                ["direct", "Direta"],
                ["override", "Repasse"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={origin === value}
                onClick={() => {
                  setOrigin(value);
                  setPage(1);
                }}
                className={`min-h-9 rounded-lg px-2 text-xs font-semibold transition-[background-color,color,transform] focus-visible:outline-none ${
                  origin === value
                    ? "bg-rail-strong text-paper shadow-sm"
                    : "text-ink-muted hover:bg-teal-pale/60 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label
          htmlFor={sortId}
          className="flex min-w-0 flex-col gap-2 lg:col-span-3"
        >
          <span className="text-xs font-semibold text-ink-muted">
            Ordenar por
          </span>
          <select
            id={sortId}
            value={sortMode}
            onChange={(event) => {
              setSortMode(event.target.value as SortMode);
              setPage(1);
            }}
            className="min-h-11 w-full rounded-xl border border-border-steel bg-paper px-3.5 text-sm font-medium text-ink hover:border-teal/60 focus-visible:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          >
            <option value="period-desc">Período: mais recente</option>
            <option value="period-asc">Período: mais antigo</option>
            <option value="amount-desc">Valor: maior primeiro</option>
            <option value="amount-asc">Valor: menor primeiro</option>
          </select>
        </label>
      </div>

      <div className="p-4 sm:p-5">
        {pageRecords.length > 0 ? (
          <>
            <EntityCardList>
              {pageRecords.map((record, index) => (
                <EntityCard
                  key={record.id}
                  index={index}
                  className="flex-wrap gap-y-3 sm:flex-nowrap"
                >
                  <div className="min-w-[12rem] flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {record.policyId ? (
                        <Link
                          href={`/agent/policies/${record.policyId}`}
                          className="rounded-sm font-mono underline decoration-border-steel underline-offset-4 transition-colors hover:text-teal hover:decoration-teal focus-visible:outline-none"
                        >
                          {record.policyNumber ?? "Abrir apólice"}
                        </Link>
                      ) : (
                        <span>Sem apólice vinculada</span>
                      )}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-muted">
                      {record.agentName} · {record.typeLabel}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        record.level === 0
                          ? "bg-success-pale text-success"
                          : "bg-panel text-ink-muted"
                      }`}
                    >
                      {record.level === 0
                        ? "Direta"
                        : `Repasse · nível ${record.level}`}
                    </span>
                    <time
                      dateTime={record.period}
                      className="min-w-[8.5rem] text-right text-xs capitalize text-ink-muted"
                    >
                      {periodLabel(record.period)}
                    </time>
                  </div>

                  <span className="w-full shrink-0 text-right font-mono text-base font-semibold tabular-nums text-ink sm:w-auto sm:min-w-[7rem]">
                    {USD.format(record.numericAmount)}
                  </span>
                </EntityCard>
              ))}
            </EntityCardList>

            <div className="mt-5">
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                onPageChange={setPage}
              />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-steel bg-panel/45 px-5 py-12 text-center">
            <h3 className="text-base font-semibold text-ink">
              Nenhum lançamento corresponde a esta visão.
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
              Ajuste a busca ou volte à visão completa para consultar seu
              extrato.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper transition-transform hover:-translate-y-0.5 focus-visible:outline-none"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
