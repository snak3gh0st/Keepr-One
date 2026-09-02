"use client";

import { useI18n } from "@/components/i18n/LanguageProvider";

export type AgencyTeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "neutral";
  priceLabel: string;
};

function memberInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  return initials || "—";
}

export function AgencyTeamList({
  members,
  agencyName,
}: {
  members: AgencyTeamMember[];
  agencyName: string;
}) {
  const { copy } = useI18n();

  if (members.length === 0) {
    return (
      <div className="agency-team-empty">
        <strong>{copy("A equipe ainda não possui vínculos ativos.", "The team has no active connections yet.")}</strong>
        <span>{copy("Envie o primeiro convite para começar a formar a equipe.", "Send the first invitation to start building the team.")}</span>
      </div>
    );
  }

  return (
    <div
      className="agency-team-table"
      role="table"
      aria-label={copy(
        `Equipe e assinaturas da ${agencyName}`,
        `${agencyName} team and subscriptions`,
      )}
      aria-colcount={4}
      aria-rowcount={members.length + 1}
    >
      <div className="agency-team-table-head" role="rowgroup">
        <div role="row">
          <span role="columnheader">{copy("Integrante", "Member")}</span>
          <span role="columnheader">{copy("Vínculo", "Connection")}</span>
          <span role="columnheader">{copy("Assinatura", "Subscription")}</span>
          <span role="columnheader">{copy("Mensalidade", "Monthly fee")}</span>
        </div>
      </div>

      <div role="rowgroup">
        {members.map((member) => (
          <div className="agency-team-row" role="row" key={member.id}>
            <div className="agency-team-identity" role="cell">
              <span aria-hidden="true">{memberInitials(member.name)}</span>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
            </div>

            <div className="agency-team-cell" role="cell" data-label={copy("Vínculo", "Connection")}>
              <span>{member.role}</span>
            </div>

            <div className="agency-team-cell" role="cell" data-label={copy("Assinatura", "Subscription")}>
              <span className="agency-team-status" data-tone={member.statusTone}>
                {member.statusLabel}
              </span>
            </div>

            <div
              className="agency-team-cell agency-team-price"
              role="cell"
              data-label={copy("Mensalidade", "Monthly fee")}
            >
              <strong>{member.priceLabel}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
