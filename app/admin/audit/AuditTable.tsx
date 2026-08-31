"use client";

import { useMemo, useState } from "react";
import { Table, Thead, Th, Tr, Td, EmptyState } from "@/components/Table";
import { Pagination, clampPage } from "@/components/Pagination";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { LocalizedRolePill } from "../LocalizedStatusPills";

type Row = {
  id: string;
  createdAt: string;
  userName: string;
  userRole: "ADMIN" | "AGENT" | "CLIENT";
  actionLabel: string;
  diffs: { field: string; before: string; after: string }[];
};

const PAGE_SIZE = 20;

export function AuditTable({ rows }: { rows: Row[] }) {
  const { copy } = useI18n();
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = clampPage(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [rows, currentPage],
  );

  if (rows.length === 0) {
    return <EmptyState>{copy('Nenhuma alteração registrada ainda.', 'No changes have been recorded yet.')}</EmptyState>;
  }

  return (
    <div>
      <Table label={copy('Eventos de auditoria', 'Audit events')}>
        <Thead>
          <tr>
            <Th>{copy('Data', 'Date')}</Th>
            <Th>{copy('Quem', 'Who')}</Th>
            <Th>{copy('Ação', 'Action')}</Th>
            <Th>{copy('O que mudou', 'What changed')}</Th>
          </tr>
        </Thead>
        <tbody>
          {pageRows.map((log, i) => (
            <Tr key={log.id} index={i}>
              <Td className="whitespace-nowrap font-mono text-ink-muted">{log.createdAt}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span>{log.userName}</span>
                  <LocalizedRolePill role={log.userRole} />
                </div>
              </Td>
              <Td>{log.actionLabel}</Td>
              <Td>
                {log.diffs.length === 0 ? (
                  <span className="text-ink-muted">—</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {log.diffs.map((d) => (
                      <li key={d.field} className="font-mono text-xs">
                        <span className="text-ink-muted">{
                          d.field === 'parentAgentId'
                            ? copy('Gerente', 'Manager')
                            : d.field === 'overridePercent'
                              ? copy('Percentual de sobrecomissão', 'Override percentage')
                              : d.field === 'rank'
                                ? copy('Cargo', 'Rank')
                                : d.field
                        }:</span> {d.before} → {d.after}
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
