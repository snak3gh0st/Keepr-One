// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@gsap/react", () => ({
  useGSAP: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: {
    registerPlugin: vi.fn(),
  },
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
  },
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    copy: (_portuguese: string, english: string) => english,
  }),
}));

import LoginPage from "./page";

afterEach(cleanup);

describe("LoginPage localization", () => {
  it("renders the complete sign-in experience in English", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "placeholder",
      "Enter your password",
    );
    expect(screen.getByRole("button", { name: "Sign in to Keepr One" })).toBeVisible();
    expect(screen.getByText("Operational control")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next signal" })).toBeVisible();
    expect(screen.queryByText("Bem-vindo de volta.")).not.toBeInTheDocument();
  });
});
