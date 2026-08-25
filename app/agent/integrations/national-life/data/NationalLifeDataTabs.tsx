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

export type PortalReportRow = {
  id: string;
  gridKey: string;
  label: string | null;
  primaryDate: string | null;
  amounts: Record<string, string>;
  fetchedAt: string;
};

type Tab = "cases" | "inforce" | "reports";

const PAGE_SIZE = 12;

export const NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS = [
  "PAID_COMMISSIONS",
  "CORRESPONDENCE",
  "COMMISSIONS_PAYMENT_PORTAL",
  "PIP_PENDING",
  "COMMISSIONS_EARNING_REPORT",
  "PAYABLE_GROSS_COMMISSIONS",
] as const;

const OPERATIONAL_REPORT_KEYS = new Set<string>(NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS);

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

function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Source update unavailable";
  return `Updated ${date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  })}`;
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
  reports,
}: {
  cases: CaseRow[];
  inforce: InforceRow[];
  reports: PortalReportRow[];
}) {
  const [tab, setTab] = useState<Tab>("cases");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const operationalReports = useMemo(
    () => reports.filter((row) => OPERATIONAL_REPORT_KEYS.has(row.gridKey)),
    [reports],
  );

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
      reports: operationalReports.filter((row) => matches([row.label, row.primaryDate, row.gridKey])),
    };
  }, [cases, inforce, operationalReports, query]);

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
          label="Apólices"
          onClick={() => switchTab("inforce")}
        />
        <TabButton
          active={tab === "reports"}
          count={filtered.reports.length}
          label="Relatórios"
          onClick={() => switchTab("reports")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Buscar dados do portal</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Buscar por apólice, cliente, produto ou status"
          className="w-full rounded-xl border border-border-steel bg-paper px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal-pale"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? "Nenhum registro corresponde à busca. Tente outra apólice ou nome."
              : "Ainda não há dados sincronizados nesta área."}
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
                  <Meta label="Produto" value={row.product} />
                  <Meta label="Enviado em" value={row.submitDate} />
                  <Meta label="Prêmio anual" value={row.anticipatedAnnualPremium} />
                  <Meta label="Pendências" value={row.requirements} />
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
                  <Meta label="Produto" value={row.productName} />
                  <Meta label="Titular" value={row.ownerClientName} />
                  <Meta label="Emissão" value={row.policyIssueDate} />
                  <Meta label="Agência" value={row.servicingAgencyName} />
                </div>
              </EntityCard>
            ))}

          {tab === "reports" &&
            (visible as PortalReportRow[]).map((row, index) => {
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
                  <p className="mt-1 text-xs text-ink-muted">{formatFetchedAt(row.fetchedAt)}</p>
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
