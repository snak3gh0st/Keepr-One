"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import { Pagination, clampPage } from "@/components/Pagination";

export type CaseRow = {
  id: string;
  policyNo: string;
  insuredName: string | null;
  product: string | null;
  carrierStatus: string | null;
  requirements: string | null;
  submitDate: string | null;
  anticipatedAnnualPremium: string | null;
  gridKey: string;
};

export type InforceRow = {
  id: string;
  policyNumber: string;
  insuredClientName: string | null;
  ownerClientName: string | null;
  productName: string | null;
  policyStatus: string | null;
  policyIssueDate: string | null;
  servicingAgencyName: string | null;
};

export type CommissionRow = {
  id: string;
  gridKey: string;
  label: string | null;
  primaryDate: string | null;
  amounts: Record<string, string>;
};

type Tab = "cases" | "inforce" | "commissions";

const PAGE_SIZE = 12;

/// The carrier sends every figure as a display string, sometimes already
/// containing "$" or thousands separators. Parse defensively and fall back to
/// showing the carrier's own text rather than a wrong number.
function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(value: string | undefined) {
  const parsed = parseAmount(value);
  return parsed === null ? (value ?? "—") : USD.format(parsed);
}

function statusTone(status: string | null) {
  if (!status) return "text-paper/50";
  const normalized = status.toLowerCase();
  if (normalized.startsWith("active") || normalized.startsWith("issued")) {
    return "text-emerald-300";
  }
  if (normalized.includes("lapse") || normalized.includes("closed") || normalized.includes("not active")) {
    return "text-amber-300";
  }
  return "text-paper/70";
}

function TabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 border px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-white/30 bg-white/[0.08] text-paper"
          : "border-white/10 text-paper/60 hover:bg-white/[0.04]"
      }`}
    >
      {label}
      <span className="text-xs text-paper/45">{count}</span>
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-paper/40">{label}</p>
      <p className="mt-0.5 text-sm text-paper/80">{value?.trim() ? value : "—"}</p>
    </div>
  );
}

export function NationalLifeDataTabs({
  cases,
  inforce,
  commissions,
}: {
  cases: CaseRow[];
  inforce: InforceRow[];
  commissions: CommissionRow[];
}) {
  const [tab, setTab] = useState<Tab>("cases");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (values: Array<string | null>) =>
      needle.length === 0 ||
      values.some((value) => (value ?? "").toLowerCase().includes(needle));

    return {
      cases: cases.filter((row) => matches([row.policyNo, row.insuredName, row.product, row.carrierStatus])),
      inforce: inforce.filter((row) =>
        matches([row.policyNumber, row.insuredClientName, row.ownerClientName, row.productName, row.policyStatus]),
      ),
      commissions: commissions.filter((row) => matches([row.label, row.primaryDate, row.gridKey])),
    };
  }, [cases, inforce, commissions, query]);

  const active = filtered[tab];
  const pageCount = Math.max(1, Math.ceil(active.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const visible = active.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "cases"} count={filtered.cases.length} label="Casos" onClick={() => switchTab("cases")} />
        <TabButton
          active={tab === "inforce"}
          count={filtered.inforce.length}
          label="Apólices em vigor"
          onClick={() => switchTab("inforce")}
        />
        <TabButton
          active={tab === "commissions"}
          count={filtered.commissions.length}
          label="Comissões"
          onClick={() => switchTab("commissions")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Buscar</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Buscar por apólice, segurado, produto ou status"
          className="w-full border border-white/12 bg-transparent px-3 py-2.5 text-sm text-paper placeholder:text-paper/35 focus:border-white/30 focus:outline-none"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? "Nenhum registro corresponde à busca."
              : "Nada sincronizado ainda para esta aba."}
          </EmptyState>
        </div>
      ) : (
        <EntityCardList>
          {tab === "cases" &&
            (visible as CaseRow[]).map((row, index) => (
              <EntityCard key={row.id} index={index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-paper">{row.insuredName ?? "—"}</p>
                  <p className="font-mono text-xs text-paper/50">{row.policyNo}</p>
                </div>
                <p className={`mt-1 text-sm font-medium ${statusTone(row.carrierStatus)}`}>
                  {row.carrierStatus ?? "—"}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Meta label="Produto" value={row.product} />
                  <Meta label="Submetido" value={row.submitDate} />
                  <Meta label="Prêmio anual" value={row.anticipatedAnnualPremium} />
                  <Meta label="Pendências" value={row.requirements} />
                </div>
              </EntityCard>
            ))}

          {tab === "inforce" &&
            (visible as InforceRow[]).map((row, index) => (
              <EntityCard key={row.id} index={index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-paper">{row.insuredClientName ?? "—"}</p>
                  <p className="font-mono text-xs text-paper/50">{row.policyNumber}</p>
                </div>
                <p className={`mt-1 text-sm font-medium ${statusTone(row.policyStatus)}`}>
                  {row.policyStatus ?? "—"}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Meta label="Produto" value={row.productName} />
                  <Meta label="Titular" value={row.ownerClientName} />
                  <Meta label="Emissão" value={row.policyIssueDate} />
                  <Meta label="Agência" value={row.servicingAgencyName} />
                </div>
              </EntityCard>
            ))}

          {tab === "commissions" &&
            (visible as CommissionRow[]).map((row, index) => {
              const entries = Object.entries(row.amounts).slice(0, 4);
              return (
                <EntityCard key={row.id} index={index}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-paper">{row.label ?? "—"}</p>
                    <p className="text-xs text-paper/50">{row.primaryDate ?? "—"}</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.08em] text-paper/40">
                    {row.gridKey.replace(/_/g, " ").toLowerCase()}
                  </p>
                  {entries.length > 0 && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      {entries.map(([field, value]) => (
                        <Meta key={field} label={field} value={formatAmount(value)} />
                      ))}
                    </div>
                  )}
                </EntityCard>
              );
            })}
        </EntityCardList>
      )}

      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} className="mt-6" />
    </div>
  );
}
