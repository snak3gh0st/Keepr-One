// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    copy: (_portuguese: string, english: string) => english,
  }),
}));

vi.mock("motion/react", () => ({
  motion: {
    tr: ({ children, ...props }: React.ComponentProps<"tr">) => (
      <tr {...props}>{children}</tr>
    ),
  },
  useReducedMotion: () => true,
}));

import { ContextPanel } from "./ContextPanel";
import { Table, Td, Th, Thead, Tr } from "./Table";

afterEach(cleanup);

describe("localized shared UI", () => {
  it("localizes the fixed ContextPanel status", () => {
    render(
      <ContextPanel title="Account summary">
        <p>Details</p>
      </ContextPanel>,
    );

    expect(screen.getByText("Connected operation")).toBeVisible();
    expect(screen.queryByText("Operação conectada")).not.toBeInTheDocument();
  });

  it("localizes the default accessible table label", () => {
    render(
      <Table>
        <Thead>
          <Tr>
            <Th>Name</Th>
          </Tr>
        </Thead>
        <tbody>
          <Tr>
            <Td>Ana</Td>
          </Tr>
        </tbody>
      </Table>,
    );

    expect(screen.getByRole("region", { name: "Data table" })).toBeVisible();
    expect(screen.getByText("Data table", { selector: "caption" })).toHaveClass("sr-only");
  });
});
