"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import {
  PolicyStatusPill,
  policyStatusLabel,
} from "@/components/StatusPill";
import { Pagination, clampPage } from "@/components/Pagination";

type Policy = {
  id: string;
  policyNumber: string;
  carrier: string;
  product: string;
  premium: string;
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

function premiumValue(premium: string) {
  const value = Number(premium);
  return Number.isFinite(value) ? value : 0;
}

function formatPremium(premium: string) {
  const value = Number(premium);
  return Number.isFinite(value) ? USD.format(value) : "—";
}

export function PoliciesList({ policies }: { policies: Policy[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [page, setPage] = useState(1);

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
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const result = policies.filter((policy) => {
      if (status !== "all" && policy.status !== status) return false;
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
  }, [policies, query, sortMode, status]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredPolicies.length / PAGE_SIZE),
  );
  const currentPage = clampPage(page, pageCount);
  const pagePolicies = filteredPolicies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const hasActiveFilters =
    query.trim().length > 0 || status !== "all" || sortMode !== "default";

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setSortMode("default");
    setPage(1);
  }

  if (policies.length === 0) {
    return (
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
    );
  }

  return (
    <div className="space-y-5">
      <section
        aria-labelledby="policy-navigation-title"
        className="rounded-2xl border border-border-steel bg-paper/80 p-4 shadow-[0_18px_44px_rgba(15,29,19,0.04)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="policy-navigation-title"
              className="text-base font-semibold tracking-[-0.02em] text-ink"
            >
              Navegue pela carteira
            </h2>
            <p
              role="status"
              aria-live="polite"
              className="mt-1 text-sm text-ink-muted"
            >
              {filteredPolicies.length} de {policies.length}{" "}
              {policies.length === 1 ? "apólice" : "apólices"}
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-10 rounded-xl border border-border-steel bg-paper px-3.5 py-2 text-sm font-semibold text-ink transition-[border-color,background-color,color] hover:border-teal hover:bg-teal-pale hover:text-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(170px,0.42fr)_minmax(210px,0.48fr)]">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Buscar
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Cliente, número, seguradora ou produto"
              className="min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-ink-muted/70 hover:border-ink-muted focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Status
            </span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-ink-muted focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            >
              <option value="all">Todos ({policies.length})</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Ordenar
            </span>
            <select
              value={sortMode}
              onChange={(event) => {
                setSortMode(event.target.value as SortMode);
                setPage(1);
              }}
              className="min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-ink-muted focus-visible:border-teal focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            >
              <option value="default">Mais recentes</option>
              <option value="client-asc">Cliente: A–Z</option>
              <option value="client-desc">Cliente: Z–A</option>
              <option value="premium-desc">Maior prêmio</option>
              <option value="premium-asc">Menor prêmio</option>
            </select>
          </label>
        </div>
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
          <EntityCardList>
            {pagePolicies.map((policy, i) => (
              <EntityCard
                key={policy.id}
                index={i}
                href={`/agent/policies/${policy.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {policy.clientName}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    <span className="font-mono">{policy.policyNumber}</span> ·{" "}
                    {policy.carrier} · {policy.product}
                  </p>
                </div>
                <span className="shrink-0 font-mono font-medium tabular-nums text-ink">
                  {formatPremium(policy.premium)}
                </span>
                <PolicyStatusPill status={policy.status} />
              </EntityCard>
            ))}
          </EntityCardList>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
