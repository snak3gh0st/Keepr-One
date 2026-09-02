// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatePersonalProfileAction: vi.fn(),
  requestEmailChangeAction: vi.fn(),
  changePasswordAction: vi.fn(),
  updateAgencyProfileAction: vi.fn(),
}));

vi.mock("./actions", () => mocks);

import { SettingsForms, type SettingsFormsProps } from "./SettingsForms";
import { INITIAL_SETTINGS_ACTION_STATE } from "./state";

const BASE_PROPS: SettingsFormsProps = {
  personal: {
    name: "Ana Corretora",
    phone: "+1 407 555 0101",
    timeZone: "America/New_York",
  },
  professional: {
    npn: "12345678",
    rank: "AGENT",
    status: "ACTIVE",
  },
  security: {
    email: "ana@example.com",
    emailVerified: true,
  },
  agency: {
    kind: "AGENCY_OWNER",
    name: "Agência Aurora",
    subscriptionStatus: "ACTIVE",
    canEditAgency: true,
  },
  kbot: {
    enabled: true,
    credentialBrokerEnabled: false,
    credentialSummary: {
      configured: false,
      autoLoginEnabled: false,
      status: "NOT_CONFIGURED",
      maskedUsername: null,
      consentedAt: null,
      lastSucceededAt: null,
      lastRejectedAt: null,
    },
  },
};

beforeEach(() => {
  for (const action of Object.values(mocks)) {
    action.mockResolvedValue(INITIAL_SETTINGS_ACTION_STATE);
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsForms", () => {
  it("renders independent, labelled account forms and read-only professional identity", () => {
    render(<SettingsForms {...BASE_PROPS} />);

    expect(
      screen.getByRole("navigation", { name: "Seções das configurações" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dados profissionais" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Segurança" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "K-Bot e National Life" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agência" })).toBeInTheDocument();

    expect(screen.getByLabelText(/Nome completo/)).toHaveValue("Ana Corretora");
    expect(screen.getByLabelText(/Nome completo/)).toHaveAttribute("maxlength", "100");
    expect(screen.getByLabelText(/Telefone/)).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByLabelText(/Fuso horário/)).toHaveValue("America/New_York");
    expect(screen.getByText("12345678")).toBeVisible();
    expect(screen.getByText(/corrigir o NPN/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /salvar.*profissional/i })).toBeNull();

    expect(screen.getByLabelText(/Novo e-mail/)).toHaveAttribute("name", "newEmail");
    expect(screen.getByLabelText(/^Senha atual\s*\*$/)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText(/Nova senha/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Encerrar minhas outras sessões")).toBeChecked();
    expect(screen.getByLabelText(/Nome da agência/)).toHaveValue("Agência Aurora");

    expect(screen.getByRole("button", { name: "Salvar perfil" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Alterar e-mail" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Alterar senha" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Salvar agência" })).toBeEnabled();
    expect(screen.getByText(/não guarda nem envia sua senha da National Life/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Gerenciar K-Bot e National Life" })).toHaveAttribute(
      "href",
      "/agent/integrations/national-life",
    );
  });

  it("keeps an invited member's agency details read-only", () => {
    render(
      <SettingsForms
        {...BASE_PROPS}
        agency={{
          kind: "AGENCY_MEMBER",
          name: "Agência Aurora",
          subscriptionStatus: "ACTIVE",
          canEditAgency: false,
        }}
      />,
    );

    expect(screen.queryByLabelText(/Nome da agência/)).toBeNull();
    expect(screen.getByText("Agência vinculada")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver plano e vínculo" })).toHaveAttribute(
      "href",
      "/agent/agency",
    );
  });

  it("keeps a paused agency owner's identity visible without exposing an action that will fail", () => {
    render(
      <SettingsForms
        {...BASE_PROPS}
        agency={{
          kind: "AGENCY_OWNER",
          name: "Agência Aurora",
          subscriptionStatus: "PAST_DUE",
          canEditAgency: false,
        }}
      />,
    );

    expect(screen.queryByLabelText(/Nome da agência/)).toBeNull();
    expect(screen.getByText(/Regularize o Plano Agência/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Regularizar plano" })).toHaveAttribute(
      "href",
      "/agent/agency",
    );
  });

  it("shows an individual agent a plan route without exposing agency editing", () => {
    render(
      <SettingsForms
        {...BASE_PROPS}
        agency={{
          kind: "INDIVIDUAL",
          name: null,
          subscriptionStatus: "ACTIVE",
          canEditAgency: false,
        }}
      />,
    );

    expect(screen.queryByLabelText(/Nome da agência/)).toBeNull();
    expect(screen.getAllByText("Operação individual")).toHaveLength(2);
    expect(screen.getAllByText("Operação individual")[0]).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver meu plano" })).toHaveAttribute(
      "href",
      "/agent/agency",
    );
  });
});
