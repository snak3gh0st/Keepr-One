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
  if (members.length === 0) {
    return (
      <div className="agency-team-empty">
        <strong>A equipe ainda não possui vínculos ativos.</strong>
        <span>Envie o primeiro convite para começar a formar a equipe.</span>
      </div>
    );
  }

  return (
    <div
      className="agency-team-table"
      role="table"
      aria-label={`Equipe e assinaturas da ${agencyName}`}
      aria-colcount={4}
      aria-rowcount={members.length + 1}
    >
      <div className="agency-team-table-head" role="rowgroup">
        <div role="row">
          <span role="columnheader">Integrante</span>
          <span role="columnheader">Vínculo</span>
          <span role="columnheader">Assinatura</span>
          <span role="columnheader">Mensalidade</span>
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

            <div className="agency-team-cell" role="cell" data-label="Vínculo">
              <span>{member.role}</span>
            </div>

            <div className="agency-team-cell" role="cell" data-label="Assinatura">
              <span className="agency-team-status" data-tone={member.statusTone}>
                {member.statusLabel}
              </span>
            </div>

            <div
              className="agency-team-cell agency-team-price"
              role="cell"
              data-label="Mensalidade"
            >
              <strong>{member.priceLabel}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
