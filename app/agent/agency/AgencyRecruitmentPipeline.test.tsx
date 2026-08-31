// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { AgencyRecruitmentPipeline } from "./AgencyRecruitmentPipeline";

vi.mock("@/lib/auth-client", () => ({
  authClient: { updateUser: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const STAGES = [
  { id: "PROSPECT", label: "Prospecto", count: 0 },
  { id: "CONTACTED", label: "Contato realizado", count: 3 },
  {
    id: "QUALIFIED",
    label: "Qualificado",
    count: 1,
    description: "Pronto para receber uma proposta de vínculo.",
  },
] as const;

describe("AgencyRecruitmentPipeline", () => {
  it("opens the first stage with relationships by default", () => {
    render(<AgencyRecruitmentPipeline stages={STAGES} />);

    expect(
      screen.getByRole("tab", { name: /Contato realizado.*3 vínculos/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: /Prospecto.*0 vínculos/i }),
    ).toHaveAttribute("aria-selected", "false");
    expect(
      screen.getByText("3 vínculos diretos estão avançando por esta etapa."),
    ).toBeVisible();
  });

  it("uses the first stage when every count is zero", () => {
    render(
      <AgencyRecruitmentPipeline
        stages={STAGES.map((stage) => ({ ...stage, count: 0 }))}
      />,
    );

    expect(
      screen.getByRole("tab", { name: /Prospecto.*0 vínculos/i }),
    ).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: /Prospecto/i });
    expect(
      within(panel).getByText("Nenhum vínculo direto está nesta etapa agora."),
    ).toBeVisible();
  });

  it("selects a stage on click and exposes its labelled panel", async () => {
    const user = userEvent.setup();
    render(<AgencyRecruitmentPipeline stages={STAGES} />);

    const qualifiedTrigger = screen.getByRole("tab", {
      name: /Qualificado.*1 vínculo/i,
    });
    await user.click(qualifiedTrigger);

    expect(qualifiedTrigger).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: /Qualificado/i });
    expect(panel).toHaveTextContent(
      "Pronto para receber uma proposta de vínculo.",
    );
  });

  it("uses roving focus and arrow keys to navigate stages", async () => {
    const user = userEvent.setup();
    render(<AgencyRecruitmentPipeline stages={STAGES} />);

    const contactedTrigger = screen.getByRole("tab", {
      name: /Contato realizado.*3 vínculos/i,
    });
    const prospectTrigger = screen.getByRole("tab", {
      name: /Prospecto.*0 vínculos/i,
    });
    const qualifiedTrigger = screen.getByRole("tab", {
      name: /Qualificado.*1 vínculo/i,
    });

    await user.tab();
    expect(contactedTrigger).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    expect(qualifiedTrigger).toHaveFocus();
    expect(qualifiedTrigger).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: /Qualificado/i }),
    ).toHaveTextContent("Pronto para receber uma proposta de vínculo.");

    await user.keyboard("{Home}");
    expect(prospectTrigger).toHaveFocus();
    expect(prospectTrigger).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}{ArrowLeft}");
    expect(contactedTrigger).toHaveFocus();
    expect(contactedTrigger).toHaveAttribute("aria-selected", "true");
  });

  it("renders nothing without stages", () => {
    const { container } = render(<AgencyRecruitmentPipeline stages={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("localizes the complete accessible stage label in English", () => {
    render(
      <LanguageProvider initialLanguage="EN">
        <AgencyRecruitmentPipeline
          stages={[{ id: "PROSPECT", label: "Prospect", count: 0 }]}
        />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("tab", {
        name: "Prospect. 0 connections in this stage.",
      }),
    ).toBeInTheDocument();
  });
});
