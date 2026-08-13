// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineRail } from "./PipelineRail";

const stages = [
  {
    id: "new",
    name: "Novo Lead",
    position: 0,
    systemKey: "NEW_LEAD",
    active: true,
    caseCount: 3,
  },
  {
    id: "follow",
    name: "Follow-up",
    position: 1,
    systemKey: "FOLLOW_UP",
    active: true,
    caseCount: 2,
  },
];

afterEach(cleanup);

describe("PipelineRail", () => {
  it("keeps Todos virtual and selects a semantic pipeline stage", async () => {
    const onChange = vi.fn();
    render(
      <PipelineRail
        stages={stages}
        allCount={5}
        activeStageKey={null}
        onStageChange={onChange}
        panelId="pipeline-results"
      />,
    );

    expect(screen.getByRole("tab", { name: /Todos.*5 leads/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Todos.*5 leads/i })).toHaveAttribute(
      "aria-controls",
      "pipeline-results",
    );
    await userEvent.click(screen.getByRole("tab", { name: /Follow-up.*2 leads/i }));
    expect(onChange).toHaveBeenCalledWith("system:FOLLOW_UP");
  });

  it("supports arrow-key navigation", async () => {
    const onChange = vi.fn();
    render(
      <PipelineRail
        stages={stages}
        allCount={5}
        activeStageKey={null}
        onStageChange={onChange}
      />,
    );

    const all = screen.getByRole("tab", { name: /Todos.*5 leads/i });
    all.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("system:NEW_LEAD");
  });
});
