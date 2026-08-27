// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  createAgencyInvitationAction: vi.fn(),
  revokeAgencyInvitationAction: vi.fn(),
  updateAgencyRecruitmentStageAction: vi.fn(),
}));

import {
  AgencyInvitationForm,
  InvitationLink,
  RecruitmentStageForm,
  RevokeInvitationForm,
} from "./AgencyInvitationForms";

describe("AgencyInvitationForm", () => {
  it("collects the fixed invitee type and initial recruitment stage", () => {
    render(<AgencyInvitationForm agencyName="Agência Principal" />);

    expect(screen.getByLabelText(/Nome da pessoa ou responsável/i)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/^E-mail/)).toBeRequired();
    expect(screen.getByRole("radio", { name: /^Agente/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Agência/i })).not.toBeChecked();
    const initialStage = screen.getByRole("combobox", { name: /^Etapa atual/ });
    expect(initialStage).toHaveValue("PROSPECT");
    expect(within(initialStage).queryByRole("option", { name: "Ativo" })).not.toBeInTheDocument();
    expect(screen.getByText(/Agência Principal → novo agente/i)).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Enviar convite",
      }),
    ).toBeEnabled();
    expect(screen.getByText(/US\$\s*49,90\/mês/i)).toBeVisible();
    expect(screen.getByText(/US\$\s*99,90\/mês/i)).toBeVisible();
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
