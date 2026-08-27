// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HierarchyMetrics } from "./HierarchyMetrics";

describe("HierarchyMetrics", () => {
  it("summarizes only descendants, subagencies and layers", () => {
    render(<HierarchyMetrics peopleBelow={7} agenciesBelow={2} depth={3} />);

    expect(screen.getByText("Pessoas abaixo")).toBeInTheDocument();
    expect(screen.getByText("Subagências")).toBeInTheDocument();
    expect(screen.getByText("Camadas")).toBeInTheDocument();
    expect(screen.queryByText(/liderança/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/acima/i)).not.toBeInTheDocument();
  });
});
