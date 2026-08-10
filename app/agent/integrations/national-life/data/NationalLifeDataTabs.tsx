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
  if (!status) return "text-ink-muted";
  const normalized = status.toLowerCase();
  if (normalized.startsWith("active") || normalized.startsWith("issued")) {
    return "text-success";
  }
  if (normalized.includes("lapse") || normalized.includes("closed") || normalized.includes("not active")) {
    return "text-gold-ink";
  }
  return "text-ink-muted";
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
          ? "border-teal bg-teal-pale text-teal-deep"
          : "border-border-steel text-ink-muted hover:bg-panel hover:text-ink"
      }`}
    >
      {label}
      <span className="text-xs text-ink-muted">{count}</span>
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value?.trim() ? value : "—"}</p>
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
        <TabButton active={tab === "cases"} count={filtered.cases.length} label="Cases" onClick={() => switchTab("cases")} />
        <TabButton
          active={tab === "inforce"}
          count={filtered.inforce.length}
          label="In-force policies"
          onClick={() => switchTab("inforce")}
        />
        <TabButton
          active={tab === "commissions"}
          count={filtered.commissions.length}
          label="Commissions"
          onClick={() => switchTab("commissions")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Search</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search by policy, insured, product, or status"
          className="w-full rounded-xl border border-border-steel bg-paper px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal-pale"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? "No records match your search. Try a different policy number or name."
              : "Nothing has synced into this tab yet."}
          </EmptyState>
        </div>
      ) : (
        <EntityCardList>
          {tab === "cases" &&
            (visible as CaseRow[]).map((row, index) => (
              <EntityCard key={row.id} index={index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">{row.insuredName ?? "—"}</p>
                  <p className="font-mono text-xs text-ink-muted">{row.policyNo}</p>
                </div>
                <p className={`mt-1 text-sm font-medium ${statusTone(row.carrierStatus)}`}>
                  {row.carrierStatus ?? "—"}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Meta label="Product" value={row.product} />
                  <Meta label="Submitted" value={row.submitDate} />
                  <Meta label="Annual premium" value={row.anticipatedAnnualPremium} />
                  <Meta label="Requirements" value={row.requirements} />
                </div>
              </EntityCard>
            ))}

          {tab === "inforce" &&
            (visible as InforceRow[]).map((row, index) => (
              <EntityCard key={row.id} index={index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">{row.insuredClientName ?? "—"}</p>
                  <p className="font-mono text-xs text-ink-muted">{row.policyNumber}</p>
                </div>
                <p className={`mt-1 text-sm font-medium ${statusTone(row.policyStatus)}`}>
                  {row.policyStatus ?? "—"}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Meta label="Product" value={row.productName} />
                  <Meta label="Owner" value={row.ownerClientName} />
                  <Meta label="Issue date" value={row.policyIssueDate} />
                  <Meta label="Agency" value={row.servicingAgencyName} />
                </div>
              </EntityCard>
            ))}

          {tab === "commissions" &&
            (visible as CommissionRow[]).map((row, index) => {
              const entries = Object.entries(row.amounts).slice(0, 4);
              return (
                <EntityCard key={row.id} index={index}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-ink">{row.label ?? "—"}</p>
                    <p className="text-xs text-ink-muted">{row.primaryDate ?? "—"}</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.08em] text-ink-muted">
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
