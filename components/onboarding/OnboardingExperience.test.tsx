// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOnboardingView } from "@/lib/agent-onboarding";
import { INITIAL_ONBOARDING_ACTION_STATE } from "@/app/onboarding/state";

const actionMocks = vi.hoisted(() => ({
  acknowledgeOnboardingWelcomeAction: vi.fn(),
  saveOnboardingProfileAction: vi.fn(),
  verifyNationalLifeOnboardingAction: vi.fn(),
  setCalendarOnboardingDecisionAction: vi.fn(),
  setWhatsAppOnboardingDecisionAction: vi.fn(),
  markOnboardingModuleAction: vi.fn(),
  completeOnboardingAction: vi.fn(),
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
vi.mock("@/app/agent/integrations/national-life/NationalLifeLocalConnectorCard", () => ({
  NationalLifeLocalConnectorCard: () => <div data-testid="national-life-connector">Conector National Life</div>,
}));
vi.mock("@/app/agent/mensagens/ConnectWhatsapp", () => ({
  ConnectWhatsapp: () => <div data-testid="evolution-whatsapp">Configuração Evolution</div>,
}));
vi.mock("@/app/agent/mensagens/ConnectOfficialWhatsapp", () => ({
  ConnectOfficialWhatsapp: () => <div data-testid="official-whatsapp">Configuração Meta</div>,
}));

import { OnboardingExperience } from "./OnboardingExperience";

const BASE_ONBOARDING: AgentOnboardingView = {
  id: "onboarding-1",
  agentId: "agent-1",
  status: "IN_PROGRESS",
  currentStep: "PROFILE",
  welcomeCompletedAt: "2026-08-26T12:00:00.000Z",
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
  updatedAt: "2026-08-26T12:00:00.000Z",
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
  it("uses the shared persisted-language control outside the main Shell", async () => {
    const user = userEvent.setup();
    render(<OnboardingExperience {...BASE_PROPS} />);

    await user.click(screen.getByRole("button", { name: "Alterar idioma para Inglês" }));

    expect(i18nMock.changeLanguage).toHaveBeenCalledWith("EN");
  });

  it("renders the complete onboarding experience and language control in English", () => {
    i18nMock.language = "EN";

    render(<OnboardingExperience {...BASE_PROPS} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your entire operation starts in the right place.",
    );
    expect(screen.getByRole("group", { name: "Language" })).toBeVisible();
    expect(screen.getByLabelText(/Full name/)).toBeEnabled();
    expect(screen.getByRole("heading", {
      name: "Bring Google Calendar into your Keepr One Calendar.",
    })).toBeVisible();
    expect(screen.getByText(/Your progress is saved/)).toBeVisible();
  });

  it("renders the resumable flow, exact bento geometry and required NPN", () => {
    const { container } = render(<OnboardingExperience {...BASE_PROPS} />);

    expect(container.querySelector("main")).toHaveClass(
      "overflow-x-hidden",
      "w-full",
      "max-w-full",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sua operação inteira começa no lugar certo.",
    );
    expect(screen.getByRole("link", { name: /Retomar de onde parei/ })).toHaveAttribute(
      "href",
      "#onboarding-profile",
    );
    expect(screen.getByRole("link", { name: "Ver o percurso" })).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "14");

    expect(document.getElementById("onboarding-profile")).toHaveClass(
      "lg:col-span-4",
      "lg:row-span-2",
    );
    expect(document.getElementById("onboarding-national-life")).toHaveClass("lg:col-span-8");
    expect(document.getElementById("onboarding-calendar")).toHaveClass("lg:col-span-4");
    expect(document.getElementById("onboarding-whatsapp")).toHaveClass("lg:col-span-4");
    expect(container.querySelector(".onboarding-setup-grid")).toHaveClass(
      "grid-flow-dense",
      "lg:grid-cols-12",
    );

    const npn = screen.getByLabelText(/NPN/);
    expect(npn).toBeRequired();
    expect(npn).toHaveAttribute("minlength", "4");
    expect(npn).toHaveAttribute("maxlength", "20");
    expect(screen.getByLabelText(/Nome completo/)).toBeEnabled();
    expect(document.getElementById("onboarding-national-life")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("names Google Calendar explicitly and uses the safe onboarding return path", () => {
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={{
          ...BASE_ONBOARDING,
          currentStep: "CALENDAR",
          profileCompletedAt: "2026-08-26T12:05:00.000Z",
          nationalLifeVerifiedAt: "2026-08-26T12:10:00.000Z",
          nationalLifeVerificationSource: "LOCAL_CONNECTOR_SYNC",
        }}
        integrations={{ ...BASE_PROPS.integrations, nationalLife: "VERIFIED_SYNC" }}
        calendarConfigured
      />,
    );

    expect(screen.getByText(/exclusivamente com Google Calendar/i)).toBeVisible();
    expect(screen.getByText(/Apple Calendar e iCal ainda não/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /Conectar Google Calendar/ })).toHaveAttribute(
      "href",
      "/api/agent/integrations/google-calendar/authorize?returnTo=/onboarding",
    );
    expect(screen.getByRole("button", { name: "Configurar depois" })).toBeEnabled();
  });

  it("shows a transparent later option when WhatsApp infrastructure is unavailable", () => {
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={{
          ...BASE_ONBOARDING,
          currentStep: "WHATSAPP",
          profileCompletedAt: "2026-08-26T12:05:00.000Z",
          nationalLifeVerifiedAt: "2026-08-26T12:10:00.000Z",
          nationalLifeVerificationSource: "LOCAL_CONNECTOR_SYNC",
          calendarDecision: "SKIPPED",
          calendarDecidedAt: "2026-08-26T12:15:00.000Z",
        }}
      />,
    );

    expect(screen.getByText(/infraestrutura de mensagens ainda não está liberada/i)).toBeVisible();
    expect(screen.queryByText("Configurar WhatsApp agora")).toBeNull();
    expect(screen.getByRole("button", { name: "Configurar depois" })).toBeEnabled();
  });

  it("renders the real configured WhatsApp flow only when the provider is available", async () => {
    const user = userEvent.setup();
    render(
      <OnboardingExperience
        {...BASE_PROPS}
        onboarding={{
          ...BASE_ONBOARDING,
          currentStep: "WHATSAPP",
          profileCompletedAt: "2026-08-26T12:05:00.000Z",
          nationalLifeVerifiedAt: "2026-08-26T12:10:00.000Z",
          nationalLifeVerificationSource: "LOCAL_CONNECTOR_SYNC",
          calendarDecision: "SKIPPED",
          calendarDecidedAt: "2026-08-26T12:15:00.000Z",
        }}
        whatsapp={{ available: true, mode: "META_CLOUD" }}
      />,
    );

    await user.click(screen.getByText("Configurar WhatsApp agora"));
    expect(screen.getByTestId("official-whatsapp")).toBeVisible();
    expect(screen.queryByTestId("evolution-whatsapp")).toBeNull();
  });

  it("renders only required tour modules and advances after a successful review", async () => {
    const modulesOnboarding: AgentOnboardingView = {
      ...BASE_ONBOARDING,
      currentStep: "MODULES",
      profileCompletedAt: "2026-08-26T12:05:00.000Z",
      nationalLifeVerifiedAt: "2026-08-26T12:10:00.000Z",
      nationalLifeVerificationSource: "LOCAL_CONNECTOR_SYNC",
      calendarDecision: "SKIPPED",
      calendarDecidedAt: "2026-08-26T12:15:00.000Z",
      whatsappDecision: "SKIPPED",
      whatsappDecidedAt: "2026-08-26T12:20:00.000Z",
      requiredModules: ["TODAY", "CRM"],
      completedModules: [],
      pendingModules: ["TODAY", "CRM"],
    };
    actionMocks.markOnboardingModuleAction.mockResolvedValue({
      status: "success",
      message: "Módulo marcado como conhecido.",
      onboarding: {
        ...modulesOnboarding,
        completedModules: ["TODAY"],
        pendingModules: ["CRM"],
        updatedAt: "2026-08-26T12:25:00.000Z",
      },
    });

    render(<OnboardingExperience {...BASE_PROPS} onboarding={modulesOnboarding} />);

    expect(screen.getByRole("heading", { name: "Hoje" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Equipe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Marcar como revisado/ }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "CRM" })).toBeVisible();
    });
    expect(actionMocks.markOnboardingModuleAction).toHaveBeenCalledTimes(1);
    const submitted = actionMocks.markOnboardingModuleAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("module")).toBe("TODAY");
  });
});
