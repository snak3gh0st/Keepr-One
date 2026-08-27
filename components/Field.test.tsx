// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Input } from "./Field";

describe("Field", () => {
  it("keeps the wrapping-label API compatible with existing forms", () => {
    render(
      <Field label="Nome">
        <Input name="name" />
      </Field>,
    );

    expect(screen.getByLabelText("Nome")).toHaveAttribute("name", "name");
  });

  it("associates explicit labels and accessible field errors", () => {
    render(
      <Field
        label="E-mail"
        htmlFor="profile-email"
        error="Informe um e-mail válido."
        required
      >
        <Input
          id="profile-email"
          type="email"
          aria-invalid="true"
          aria-describedby="profile-email-error"
        />
      </Field>,
    );

    expect(screen.getByLabelText(/E-mail/)).toHaveAccessibleDescription(
      "Informe um e-mail válido.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Informe um e-mail válido.",
    );
  });
});
