"use client";

import { useMemo, useState } from "react";
import { Table, Thead, Th, ThSort, Tr, Td, TdNum, EmptyState } from "@/components/Table";
import { Pagination, clampPage } from "@/components/Pagination";
import { formatCompactMoney } from "@/lib/format";

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

  if (rows.length === 0) return <EmptyState>Nenhum caso atribuído ainda.</EmptyState>;

  return (
    <>
      <Table>
        <Thead>
          <tr>
            <Th>Agente</Th>
            <ThSort numeric active={sortKey === "open"} direction={direction} onClick={() => toggleSort("open")}>
              Em andamento
            </ThSort>
            <ThSort numeric active={sortKey === "placed"} direction={direction} onClick={() => toggleSort("placed")}>
              Emitidos
            </ThSort>
            <ThSort numeric active={sortKey === "winRate"} direction={direction} onClick={() => toggleSort("winRate")}>
              Win rate
            </ThSort>
            <ThSort numeric active={sortKey === "inFlightCoverage"} direction={direction} onClick={() => toggleSort("inFlightCoverage")}>
              Cobertura em pipeline
            </ThSort>
          </tr>
        </Thead>
        <tbody>
          {pageRows.map((r, i) => (
            <Tr key={r.agentId} index={i}>
              <Td>{r.agentName}</Td>
              <TdNum>{r.open}</TdNum>
              <TdNum>{r.placed}</TdNum>
              <TdNum>{(r.winRate * 100).toFixed(0)}%</TdNum>
              <TdNum>{formatCompactMoney(r.inFlightCoverage)}</TdNum>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </>
  );
}
