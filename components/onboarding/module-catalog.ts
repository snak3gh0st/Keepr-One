import type { OnboardingModuleName } from "@/lib/agent-onboarding";
import type { UserLanguage } from "@/lib/i18n/config";

type LocalizedText = Record<UserLanguage, string>;

type LocalizedOnboardingModuleDefinition = {
  key: OnboardingModuleName;
  title: LocalizedText;
  shortTitle: LocalizedText;
  href: string;
  description: LocalizedText;
  outcome: LocalizedText;
  accent: "mint" | "gold" | "paper";
};

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
  LocalizedOnboardingModuleDefinition
> = {
  TODAY: {
    key: "TODAY",
    title: { PT: "Hoje", EN: "Today" },
    shortTitle: { PT: "Hoje", EN: "Today" },
    href: "/agent",
    description: {
      PT: "Sua visão diária reúne pendências, compromissos e os sinais que pedem atenção primeiro.",
      EN: "Your daily view brings together pending tasks, appointments, and the signals that need attention first.",
    },
    outcome: {
      PT: "Começar o dia sabendo o que fazer agora.",
      EN: "Start the day knowing exactly what to do next.",
    },
    accent: "mint",
  },
  CALENDAR: {
    key: "CALENDAR",
    title: { PT: "Agenda", EN: "Calendar" },
    shortTitle: { PT: "Agenda", EN: "Calendar" },
    href: "/agent/calendar",
    description: {
      PT: "Compromissos, reuniões e Google Meet ficam ligados ao histórico de cada relacionamento.",
      EN: "Appointments, meetings, and Google Meet stay connected to each relationship's history.",
    },
    outcome: {
      PT: "Transformar encontros em próximos passos claros.",
      EN: "Turn meetings into clear next steps.",
    },
    accent: "paper",
  },
  CRM: {
    key: "CRM",
    title: { PT: "CRM", EN: "CRM" },
    shortTitle: { PT: "CRM", EN: "CRM" },
    href: "/agent/cases",
    description: {
      PT: "O pipeline organiza cada oportunidade do primeiro contato ao relacionamento com o cliente.",
      EN: "The pipeline organizes every opportunity from first contact through the client relationship.",
    },
    outcome: {
      PT: "Saber em que etapa cada oportunidade está.",
      EN: "Know exactly where every opportunity stands.",
    },
    accent: "gold",
  },
  MESSAGES: {
    key: "MESSAGES",
    title: { PT: "Mensagens", EN: "Messages" },
    shortTitle: { PT: "Mensagens", EN: "Messages" },
    href: "/agent/mensagens",
    description: {
      PT: "Conversas com clientes podem viver em uma caixa conectada ao restante da operação.",
      EN: "Client conversations can live in an inbox connected to the rest of your operations.",
    },
    outcome: {
      PT: "Manter contexto e retorno no mesmo lugar.",
      EN: "Keep context and follow-ups in one place.",
    },
    accent: "mint",
  },
  POLICIES: {
    key: "POLICIES",
    title: { PT: "Apólices", EN: "Policies" },
    shortTitle: { PT: "Apólices", EN: "Policies" },
    href: "/agent/policies",
    description: {
      PT: "Sua carteira mostra produto, seguradora, situação e relacionamento responsável por cada apólice.",
      EN: "Your book shows the product, carrier, status, and relationship responsible for every policy.",
    },
    outcome: {
      PT: "Consultar a carteira sem reconstruir o histórico.",
      EN: "Review your book without rebuilding its history.",
    },
    accent: "paper",
  },
  ILLUSTRATIONS: {
    key: "ILLUSTRATIONS",
    title: { PT: "Ilustrações", EN: "Illustrations" },
    shortTitle: { PT: "Ilustrações", EN: "Illustrations" },
    href: "/agent/illustrations",
    description: {
      PT: "Solicitações e documentos de ilustração permanecem conectados à oportunidade correta.",
      EN: "Illustration requests and documents stay connected to the right opportunity.",
    },
    outcome: {
      PT: "Acompanhar cada solicitação até o documento final.",
      EN: "Track every request through the final document.",
    },
    accent: "gold",
  },
  COMMISSIONS: {
    key: "COMMISSIONS",
    title: { PT: "Comissões", EN: "Commissions" },
    shortTitle: { PT: "Comissões", EN: "Commissions" },
    href: "/agent/commissions",
    description: {
      PT: "O extrato explica valores diretos e, quando o plano permite, resultados da estrutura abaixo de você.",
      EN: "The statement explains direct earnings and, when your plan allows it, results from your downline.",
    },
    outcome: {
      PT: "Entender quanto entrou, de onde veio e por quê.",
      EN: "Understand how much came in, where it came from, and why.",
    },
    accent: "mint",
  },
  JOURNEY: {
    key: "JOURNEY",
    title: { PT: "Jornada", EN: "Journey" },
    shortTitle: { PT: "Jornada", EN: "Journey" },
    href: "/agent/journey",
    description: {
      PT: "Produção reconhecida vira uma rota objetiva até a próxima conquista profissional.",
      EN: "Recognized production becomes a clear path toward your next professional achievement.",
    },
    outcome: {
      PT: "Visualizar o caminho sem misturar previsão e confirmação.",
      EN: "See the path without mixing forecasts and confirmed results.",
    },
    accent: "paper",
  },
  TEAM: {
    key: "TEAM",
    title: { PT: "Equipe", EN: "Team" },
    shortTitle: { PT: "Equipe", EN: "Team" },
    href: "/agent/hierarchy",
    description: {
      PT: "Responsáveis por agência veem apenas a própria árvore e as pessoas que estão abaixo dela.",
      EN: "Agency leaders see only their own organization and the people connected below it.",
    },
    outcome: {
      PT: "Ler estrutura, vínculo e alcance sem expor níveis superiores.",
      EN: "Understand structure, relationships, and reach without exposing higher levels.",
    },
    accent: "gold",
  },
  INTEGRATIONS: {
    key: "INTEGRATIONS",
    title: { PT: "Integrações", EN: "Integrations" },
    shortTitle: { PT: "Integrações", EN: "Integrations" },
    href: "/agent/integrations",
    description: {
      PT: "Conexões externas têm estado, origem e controles próprios para que você saiba o que está ativo.",
      EN: "External connections have their own status, source, and controls so you always know what is active.",
    },
    outcome: {
      PT: "Conectar serviços sem perder visibilidade do dado.",
      EN: "Connect services without losing visibility into your data.",
    },
    accent: "mint",
  },
};

export function onboardingModulesFor(
  requiredModules: readonly OnboardingModuleName[],
  language: UserLanguage = "PT",
): OnboardingModuleDefinition[] {
  return requiredModules.map((module) => {
    const definition = ONBOARDING_MODULE_CATALOG[module];
    return {
      key: definition.key,
      title: definition.title[language],
      shortTitle: definition.shortTitle[language],
      href: definition.href,
      description: definition.description[language],
      outcome: definition.outcome[language],
      accent: definition.accent,
    };
  });
}
