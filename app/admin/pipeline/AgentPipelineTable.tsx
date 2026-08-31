"use client";

import { useMemo, useState } from "react";
import { Table, Thead, Th, ThSort, Tr, Td, TdNum, EmptyState } from "@/components/Table";
import { Pagination, clampPage } from "@/components/Pagination";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Row = {
  agentId: string;
  agentName: string;
  open: number;
  placed: number;
  winRate: number;
  inFlightCoverage: number;
};
type SortKey = "open" | "placed" | "winRate" | "inFlightCoverage";

const PAGE_SIZE = 20;

export function AgentPipelineTable({ rows }: { rows: Row[] }) {
  const { copy, language } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>("open");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // State adjustment during render (React's documented pattern): reset to page 1
  // on a new sort so stale rows from the old order never show under the new one.
  const [prevSort, setPrevSort] = useState({ sortKey, direction });
  if (prevSort.sortKey !== sortKey || prevSort.direction !== direction) {
    setPrevSort({ sortKey, direction });
    setPage(1);
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => (direction === "desc" ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    return copy;
  }, [rows, sortKey, direction]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setDirection("desc");
    }
  }

  if (rows.length === 0) return <EmptyState>{copy('Nenhum caso atribuído ainda.', 'No cases have been assigned yet.')}</EmptyState>;

  return (
    <>
      <Table label={copy('Funil por agente', 'Pipeline by agent')}>
        <Thead>
          <tr>
            <Th>{copy('Agente', 'Agent')}</Th>
            <ThSort numeric active={sortKey === "open"} direction={direction} onClick={() => toggleSort("open")}>
              {copy('Em andamento', 'In progress')}
            </ThSort>
            <ThSort numeric active={sortKey === "placed"} direction={direction} onClick={() => toggleSort("placed")}>
              {copy('Emitidos', 'Issued')}
            </ThSort>
            <ThSort numeric active={sortKey === "winRate"} direction={direction} onClick={() => toggleSort("winRate")}>
              {copy('Taxa de conversão', 'Win rate')}
            </ThSort>
            <ThSort numeric active={sortKey === "inFlightCoverage"} direction={direction} onClick={() => toggleSort("inFlightCoverage")}>
              {copy('Cobertura no funil', 'Coverage in pipeline')}
            </ThSort>
          </tr>
        </Thead>
        <tbody>
          {pageRows.map((r, i) => (
            <Tr key={r.agentId} index={i}>
              <Td>{r.agentName}</Td>
              <TdNum>{formatNumber(r.open, language)}</TdNum>
              <TdNum>{formatNumber(r.placed, language)}</TdNum>
              <TdNum>{formatNumber(r.winRate * 100, language, { maximumFractionDigits: 0 })}%</TdNum>
              <TdNum>{formatCurrency(r.inFlightCoverage, language, 'USD', {
                notation: 'compact',
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}</TdNum>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </>
  );
}
