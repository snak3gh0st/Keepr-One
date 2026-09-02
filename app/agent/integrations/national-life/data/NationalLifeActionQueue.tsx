"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { Pagination, clampPage } from "@/components/Pagination";
import { useI18n } from "@/components/i18n/LanguageProvider";

export type NationalLifeActionRow = {
  policyNumber: string;
  policyId: string | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  reason: string | null;
  description: string | null;
  occurredAt: string;
  signal: "AT_RISK" | "OPPORTUNITY";
  eventCount: number;
};

type QueueFilter = "AT_RISK" | "OPPORTUNITY" | "ALL";

const PAGE_SIZE = 10;

const REASON_LABELS: Record<string, string> = {
  EftFailure: "Falha no pagamento automático",
  "Lapse Letter": "Carta de lapse emitida",
  "Pending Lapse Warning": "Risco de lapse",
  "Surrender Request": "Solicitação de resgate",
  "Surrender Inquiry": "Consulta sobre resgate",
  "Deleted auto payment": "Pagamento automático removido",
  "Client goes off monthly EFT in year 1": "Pagamento mensal removido no primeiro ano",
  "Planned Premium Overdue (Life - IUL/UL)": "Prêmio planejado em atraso",
  "Reinstatement Quote and Forms": "Cotação de reinstalação solicitada",
  "Client Birthday Coming up in next 7 days": "Aniversário nos próximos 7 dias",
  "Policy Anniversary": "Aniversário da apólice",
};

function reasonLabel(reason: string | null, language: "PT" | "EN") {
  if (!reason) return language === "PT" ? "Interação registrada pela National Life" : "Interaction recorded by National Life";
  return language === "PT" ? REASON_LABELS[reason] ?? reason : reason;
}

function QueueButton({
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
      aria-pressed={active}
      onClick={onClick}
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

export function NationalLifeActionQueue({
  rows,
  sourceUpdatedAt,
}: {
  rows: NationalLifeActionRow[];
  sourceUpdatedAt: string | null;
}) {
  const { copy, language, locale } = useI18n();
  const [filter, setFilter] = useState<QueueFilter>("AT_RISK");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const counts = useMemo(
    () => ({
      risk: rows.filter((row) => row.signal === "AT_RISK").length,
      opportunity: rows.filter((row) => row.signal === "OPPORTUNITY").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "ALL" && row.signal !== filter) return false;
      if (!needle) return true;
      return [row.customerName, row.policyNumber, row.reason, row.email, row.phone]
        .some((value) => (value ?? "").toLowerCase().includes(needle));
    });
  }, [filter, query, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectFilter = (next: QueueFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">{copy("Ações recomendadas", "Recommended actions")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            {copy("Uma ação por apólice, baseada nas interações registradas nos últimos 30 dias.", "One action per policy, based on interactions recorded in the last 30 days.")}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {sourceUpdatedAt
              ? copy("Fonte atualizada em {date}.", "Source updated on {date}.", { date: new Date(sourceUpdatedAt).toLocaleString(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/New_York",
                }) })
              : copy("A fonte de interações ainda não foi atualizada neste escopo.", "The interaction source has not been updated for this scope yet.")}
          </p>
        </div>
        <p className="text-sm text-ink-muted">{copy("{count} apólices com sinal recente", "{count} policies with a recent signal", { count: rows.length })}</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <QueueButton
          active={filter === "AT_RISK"}
          count={counts.risk}
          label={copy("Precisa de ação", "Needs action")}
          onClick={() => selectFilter("AT_RISK")}
        />
        <QueueButton
          active={filter === "OPPORTUNITY"}
          count={counts.opportunity}
          label={copy("Oportunidades", "Opportunities")}
          onClick={() => selectFilter("OPPORTUNITY")}
        />
        <QueueButton
          active={filter === "ALL"}
          count={rows.length}
          label={copy("Todas", "All")}
          onClick={() => selectFilter("ALL")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">{copy("Buscar ações", "Search actions")}</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={copy("Buscar por cliente, apólice ou motivo", "Search by client, policy, or reason")}
          className="w-full rounded-xl border border-border-steel bg-paper px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal-pale"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? copy("Nenhuma ação corresponde à busca.", "No actions match the search.")
              : filter === "AT_RISK"
                ? copy("Nenhuma apólice com risco recente.", "No policies with recent risk.")
                : copy("Nenhuma oportunidade recente.", "No recent opportunities.")}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border-steel border-y border-border-steel">
          {visible.map((row) => (
            <li key={row.policyNumber} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.signal === "AT_RISK"
                          ? "bg-danger-pale text-danger"
                          : "bg-gold-pale text-gold-ink"
                      }`}
                    >
                      {row.signal === "AT_RISK" ? copy("Ação necessária", "Action needed") : copy("Oportunidade", "Opportunity")}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">{row.policyNumber}</span>
                  </div>
                  <p className="mt-2 font-semibold text-ink">{row.customerName ?? copy("Cliente não identificado", "Unidentified client")}</p>
                  <p className="mt-1 text-sm text-ink">{reasonLabel(row.reason, language)}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(row.occurredAt).toLocaleDateString(locale, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      // Carrier dates are calendar dates. Pinning the timezone
                      // keeps server HTML and browser hydration identical and
                      // prevents midnight UTC from becoming the prior day.
                      timeZone: "UTC",
                    })}
                    {row.eventCount > 1 ? copy(" · {count} sinais no período", " · {count} signals in the period", { count: row.eventCount }) : ""}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {row.phone && (
                    <a
                      href={`tel:${row.phone}`}
                      className="rounded-full border border-border-steel px-3 py-2 text-xs font-semibold text-ink hover:bg-panel"
                    >
                      {copy("Ligar", "Call")}
                    </a>
                  )}
                  {row.email && (
                    <a
                      href={`mailto:${row.email}`}
                      className="rounded-full border border-border-steel px-3 py-2 text-xs font-semibold text-ink hover:bg-panel"
                    >
                      {copy("Enviar e-mail", "Send email")}
                    </a>
                  )}
                  {row.policyId && (
                    <Link
                      href={`/agent/policies/${row.policyId}`}
                      className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-paper hover:bg-teal-deep"
                    >
                      {copy("Abrir apólice", "Open policy")}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} className="mt-6" />
    </div>
  );
}
