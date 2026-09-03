// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  updatePlan: vi.fn(async (previousState: unknown, formData: FormData) => {
    void previousState;
    void formData;
    return { status: "idle" as const, message: "" };
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("../plan-actions", () => ({
  updateManagedUserPlanAction: mocks.updatePlan,
}));

import {
  ManagedUserPlanForm,
  type ManagedUserPlanBlockers,
} from "./ManagedUserPlanForm";

const NO_BLOCKERS: ManagedUserPlanBlockers = {
  activeMemberCount: 0,
  childAgencyCount: 0,
  pendingInvitationCount: 0,
  hasParentAgency: false,
  subAgentCount: 0,
  hasParentAgent: false,
};

function renderForm({
  currentPlan = "AGENT_INDIVIDUAL",
  stripeCustomerLinked = false,
  stripeSubscriptionLinked = false,
  blockers = NO_BLOCKERS,
}: {
  currentPlan?: "AGENT_INDIVIDUAL" | "AGENCY" | "AGENT_AGENCY_MEMBER";
  stripeCustomerLinked?: boolean;
  stripeSubscriptionLinked?: boolean;
  blockers?: ManagedUserPlanBlockers;
} = {}) {
  return render(
    <ManagedUserPlanForm
      userId="cmtc0ourp000k7d3wrzv8yfu3"
      expectedUpdatedAt="2026-09-02T15:00:00.000Z"
      currentPlan={currentPlan}
      currentAgencyName={currentPlan === "AGENCY" ? "Keepr Miami" : null}
      stripeCustomerLinked={stripeCustomerLinked}
      stripeSubscriptionLinked={stripeSubscriptionLinked}
      blockers={blockers}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("ManagedUserPlanForm", () => {
  it("marks the current Agent plan and requires an agency name before enabling the change", async () => {
    const user = userEvent.setup();
    renderForm();

    const agentPlan = screen.getByRole("radio", { name: /Plano Agente/i });
    const agencyPlan = screen.getByRole("radio", { name: /Plano Agência/i });
    const submit = screen.getByRole("button", { name: /Alterar para Plano Agente/i });

    expect(agentPlan).toBeChecked();
    expect(agencyPlan).not.toBeChecked();
    expect(submit).toBeDisabled();
    expect(screen.getByText("Plano atual")).toBeVisible();
    expect(screen.getByText(/US\$\s*59,90 \/mês/)).toBeVisible();
    expect(screen.getByText(/US\$\s*99,90 \/mês/)).toBeVisible();

    await user.click(agencyPlan);

    const agencyName = screen.getByRole("textbox", { name: /Nome da agência/i });
    expect(agencyName).toBeRequired();
    expect(screen.getByRole("button", { name: /Alterar para Plano Agência/i })).toBeDisabled();

    await user.type(agencyName, "Nova Agência");
    const agencySubmit = screen.getByRole("button", { name: /Alterar para Plano Agência/i });
    expect(agencySubmit).toBeEnabled();

    await user.click(agencySubmit);
    await waitFor(() => expect(mocks.updatePlan).toHaveBeenCalledTimes(1));
    const submittedData = mocks.updatePlan.mock.calls[0]?.[1];
    expect(submittedData).toBeInstanceOf(FormData);
    expect(submittedData?.get("targetPlan")).toBe("AGENCY");
    expect(submittedData?.get("agencyName")).toBe("Nova Agência");
  });

  it("requires explicit confirmation before changing an empty Agency to the Agent plan", async () => {
    const user = userEvent.setup();
    renderForm({ currentPlan: "AGENCY" });

    await user.click(screen.getByRole("radio", { name: /Plano Agente/i }));

    expect(screen.getByText(/perderá os módulos Agência e Equipe da Keepr Miami/i)).toBeVisible();
    const confirmation = screen.getByRole("checkbox", { name: /Confirmo a remoção/i });
    const submit = screen.getByRole("button", { name: /Alterar para Plano Agente/i });
    expect(confirmation).not.toBeChecked();
    expect(submit).toBeDisabled();

    await user.click(confirmation);
    expect(submit).toBeEnabled();
  });

  it("lists structural blockers and prevents an Agency downgrade", async () => {
    const user = userEvent.setup();
    renderForm({
      currentPlan: "AGENCY",
      blockers: {
        activeMemberCount: 2,
        childAgencyCount: 1,
        pendingInvitationCount: 3,
        hasParentAgency: true,
        subAgentCount: 4,
        hasParentAgent: true,
      },
    });

    await user.click(screen.getByRole("radio", { name: /Plano Agente/i }));

    expect(screen.getByText("Resolva os vínculos antes de alterar")).toBeVisible();
    const blockers = screen.getByRole("list", { name: "Bloqueios da alteração" });
    expect(blockers).toHaveTextContent("2 integrantes ativos na equipe");
    expect(blockers).toHaveTextContent("1 subagência vinculada");
    expect(blockers).toHaveTextContent("3 convites pendentes");
    expect(blockers).toHaveTextContent("4 agentes vinculados abaixo do responsável");
    expect(screen.getByRole("checkbox", { name: /Confirmo a remoção/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Alterar para Plano Agente/i })).toBeDisabled();
  });

  it("allows a linked Stripe subscription to change plans and explains renewal pricing", async () => {
    const user = userEvent.setup();
    renderForm({ stripeCustomerLinked: true, stripeSubscriptionLinked: true });

    const agencyPlan = screen.getByRole("radio", { name: /Plano Agência/i });
    expect(agencyPlan).toBeEnabled();

    await user.click(agencyPlan);
    await user.type(screen.getByRole("textbox", { name: /Nome da agência/i }), "Agência Stripe");

    expect(screen.getByText(/novo preço passa a valer na próxima renovação/i)).toBeVisible();
    expect(screen.getByText(/sem cobrança ou prorrata imediata/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Alterar para Plano Agência/i })).toBeEnabled();
  });

  it("keeps a customer-only Stripe link read-only until billing is regularized", () => {
    renderForm({ stripeCustomerLinked: true });

    expect(screen.getByRole("radio", { name: /Plano Agente/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Plano Agência/i })).toBeDisabled();
    expect(screen.getByText(/cliente no Stripe, mas não tem uma assinatura vinculada/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Alterar para Plano Agente/i })).toBeDisabled();
  });

  it("keeps invitation-managed Agent plans read-only even when Stripe is linked", () => {
    renderForm({
      currentPlan: "AGENT_AGENCY_MEMBER",
      stripeCustomerLinked: true,
      stripeSubscriptionLinked: true,
    });

    expect(screen.getByRole("radio", { name: /Plano Agente/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Plano Agência/i })).toBeDisabled();
    expect(screen.getByText(/faz parte de uma agência por convite/i)).toBeVisible();
    expect(screen.queryByText(/novo preço passa a valer/i)).toBeNull();
  });
});
