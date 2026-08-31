// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocalizedPolicyStatusPill } from "./LocalizedPolicyStatusPill";

describe("LocalizedPolicyStatusPill", () => {
  it("renders the policy status in Portuguese", () => {
    render(<LocalizedPolicyStatusPill status="INFORCE" language="PT" />);
    expect(screen.getByText("Em vigor")).toBeInTheDocument();
  });

  it("renders the policy status in English", () => {
    render(<LocalizedPolicyStatusPill status="INFORCE" language="EN" />);
    expect(screen.getByText("In force")).toBeInTheDocument();
  });

  it("preserves unknown status codes", () => {
    render(<LocalizedPolicyStatusPill status="CUSTOM_STATUS" language="EN" />);
    expect(screen.getByText("CUSTOM_STATUS")).toBeInTheDocument();
  });
});
