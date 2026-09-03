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
  const fieldLabels: Record<string, string> = {
    parentAgentId: copy('Gerente', 'Manager'),
    overridePercent: copy('Percentual de sobrecomissão', 'Override percentage'),
    rank: copy('Cargo', 'Rank'),
    name: copy('Nome', 'Name'),
    language: copy('Idioma', 'Language'),
    timeZone: copy('Fuso horário', 'Time zone'),
    phone: copy('Telefone', 'Phone'),
    npn: 'NPN',
    agencyName: copy('Agência', 'Agency'),
    clientName: copy('Nome do cliente', 'Client name'),
    clientEmail: copy('E-mail do cliente', 'Client email'),
    accessStatus: copy('Acesso', 'Access'),
    agentStatus: copy('Status do agente', 'Agent status'),
    reason: copy('Motivo', 'Reason'),
    activeSessions: copy('Sessões ativas', 'Active sessions'),
    delegatedPreviewSessions: copy('Visualizações delegadas', 'Delegated previews'),
    mode: copy('Modo', 'Mode'),
    durationMinutes: copy('Duração em minutos', 'Duration in minutes'),
    targetRole: copy('Tipo visualizado', 'Viewed user type'),
    restoredAdminSession: copy('Sessão administrativa restaurada', 'Admin session restored'),
    recipient: copy('Destinatário', 'Recipient'),
    delivery: copy('Envio', 'Delivery'),
    email: copy('E-mail de acesso', 'Login email'),
    emailVerified: copy('E-mail verificado', 'Email verified'),
    requestedEmail: copy('Novo e-mail solicitado', 'Requested new email'),
    expiresAt: copy('Expira em', 'Expires at'),
    approvalSteps: copy('Etapas de aprovação', 'Approval steps'),
    approvedAddress: copy('Endereço autorizado', 'Authorized address'),
    nextApproval: copy('Próxima aprovação', 'Next approval'),
    approvals: copy('Aprovações concluídas', 'Completed approvals'),
    sessionsRevoked: copy('Sessões encerradas', 'Sessions revoked'),
    stage: copy('Etapa', 'Stage'),
    plan: copy('Plano', 'Plan'),
    subscriptionId: copy('Assinatura', 'Subscription'),
    agencyId: copy('Agência', 'Agency'),
    ownerMembershipId: copy('Vínculo de responsável', 'Owner membership'),
    unitAmountCents: copy('Mensalidade (centavos)', 'Monthly price (cents)'),
    currency: copy('Moeda', 'Currency'),
    promotionAccessScope: copy('Escopo de acesso', 'Access scope'),
    modules: copy('Módulos', 'Modules'),
    stripePriceId: copy('Preço no Stripe', 'Stripe price'),
    stripeSubscriptionId: copy('Assinatura no Stripe', 'Stripe subscription'),
    reconciliationStatus: copy('Reconciliação', 'Reconciliation'),
  };
  const localizedValue = (value: string) => {
    const values: Record<string, string> = {
      ACTIVE: copy('Ativo', 'Active'),
      INACTIVE: copy('Inativo', 'Inactive'),
      SUSPENDED: copy('Suspenso', 'Suspended'),
      PT: 'Português',
      EN: 'English',
      EMAIL: copy('E-mail', 'Email'),
    };
    return values[value] ?? value;
  };
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
                        <span className="text-ink-muted">{fieldLabels[d.field] ?? d.field}:</span>{' '}
                        {localizedValue(d.before)} → {localizedValue(d.after)}
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
