"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/LanguageProvider";

type CrmView = "opportunities" | "clients" | "activities";

const CRM_VIEWS: Array<{
  key: CrmView;
  href: string;
  label: readonly [string, string];
  eyebrow: readonly [string, string];
  description: readonly [string, string];
}> = [
  {
    key: "opportunities",
    href: "/agent/cases",
    label: ["Oportunidades", "Opportunities"],
    eyebrow: ["Pipeline", "Pipeline"],
    description: ["Acompanhe cada atendimento até a emissão.", "Track every case through issuance."],
  },
  {
    key: "clients",
    href: "/agent/clients",
    label: ["Clientes", "Clients"],
    eyebrow: ["Relacionamentos", "Relationships"],
    description: ["Encontre pessoas, dados e responsáveis.", "Find people, information, and owners."],
  },
  {
    key: "activities",
    href: "/agent/activities",
    label: ["Atividades", "Activities"],
    eyebrow: ["Próximas ações", "Next actions"],
    description: ["Veja retornos, pendências e histórico.", "Review follow-ups, pending items, and history."],
  },
];

export function CrmNavigation({ active }: { active: CrmView }) {
  const { copy } = useI18n();
  return (
    <nav className="crm-navigation" aria-label={copy("Visões do CRM", "CRM views")}>
      <div className="crm-navigation-intro">
        <span>CRM</span>
        <p>{copy("Do primeiro contato ao relacionamento.", "From first contact to an ongoing relationship.")}</p>
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
                  <small>{copy(...view.eyebrow)}</small>
                  <strong>{copy(...view.label)}</strong>
                  <em>{copy(...view.description)}</em>
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
