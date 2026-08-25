"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { Pagination, clampPage } from "@/components/Pagination";

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

function reasonLabel(reason: string | null) {
  if (!reason) return "Interação registrada pela National Life";
  return REASON_LABELS[reason] ?? reason;
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
          <h2 className="text-xl font-semibold text-ink">Ações recomendadas</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Uma ação por apólice, baseada nas interações registradas nos últimos 30 dias.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {sourceUpdatedAt
              ? `Fonte atualizada em ${new Date(sourceUpdatedAt).toLocaleString("pt-BR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/New_York",
                })}.`
              : "A fonte de interações ainda não foi atualizada neste escopo."}
          </p>
        </div>
        <p className="text-sm text-ink-muted">{rows.length} apólices com sinal recente</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <QueueButton
          active={filter === "AT_RISK"}
          count={counts.risk}
          label="Precisa de ação"
          onClick={() => selectFilter("AT_RISK")}
        />
        <QueueButton
          active={filter === "OPPORTUNITY"}
          count={counts.opportunity}
          label="Oportunidades"
          onClick={() => selectFilter("OPPORTUNITY")}
        />
        <QueueButton
          active={filter === "ALL"}
          count={rows.length}
          label="Todas"
          onClick={() => selectFilter("ALL")}
        />
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Buscar ações</span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Buscar por cliente, apólice ou motivo"
          className="w-full rounded-xl border border-border-steel bg-paper px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal-pale"
        />
      </label>

      {visible.length === 0 ? (
        <div className="mt-5">
          <EmptyState>
            {query.trim()
              ? "Nenhuma ação corresponde à busca."
              : filter === "AT_RISK"
                ? "Nenhuma apólice com risco recente."
                : "Nenhuma oportunidade recente."}
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
                      {row.signal === "AT_RISK" ? "Ação necessária" : "Oportunidade"}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">{row.policyNumber}</span>
                  </div>
                  <p className="mt-2 font-semibold text-ink">{row.customerName ?? "Cliente não identificado"}</p>
                  <p className="mt-1 text-sm text-ink">{reasonLabel(row.reason)}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(row.occurredAt).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      // Carrier dates are calendar dates. Pinning the timezone
                      // keeps server HTML and browser hydration identical and
                      // prevents midnight UTC from becoming the prior day.
                      timeZone: "UTC",
                    })}
                    {row.eventCount > 1 ? ` · ${row.eventCount} sinais no período` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {row.phone && (
                    <a
                      href={`tel:${row.phone}`}
                      className="rounded-full border border-border-steel px-3 py-2 text-xs font-semibold text-ink hover:bg-panel"
                    >
                      Ligar
                    </a>
                  )}
                  {row.email && (
                    <a
                      href={`mailto:${row.email}`}
                      className="rounded-full border border-border-steel px-3 py-2 text-xs font-semibold text-ink hover:bg-panel"
                    >
                      Enviar e-mail
                    </a>
                  )}
                  {row.policyId && (
                    <Link
                      href={`/agent/policies/${row.policyId}`}
                      className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-paper hover:bg-teal-deep"
                    >
                      Abrir apólice
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
