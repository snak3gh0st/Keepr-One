import type { OnboardingModuleName } from "@/lib/agent-onboarding";

export type OnboardingModuleDefinition = {
  key: OnboardingModuleName;
  title: string;
  shortTitle: string;
  href: string;
  description: string;
  outcome: string;
  accent: "mint" | "gold" | "paper";
};

export const ONBOARDING_MODULE_CATALOG: Record<
  OnboardingModuleName,
  OnboardingModuleDefinition
> = {
  TODAY: {
    key: "TODAY",
    title: "Hoje",
    shortTitle: "Hoje",
    href: "/agent",
    description:
      "Sua visão diária reúne pendências, compromissos e os sinais que pedem atenção primeiro.",
    outcome: "Começar o dia sabendo o que fazer agora.",
    accent: "mint",
  },
  CALENDAR: {
    key: "CALENDAR",
    title: "Agenda",
    shortTitle: "Agenda",
    href: "/agent/calendar",
    description:
      "Compromissos, reuniões e Google Meet ficam ligados ao histórico de cada relacionamento.",
    outcome: "Transformar encontros em próximos passos claros.",
    accent: "paper",
  },
  CRM: {
    key: "CRM",
    title: "CRM",
    shortTitle: "CRM",
    href: "/agent/cases",
    description:
      "O pipeline organiza cada oportunidade do primeiro contato ao relacionamento com o cliente.",
    outcome: "Saber em que etapa cada oportunidade está.",
    accent: "gold",
  },
  MESSAGES: {
    key: "MESSAGES",
    title: "Mensagens",
    shortTitle: "Mensagens",
    href: "/agent/mensagens",
    description:
      "Conversas com clientes podem viver em uma caixa conectada ao restante da operação.",
    outcome: "Manter contexto e retorno no mesmo lugar.",
    accent: "mint",
  },
  POLICIES: {
    key: "POLICIES",
    title: "Apólices",
    shortTitle: "Apólices",
    href: "/agent/policies",
    description:
      "Sua carteira mostra produto, seguradora, situação e relacionamento responsável por cada apólice.",
    outcome: "Consultar a carteira sem reconstruir o histórico.",
    accent: "paper",
  },
  ILLUSTRATIONS: {
    key: "ILLUSTRATIONS",
    title: "Ilustrações",
    shortTitle: "Ilustrações",
    href: "/agent/illustrations",
    description:
      "Solicitações e documentos de ilustração permanecem conectados à oportunidade correta.",
    outcome: "Acompanhar cada solicitação até o documento final.",
    accent: "gold",
  },
  COMMISSIONS: {
    key: "COMMISSIONS",
    title: "Comissões",
    shortTitle: "Comissões",
    href: "/agent/commissions",
    description:
      "O extrato explica valores diretos e, quando o plano permite, resultados da estrutura abaixo de você.",
    outcome: "Entender quanto entrou, de onde veio e por quê.",
    accent: "mint",
  },
  JOURNEY: {
    key: "JOURNEY",
    title: "Jornada",
    shortTitle: "Jornada",
    href: "/agent/journey",
    description:
      "Produção reconhecida vira uma rota objetiva até a próxima conquista profissional.",
    outcome: "Visualizar o caminho sem misturar previsão e confirmação.",
    accent: "paper",
  },
  TEAM: {
    key: "TEAM",
    title: "Equipe",
    shortTitle: "Equipe",
    href: "/agent/hierarchy",
    description:
      "Responsáveis por agência veem apenas a própria árvore e as pessoas que estão abaixo dela.",
    outcome: "Ler estrutura, vínculo e alcance sem expor níveis superiores.",
    accent: "gold",
  },
  INTEGRATIONS: {
    key: "INTEGRATIONS",
    title: "Integrações",
    shortTitle: "Integrações",
    href: "/agent/integrations",
    description:
      "Conexões externas têm estado, origem e controles próprios para que você saiba o que está ativo.",
    outcome: "Conectar serviços sem perder visibilidade do dado.",
    accent: "mint",
  },
};

export function onboardingModulesFor(
  requiredModules: readonly OnboardingModuleName[],
): OnboardingModuleDefinition[] {
  return requiredModules.map((module) => ONBOARDING_MODULE_CATALOG[module]);
}
