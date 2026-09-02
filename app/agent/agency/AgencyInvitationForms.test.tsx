// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";

vi.mock("./actions", () => ({
  createAgencyInvitationAction: vi.fn(),
  revokeAgencyInvitationAction: vi.fn(),
  updateAgencyRecruitmentStageAction: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { updateUser: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  AgencyInvitationForm,
  InvitationLink,
  RecruitmentStageForm,
  RevokeInvitationForm,
} from "./AgencyInvitationForms";

afterEach(cleanup);

describe("AgencyInvitationForm", () => {
  it("collects only the information needed to send the invitation", () => {
    render(<AgencyInvitationForm agencyName="Agência Principal" />);

    expect(screen.getByLabelText(/Nome da pessoa ou responsável/i)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/^E-mail/)).toBeRequired();
    expect(screen.getByRole("radio", { name: /^Agente/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Agência/i })).not.toBeChecked();
    expect(
      screen.queryByRole("combobox", { name: /^Etapa atual/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Vínculo direto")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Enviar convite por e-mail",
      }),
    ).toBeEnabled();
    expect(
      screen.getByText(/ativar o próprio plano/i),
    ).toBeVisible();
    expect(screen.getByText(/US\$\s*49,90\/mês/i)).toBeVisible();
    expect(screen.getByText(/US\$\s*89,90\/mês/i)).toBeVisible();
    expect(screen.getAllByText(/US\$\s*10,00 de desconto/i)).toHaveLength(2);
  });

  it("shows the one-time URL and copies exactly that invitation link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const invitationUrl = "https://app.example.com/convites/agencia/secure-token";

    render(<InvitationLink url={invitationUrl} />);

    expect(screen.getByLabelText("Link individual do convite")).toHaveValue(invitationUrl);
    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith(invitationUrl);
    expect(screen.getByRole("button", { name: "Link copiado" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Abrir convite" })).toHaveAttribute(
      "href",
      invitationUrl,
    );
  });

  it("renders the invitation flow in English when EN is selected", () => {
    render(
      <LanguageProvider initialLanguage="EN">
        <AgencyInvitationForm agencyName="North Star Agency" />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText(/Person or contact name/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Send invitation by email" })).toBeEnabled();
    expect(screen.getByText(/\$49\.90\/month/i)).toBeVisible();
    expect(screen.getByText(/North Star Agency team/i)).toBeVisible();
  });
});

describe("RecruitmentStageForm", () => {
  it("submits the direct invitation, selected stage and optimistic version", () => {
    const { container } = render(
      <RecruitmentStageForm
        invitationId="invite-123"
        inviteeLabel="Maria Silva"
        currentStage="MEETING_SCHEDULED"
        expectedStageUpdatedAt="2026-08-26T14:00:00.000Z"
      />,
    );

    const stageSelect = screen.getByLabelText("Etapa de recrutamento de Maria Silva");
    expect(stageSelect).toHaveValue("MEETING_SCHEDULED");
    expect(within(stageSelect).getByRole("option", { name: "Ativo" })).toBeInTheDocument();
    expect(container.querySelector('[name="invitationId"]')).toHaveValue("invite-123");
    expect(container.querySelector('[name="expectedStageUpdatedAt"]')).toHaveValue("2026-08-26T14:00:00.000Z");
    expect(screen.getByRole("button", { name: "Salvar etapa" })).toBeEnabled();
  });
});

describe("RevokeInvitationForm", () => {
  it("submits only the invitation identifier", () => {
    const { container } = render(
      <RevokeInvitationForm
        invitationId="invite-123"
        inviteeLabel="Maria Silva"
      />,
    );

    const hiddenId = container.querySelector<HTMLInputElement>('input[name="invitationId"]');
    expect(hiddenId).toHaveValue("invite-123");
    expect(
      screen.getByRole("button", { name: "Revogar convite de Maria Silva" }),
    ).toBeEnabled();
  });
});
