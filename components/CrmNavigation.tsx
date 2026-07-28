import Link from "next/link";

type CrmView = "opportunities" | "clients" | "activities";

const CRM_VIEWS: Array<{
  key: CrmView;
  href: string;
  label: string;
  eyebrow: string;
  description: string;
}> = [
  {
    key: "opportunities",
    href: "/agent/cases",
    label: "Oportunidades",
    eyebrow: "Pipeline",
    description: "Acompanhe cada atendimento até a emissão.",
  },
  {
    key: "clients",
    href: "/agent/clients",
    label: "Clientes",
    eyebrow: "Relacionamentos",
    description: "Encontre pessoas, dados e responsáveis.",
  },
  {
    key: "activities",
    href: "/agent/activities",
    label: "Atividades",
    eyebrow: "Próximas ações",
    description: "Veja retornos, pendências e histórico.",
  },
];

export function CrmNavigation({ active }: { active: CrmView }) {
  return (
    <nav className="crm-navigation" aria-label="Visões do CRM">
      <div className="crm-navigation-intro">
        <span>CRM</span>
        <p>Do primeiro contato ao relacionamento.</p>
      </div>

      <ol className="crm-navigation-list">
        {CRM_VIEWS.map((view, index) => {
          const isActive = view.key === active;

          return (
            <li key={view.key} data-active={isActive || undefined}>
              <Link href={view.href} aria-current={isActive ? "page" : undefined}>
                <span className="crm-navigation-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="crm-navigation-copy">
                  <small>{view.eyebrow}</small>
                  <strong>{view.label}</strong>
                  <em>{view.description}</em>
                </span>
                <i aria-hidden="true">→</i>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
