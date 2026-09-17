"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import { Pagination, clampPage } from "@/components/Pagination";
import { NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS } from "@/lib/national-life/operational-report-keys";
import { useI18n } from "@/components/i18n/LanguageProvider";

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

function formatAmount(value: string | undefined, locale: string) {
  const parsed = parseAmount(value);
  return parsed === null ? (value ?? "—") : new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatFetchedAt(value: string, locale: string, copy: (pt: string, en: string, values?: Record<string, string>) => string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy("Atualização da fonte indisponível", "Source update unavailable");
  return copy("Atualizado em {date}", "Updated {date}", { date: date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }) });
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

/// Cases and policies share one column template so every row lines up under a
/// single header on desktop. `EntityCard` lays children out as a flex row, so
/// each card gets exactly one grid child that fills it.
const ROW_COLUMNS =
  "grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.3fr)] md:items-center";

function Meta({
  label,
  value,
  labelOnMobileOnly = false,
  numeric = false,
}: {
  label: string;
  value: string | null;
  labelOnMobileOnly?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={`text-xs text-ink-muted ${labelOnMobileOnly ? "md:sr-only" : ""}`}>{label}</p>
      <p className={`mt-0.5 truncate text-sm text-ink ${numeric ? "tabular-nums" : ""} ${labelOnMobileOnly ? "md:mt-0" : ""}`} title={value?.trim() || undefined}>
        {value?.trim() ? value : "—"}
      </p>
    </div>
  );
}

function Identity({ name, reference, status }: { name: string | null; reference: string; status: string | null }) {
  return (
    <div className="col-span-2 min-w-0 md:col-span-1">
      <p className="truncate font-semibold text-ink" title={name ?? undefined}>{name ?? "—"}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-mono text-ink-muted">{reference}</span>
        <span className={`font-medium ${statusTone(status)}`}>{status ?? "—"}</span>
      </p>
    </div>
  );
}

function ColumnHeader({ labels }: { labels: string[] }) {
  return (
    <div aria-hidden="true" className={`${ROW_COLUMNS} mt-4 hidden border border-transparent px-4 pb-1 text-xs font-medium text-ink-muted md:grid`}>
      {labels.map((label) => (
        <span key={label} className="truncate">{label}</span>
      ))}
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
  const { copy, locale } = useI18n();
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
        <TabButton active={tab === "cases"} count={filtered.cases.length} label={copy("Casos", "Cases")} onClick={() => switchTab("cases")} />
        <TabButton
          active={tab === "inforce"}
          count={filtered.inforce.length}
          label={copy("Apólices", "Policies")}
          onClick={() => switchTab("inforce")}
        />
        <TabButton
          active={tab === "reports"}
          count={filtered.reports.length}
          label={copy("Relatórios", "Reports")}
          onClick={() => switchTab("reports")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">{copy("Buscar dados do portal", "Search portal data")}</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={copy("Buscar por apólice, cliente, produto ou status", "Search by policy, client, product, or status")}
          className="w-full rounded-xl border border-border-steel bg-paper px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal-pale"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? copy("Nenhum registro corresponde à busca. Tente outra apólice ou nome.", "No records match the search. Try another policy or name.")
              : copy("Ainda não há dados sincronizados nesta área.", "There is no synced data in this area yet.")}
          </EmptyState>
        </div>
      ) : (
        <>
          {tab === "cases" && (
            <ColumnHeader
              labels={[
                copy("Cliente", "Client"),
                copy("Produto", "Product"),
                copy("Enviado em", "Submitted on"),
                copy("Prêmio anual", "Annual premium"),
                copy("Pendências", "Requirements"),
              ]}
            />
          )}
          {tab === "inforce" && (
            <ColumnHeader
              labels={[
                copy("Segurado", "Insured"),
                copy("Produto", "Product"),
                copy("Titular", "Owner"),
                copy("Emissão", "Issue date"),
                copy("Agência", "Agency"),
              ]}
            />
          )}
          <div className={tab === "reports" ? "mt-5" : "mt-2 md:mt-0"}>
            <EntityCardList>
              {tab === "cases" &&
                (visible as CaseRow[]).map((row, index) => (
                  <EntityCard key={row.id} index={index}>
                    <div className={ROW_COLUMNS}>
                      <Identity name={row.insuredName} reference={row.policyNo} status={row.carrierStatus} />
                      <Meta labelOnMobileOnly label={copy("Produto", "Product")} value={row.product} />
                      <Meta labelOnMobileOnly numeric label={copy("Enviado em", "Submitted on")} value={row.submitDate} />
                      <Meta labelOnMobileOnly numeric label={copy("Prêmio anual", "Annual premium")} value={row.anticipatedAnnualPremium} />
                      <Meta labelOnMobileOnly label={copy("Pendências", "Requirements")} value={row.requirements} />
                    </div>
                  </EntityCard>
                ))}

              {tab === "inforce" &&
                (visible as InforceRow[]).map((row, index) => (
                  <EntityCard key={row.id} index={index}>
                    <div className={ROW_COLUMNS}>
                      <Identity name={row.insuredClientName} reference={row.policyNumber} status={row.policyStatus} />
                      <Meta labelOnMobileOnly label={copy("Produto", "Product")} value={row.productName} />
                      <Meta labelOnMobileOnly label={copy("Titular", "Owner")} value={row.ownerClientName} />
                      <Meta labelOnMobileOnly numeric label={copy("Emissão", "Issue date")} value={row.policyIssueDate} />
                      <Meta labelOnMobileOnly label={copy("Agência", "Agency")} value={row.servicingAgencyName} />
                    </div>
                  </EntityCard>
                ))}

              {tab === "reports" &&
                (visible as PortalReportRow[]).map((row, index) => {
                  const entries = Object.entries(row.amounts).slice(0, 4);
                  return (
                    <EntityCard key={row.id} index={index}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-semibold text-ink">{row.label ?? "—"}</p>
                          <p className="text-xs tabular-nums text-ink-muted">{row.primaryDate ?? "—"}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          <span className="capitalize">{row.gridKey.replace(/_/g, " ").toLowerCase()}</span>
                          {" · "}
                          {formatFetchedAt(row.fetchedAt, locale, copy)}
                        </p>
                        {entries.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                            {entries.map(([field, value]) => (
                              <Meta key={field} numeric label={field} value={formatAmount(value, locale)} />
                            ))}
                          </div>
                        )}
                      </div>
                    </EntityCard>
                  );
                })}
            </EntityCardList>
          </div>
        </>
      )}

      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} className="mt-6" />
    </div>
  );
}
