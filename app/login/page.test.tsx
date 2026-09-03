// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

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
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signIn },
    signOut: mocks.signOut,
  },
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useI18n: () => ({
    copy: (_portuguese: string, english: string) => english,
  }),
}));

import LoginPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/login");
  mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
});

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

  it("routes administrative credentials to the dedicated admin entry", async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: "admin-1", role: "ADMIN" } },
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("E-mail"), "manager@keeprone.com");
    await user.type(screen.getByLabelText("Password"), "secure-password");
    await user.click(screen.getByRole("button", { name: "Sign in to Keepr One" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Administrative accounts sign in through the dedicated back-office area.",
    );
    expect(screen.getByRole("link", { name: /Go to admin sign in/ })).toHaveAttribute(
      "href",
      "/admin/login",
    );
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
