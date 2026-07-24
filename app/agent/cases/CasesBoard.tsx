"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/Table";
import { EntityCard, EntityCardList } from "@/components/EntityCard";
import { CaseStagePill } from "@/components/StatusPill";
import { Pagination, clampPage } from "@/components/Pagination";
import type { CaseStage } from "@/lib/case-workflow";

type Case = {
  id: string;
  stage: CaseStage;
  prospectName: string;
  agentName: string;
  productType: string;
  objective: string;
  targetCoverage: string | null;
  monthlyBudget: string | null;
  updatedAt: string;
};

const FILTERS: { key: string; label: string; stages: CaseStage[] | null }[] = [
  { key: "all", label: "Todos", stages: null },
  { key: "presale", label: "Pré-venda", stages: ["LEAD", "DISCOVERY", "DESIGN", "ILLUSTRATION_READY"] },
  { key: "application", label: "Aplicação", stages: ["APPLICATION_STARTED", "SUBMITTED"] },
  { key: "underwriting", label: "Em análise", stages: ["UNDERWRITING", "APPROVED"] },
  { key: "issued", label: "Emitidos", stages: ["ISSUED", "PLACED"] },
  { key: "closed", label: "Encerrados", stages: ["DECLINED", "WITHDRAWN"] },
];

const PRODUCT_LABEL: Record<string, string> = {
  TERM: "Term",
  IUL: "IUL",
  UNDECIDED: "Produto a definir",
};

const PAGE_SIZE = 12;

function sinceLabel(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "há 1 dia";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

export function CasesBoard({ cases }: { cases: Case[] }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const stages = FILTERS.find((f) => f.key === filter)?.stages;
    if (!stages) return cases;
    return cases.filter((c) => stages.includes(c.stage));
  }, [cases, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const pageCases = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`inline-flex min-h-10 items-center rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                active
                  ? "bg-teal text-paper"
                  : "border border-border-steel bg-paper text-ink-muted hover:border-teal hover:text-teal"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nenhum caso nesta visão.</EmptyState>
      ) : (
        <>
          <EntityCardList>
            {pageCases.map((c, i) => (
              <EntityCard key={c.id} index={i} href={`/agent/cases/${c.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{c.prospectName}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {PRODUCT_LABEL[c.productType] ?? c.productType} · {c.agentName} · atualizado {sinceLabel(c.updatedAt)}
                  </p>
                </div>
                {c.targetCoverage && (
                  <span className="hidden shrink-0 font-mono text-xs tabular-nums text-ink-muted sm:inline">
                    cobertura ${c.targetCoverage}
                  </span>
                )}
                {c.monthlyBudget && (
                  <span className="hidden shrink-0 font-mono text-xs tabular-nums text-ink-muted sm:inline">
                    ${c.monthlyBudget}/m
                  </span>
                )}
                <CaseStagePill stage={c.stage} />
              </EntityCard>
            ))}
          </EntityCardList>
          <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
