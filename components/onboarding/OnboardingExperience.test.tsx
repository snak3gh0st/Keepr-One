// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_ONBOARDING_ACTION_STATE } from "@/app/onboarding/state";
import type { AgentOnboardingView } from "@/lib/agent-onboarding";

const actionMocks = vi.hoisted(() => ({
  saveOnboardingProfileAction: vi.fn(),
  verifyNationalLifeOnboardingAction: vi.fn(),
  setCalendarOnboardingDecisionAction: vi.fn(),
  setWhatsAppOnboardingDecisionAction: vi.fn(),
}));

const integrationMocks = vi.hoisted(() => ({
  connectorRender: vi.fn(),
  evolutionRender: vi.fn(),
  officialRender: vi.fn(),
}));

const i18nMock = vi.hoisted(() => ({
  language: "PT" as "PT" | "EN",
  changeLanguage: vi.fn(),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    language: i18nMock.language,
    locale: i18nMock.language === "PT" ? "pt-BR" : "en-US",
    isChanging: false,
    pendingLanguage: null,
    error: null,
    changeLanguage: i18nMock.changeLanguage,
    copy: (
      portuguese: string,
      english: string,
      values: Record<string, string | number> = {},
    ) => (i18nMock.language === "PT" ? portuguese : english)
      .replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`)),
    t: (key: string, values: Record<string, string | number> = {}) => {
      const messages: Record<string, { PT: string; EN: string }> = {
        "language.label": { PT: "Idioma", EN: "Language" },
        "language.portuguese": { PT: "Português", EN: "Portuguese" },
        "language.english": { PT: "Inglês", EN: "English" },
        "language.changeTo": { PT: "Alterar idioma para {language}", EN: "Change language to {language}" },
      };
      return (messages[key]?.[i18nMock.language] ?? key)
        .replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`));
    },
  }),
}));

vi.mock("@/app/onboarding/actions", () => actionMocks);
vi.mock("./OnboardingMotion", () => ({
  OnboardingMotion: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/kbot/KBotAvatar", () => ({
  KBotAvatar: ({ state }: { state: string }) => <span data-testid="kbot-avatar" data-state={state} />,
}));
vi.mock("@/app/agent/integrations/national-life/NationalLifeLocalConnectorCard", () => ({
  NationalLifeLocalConnectorCard: (props: Record<string, unknown>) => {
    integrationMocks.connectorRender(props);
    return <div data-testid="national-life-connector">Conector National Life</div>;
  },
}));
vi.mock("@/app/agent/mensagens/ConnectWhatsapp", () => ({
  ConnectWhatsapp: (props: { onConnectionChange?: (connected: boolean) => void }) => {
    integrationMocks.evolutionRender(props);
    return (
      <button type="button" onClick={() => props.onConnectionChange?.(true)}>
        Finalizar conexão Evolution
      </button>
    );
  },
}));
vi.mock("@/app/agent/mensagens/ConnectOfficialWhatsapp", () => ({
  ConnectOfficialWhatsapp: (props: { onConnectionChange?: (connected: boolean) => void }) => {
    integrationMocks.officialRender(props);
    return (
      <button type="button" onClick={() => props.onConnectionChange?.(true)}>
        Finalizar conexão Meta
      </button>
    );
  },
}));

import { OnboardingExperience } from "./OnboardingExperience";

const COMPLETED_AT = "2026-08-26T12:00:00.000Z";

const BASE_ONBOARDING: AgentOnboardingView = {
  id: "onboarding-1",
  agentId: "agent-1",
  status: "IN_PROGRESS",
  currentStep: "PROFILE",
  welcomeCompletedAt: COMPLETED_AT,
  profileCompletedAt: null,
  nationalLifeVerifiedAt: null,
  nationalLifeVerificationSource: null,
  calendarDecision: null,
  calendarDecidedAt: null,
  whatsappDecision: null,
  whatsappDecidedAt: null,
  requiredModules: ["TODAY", "CALENDAR", "CRM"],
  completedModules: [],
  pendingModules: ["TODAY", "CALENDAR", "CRM"],
  completedAt: null,
  createdAt: "2026-08-26T11:00:00.000Z",
  updatedAt: COMPLETED_AT,
};

const BASE_PROPS = {
  onboarding: BASE_ONBOARDING,
  profile: {
    name: "Ana Corretora",
    phone: "+14075550101",
    timeZone: "America/New_York",
    npn: "",
  },
  integrations: {
    nationalLife: "NOT_CONNECTED" as const,
    calendarConnected: false,
    whatsappConnected: false,
  },
  nationalLifeConfig: { enabled: false } as const,
  calendarConfigured: false,
  whatsapp: { available: false, mode: "EVOLUTION" as const },
};

function onboardingAt(
  currentStep: AgentOnboardingView["currentStep"],
): AgentOnboardingView {
  return {
    ...BASE_ONBOARDING,
    currentStep,
    profileCompletedAt: currentStep === "PROFILE" ? null : COMPLETED_AT,
    nationalLifeVerifiedAt: ["CALENDAR", "WHATSAPP", "COMPLETED"].includes(currentStep)
      ? COMPLETED_AT
      : null,
    nationalLifeVerificationSource: ["CALENDAR", "WHATSAPP", "COMPLETED"].includes(currentStep)
      ? "LOCAL_CONNECTOR_SYNC"
      : null,
    calendarDecision: ["WHATSAPP", "COMPLETED"].includes(currentStep) ? "SKIPPED" : null,
    calendarDecidedAt: ["WHATSAPP", "COMPLETED"].includes(currentStep) ? COMPLETED_AT : null,
  };
}

beforeEach(() => {
  i18nMock.language = "PT";
  for (const action of Object.values(actionMocks)) {
    action.mockResolvedValue(INITIAL_ONBOARDING_ACTION_STATE);
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingExperience", () => {
  it("presents exactly four guided screens in Portuguese without the old welcome, tour, or review", () => {
    render(<OnboardingExperience {...BASE_PROPS} />);

    const navigation = screen.getByRole("navigation", { name: "Etapas do onboarding" });
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(4);
    expect(within(navigation).getByText("Seus dados")).toBeVisible();
    expect(within(navigation).getByText("K-Bot")).toBeVisible();
    expect(within(navigation).getByText("Agenda")).toBeVisible();
    expect(within(navigation).getByText("WhatsApp")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Progresso da configuração" })).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vamos começar pelo básico.");
    expect(screen.queryByText("Ver o percurso")).not.toBeInTheDocument();
    expect(screen.queryByText("Marcar como revisado")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Sua operação inteira começa/i })).not.toBeInTheDocument();
  });

  it("uses the persisted language control and renders the complete screen in English", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingExperience {...BASE_PROPS} />);

    await user.click(screen.getByRole("button", { name: "Alterar idioma para Inglês" }));
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith("EN");

    unmount();
    i18nMock.language = "EN";
    render(<OnboardingExperience {...BASE_PROPS} />);

    expect(screen.getByRole("group", { name: "Language" })).toBeVisible();
    expect(screen.getAllByText("Step 1 of 4", { exact: false })).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Let's start with the basics.");
    expect(screen.getByLabelText(/Full name/)).toBeEnabled();
    expect(screen.getByText("Every completed step is saved automatically.")).toBeVisible();
  });

  it("shows only name, phone, and optional NPN while preserving timezone as hidden data", () => {
    const { container } = render(<OnboardingExperience {...BASE_PROPS} />);

    expect(screen.getByLabelText(/Nome completo/)).toBeRequired();
    expect(screen.getByLabelText(/Telefone/)).toBeRequired();
    expect(screen.getByLabelText(/NPN/)).not.toBeRequired();
    expect(screen.getByLabelText(/NPN/)).toHaveAttribute("pattern", "[0-9]{4,20}");
    expect(screen.queryByLabelText(/Fuso horário/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('input:not([type="hidden"])')).toHaveLength(3);
    expect(container.querySelector('input[type="hidden"][name="timeZone"]')).toHaveValue("America/New_York");
  });

  it("lets the user revisit completed screens and return to the current one", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("CALENDAR")}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
        calendarConfigured
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conecte sua agenda, se quiser.");
    await user.click(screen.getByRole("button", { name: /Seus dados.*Concluída/i }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vamos começar pelo básico.");
    expect(screen.getByLabelText(/Nome completo/)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Voltar para a etapa atual" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conecte sua agenda, se quiser.");
    expect(screen.getByRole("button", { name: /WhatsApp.*Em seguida/i })).toBeDisabled();
  });

  it("keeps K-Bot present as the assistant and passes the full extension target to setup", () => {
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("NATIONAL_LIFE")}
        nationalLifeConfig={{
          enabled: true,
          extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          extensionTarget: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          installMode: "pilot",
          storeUrl: null,
          baseUrl: "http://localhost:3000",
        }}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Ajuda do K-Bot" })).toBeVisible();
    expect(screen.getByText("Vamos me instalar neste navegador. Leva só alguns passos.")).toBeVisible();
    expect(screen.getByRole("list", { name: "Etapas da configuração do K-Bot" })).toHaveTextContent("Instalação");
    expect(screen.getByRole("list", { name: "Etapas da configuração do K-Bot" })).toHaveTextContent("Início da sessão");
    expect(screen.getByRole("list", { name: "Etapas da configuração do K-Bot" })).toHaveTextContent("Processamento");
    expect(screen.getByTestId("national-life-connector")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Verificar e continuar/i })).not.toBeInTheDocument();
    expect(integrationMocks.connectorRender).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      variant: "onboarding",
      showCornerPresence: false,
    }));
  });

  it("offers the single continue action only after K-Bot has verified the first sync", () => {
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("NATIONAL_LIFE")}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
        nationalLifeConfig={{
          enabled: true,
          extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          extensionTarget: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          installMode: "store",
          storeUrl: null,
          baseUrl: "http://localhost:3000",
        }}
      />,
    );

    expect(screen.queryByTestId("national-life-connector")).not.toBeInTheDocument();
    expect(screen.getByText("Primeiro processamento concluído")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("updates both the K-Bot guidance and setup steps from the live connector state", () => {
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("NATIONAL_LIFE")}
        nationalLifeConfig={{
          enabled: true,
          extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          extensionTarget: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          installMode: "store",
          storeUrl: "https://chromewebstore.google.com/detail/keeprone/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baseUrl: "http://localhost:3000",
        }}
      />,
    );

    const connectorProps = integrationMocks.connectorRender.mock.calls.at(-1)?.[0] as {
      onStateChange?: (state: Record<string, unknown>) => void;
    };
    act(() => {
      connectorProps.onStateChange?.({
        phase: "syncing",
        presence: "installed",
        paired: true,
        syncActive: true,
        syncComplete: false,
        botState: "working",
        progress: 0.4,
      });
    });

    const progress = screen.getByRole("list", { name: "Etapas da configuração do K-Bot" });
    expect(within(progress).getByText("K-Bot encontrado")).toBeVisible();
    expect(within(progress).getByText("Sessão confirmada")).toBeVisible();
    expect(within(progress).getByText("Organizando seus dados")).toBeVisible();
    expect(screen.getByText("Agora pode deixar comigo. Estou organizando seus dados.")).toBeVisible();
  });

  it("offers Google OAuth on the onboarding return path and persists the skip decision", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("CALENDAR")}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
        calendarConfigured
      />,
    );

    expect(screen.getByRole("link", { name: "Conectar Google Calendar" })).toHaveAttribute(
      "href",
      "/api/agent/integrations/google-calendar/authorize?returnTo=/onboarding",
    );
    await user.click(screen.getByRole("button", { name: "Fazer depois" }));

    await waitFor(() => expect(actionMocks.setCalendarOnboardingDecisionAction).toHaveBeenCalledOnce());
    const submitted = actionMocks.setCalendarOnboardingDecisionAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("decision")).toBe("SKIPPED");
  });

  it.each([
    ["EVOLUTION", "Finalizar conexão Evolution", "evolutionRender"],
    ["META_CLOUD", "Finalizar conexão Meta", "officialRender"],
  ] as const)("uses the %s durable callback before enabling the final action", async (mode, providerAction, renderMock) => {
    const user = userEvent.setup();
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("WHATSAPP")}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
        whatsapp={{ available: true, mode }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Entrar na Keepr One" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Conectar agora/ }));
    expect(integrationMocks[renderMock]).toHaveBeenCalledWith(expect.objectContaining({
      onConnectionChange: expect.any(Function),
    }));
    await user.click(screen.getByRole("button", { name: providerAction }));
    await user.click(await screen.findByRole("button", { name: "Entrar na Keepr One" }));

    await waitFor(() => expect(actionMocks.setWhatsAppOnboardingDecisionAction).toHaveBeenCalledOnce());
    const submitted = actionMocks.setWhatsAppOnboardingDecisionAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("decision")).toBe("CONNECTED");
  });

  it("allows the optional WhatsApp step to finish the onboarding without connecting", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={onboardingAt("WHATSAPP")}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fazer depois e entrar" }));

    await waitFor(() => expect(actionMocks.setWhatsAppOnboardingDecisionAction).toHaveBeenCalledOnce());
    const submitted = actionMocks.setWhatsAppOnboardingDecisionAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("decision")).toBe("SKIPPED");
  });
});
