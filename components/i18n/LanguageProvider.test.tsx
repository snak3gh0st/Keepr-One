/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n } from "@/components/i18n/LanguageProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

const { updateUser, refresh } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { updateUser },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function Harness() {
  const { language, changeLanguage, copy, error, isChanging, pendingLanguage } = useI18n();
  return (
    <div>
      <span>{language}</span>
      <span>{copy("Agenda", "Calendar")}</span>
      <span>{isChanging ? `changing:${pendingLanguage}` : "idle"}</span>
      <button type="button" onClick={() => void changeLanguage("EN")}>change-to-en</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("LanguageProvider", () => {
  beforeEach(() => {
    updateUser.mockReset();
    refresh.mockReset();
    document.cookie = "keepr-one.language=; Max-Age=0; Path=/";
    document.documentElement.lang = "pt-BR";
  });

  afterEach(() => cleanup());

  it("keeps the confirmed language visible until the refreshed server tree arrives", async () => {
    const update = deferred<{ data: { status: boolean }; error: null }>();
    updateUser.mockReturnValue(update.promise);
    const { rerender } = render(
      <LanguageProvider initialLanguage="PT"><Harness /></LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "change-to-en" }));

    expect(updateUser).toHaveBeenCalledWith({ language: "EN" });
    expect(screen.getByText("changing:EN")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pt-BR");

    await act(async () => {
      update.resolve({ data: { status: true }, error: null });
      await update.promise;
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(document.cookie).toContain("keepr-one.language=EN");
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("changing:EN")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pt-BR");

    rerender(<LanguageProvider initialLanguage="EN"><Harness /></LanguageProvider>);

    expect(await screen.findByText("Calendar")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("keeps the current language and clears loading when persistence fails", async () => {
    updateUser.mockResolvedValue({ data: null, error: { message: "failed" } });
    render(<LanguageProvider initialLanguage="PT"><Harness /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "change-to-en" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível alterar o idioma",
    );
    expect(screen.getByText("PT")).toBeInTheDocument();
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("follows a language preference refreshed by the server without remounting the provider", async () => {
    const { rerender } = render(
      <LanguageProvider initialLanguage="PT"><Harness /></LanguageProvider>,
    );

    rerender(<LanguageProvider initialLanguage="EN"><Harness /></LanguageProvider>);

    expect(await screen.findByText("Calendar")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("ignores repeated requests while one language change is in flight", () => {
    const update = deferred<{ data: { status: boolean }; error: null }>();
    updateUser.mockReturnValue(update.promise);
    render(<LanguageProvider initialLanguage="PT"><Harness /></LanguageProvider>);

    const button = screen.getByRole("button", { name: "change-to-en" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("announces a pending selection while keeping the confirmed option active", () => {
    const update = deferred<{ data: { status: boolean }; error: null }>();
    updateUser.mockReturnValue(update.promise);
    render(
      <LanguageProvider initialLanguage="PT">
        <LanguageSwitcher />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alterar idioma para Inglês" }));

    expect(screen.getByRole("group", { name: "Idioma" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Alterar idioma para Português" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Alterando para Inglês…" })).toHaveAttribute(
      "data-pending",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Alterando para Inglês");
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
