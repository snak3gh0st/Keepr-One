// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingSettings, minutesToTime, timeToMinutes, validateSchedulingDraft } from "./SchedulingSettings";

const READY = {
  googleConnected: true,
  freeBusyGranted: true,
  writableDefaultCalendar: true,
  confirmationEmailReady: true,
  canEnable: true,
};

const PAGE = {
  id: "page-1",
  slug: "maria-silva",
  enabled: true,
  title: "Conversa com Maria",
  description: "Escolha um horário.",
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minimumNoticeMinutes: 120,
  maximumAdvanceDays: 30,
  weeklyWindows: [{ id: "window-1", weekday: 1, startMinute: 540, endMinute: 1020 }],
};

let scrollIntoViewMock: ReturnType<typeof vi.fn>;
let scrolledTargets: Element[];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  scrolledTargets = [];
  scrollIntoViewMock = vi.fn(function scrollIntoView(this: Element) {
    scrolledTargets.push(this);
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoViewMock,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SchedulingSettings helpers", () => {
  it("converts wall-clock minutes without changing the owner's timezone", () => {
    expect(minutesToTime(9 * 60 + 5)).toBe("09:05");
    expect(timeToMinutes("17:30")).toBe(1050);
    expect(timeToMinutes("25:00")).toBeNull();
  });

  it("rejects overlapping weekly periods before the API call", () => {
    const errors = validateSchedulingDraft({
      slug: "maria-silva",
      enabled: true,
      title: "Reunião",
      description: "",
      durationMinutes: 30,
      slotIntervalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      minimumNoticeMinutes: 120,
      maximumAdvanceDays: 30,
      weeklyWindows: [
        { clientId: "a", weekday: 1, startMinute: 540, endMinute: 720 },
        { clientId: "b", weekday: 1, startMinute: 660, endMinute: 780 },
      ],
    });
    expect(errors.weeklyWindows).toMatch(/sobrepostos/i);
  });
});

describe("SchedulingSettings", () => {
  it("shows the Google readiness path and keeps publishing disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: null,
      readiness: {
        googleConnected: false,
        freeBusyGranted: false,
        writableDefaultCalendar: false,
        confirmationEmailReady: false,
        canEnable: false,
      },
      ownerTimeZone: "America/New_York",
    })));

    render(<SchedulingSettings />);

    expect(await screen.findByRole("heading", { name: "Página pública" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Rascunho/ })).toBeDisabled();
    expect(screen.getAllByText("Pendente")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Revisar conexão Google" })).toHaveAttribute(
      "href",
      "/agent/integrations/google-calendar",
    );
  });

  it("keeps the editor open when local validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: null,
      readiness: {
        googleConnected: false,
        freeBusyGranted: false,
        writableDefaultCalendar: false,
        confirmationEmailReady: false,
        canEnable: false,
      },
      ownerTimeZone: "America/New_York",
    })));
    const user = userEvent.setup();

    render(<SchedulingSettings />);

    await screen.findByRole("heading", { name: "Página pública" });
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(screen.getByRole("heading", { name: "Página pública" })).toBeVisible();
    expect(screen.getByText(/3 a 64 caracteres/i)).toBeVisible();
  });

  it("explains the infrastructure action when only confirmation e-mail is pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: null,
      readiness: { ...READY, confirmationEmailReady: false, canEnable: false },
      ownerTimeZone: "America/New_York",
    })));

    render(<SchedulingSettings />);

    expect(await screen.findByText(/Solicite a configuração do Resend/i)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Rascunho/ })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Revisar conexão Google" })).not.toBeInTheDocument();
  });

  it("navigates between editor sections and marks the current destination", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: PAGE,
      readiness: READY,
      ownerTimeZone: "America/New_York",
    })));
    const user = userEvent.setup();

    render(<SchedulingSettings />);

    await screen.findByRole("heading", { name: "Página pública" });
    const publicButton = screen.getByRole("button", { name: "Página pública" });
    const availabilityButton = screen.getByRole("button", { name: "Disponibilidade" });
    const publicationButton = screen.getByRole("button", { name: "Publicação" });
    const availabilitySection = document.getElementById("scheduling-hours-section");
    const publicationSection = document.getElementById("scheduling-publication-section");

    expect(publicButton).toHaveAttribute("aria-current", "step");

    await user.click(availabilityButton);

    expect(availabilityButton).toHaveAttribute("aria-current", "step");
    expect(publicButton).not.toHaveAttribute("aria-current");
    expect(scrolledTargets.at(-1)).toBe(availabilitySection);
    expect(availabilitySection).toHaveFocus();
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });

    await user.click(publicationButton);

    expect(publicationButton).toHaveAttribute("aria-current", "step");
    expect(availabilityButton).not.toHaveAttribute("aria-current");
    expect(scrolledTargets.at(-1)).toBe(publicationSection);
    expect(publicationSection).toHaveFocus();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });

  it("starts a persisted page as saved and enables saving after an edit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: PAGE,
      readiness: READY,
      ownerTimeZone: "America/New_York",
    })));
    const user = userEvent.setup();

    render(<SchedulingSettings />);

    const title = await screen.findByLabelText("Título");
    const savedButton = screen.getByRole("button", { name: "Salvo" });
    expect(savedButton).toBeDisabled();
    expect(screen.getByText("Tudo salvo.")).toBeVisible();

    await user.type(title, "!");

    expect(screen.getByRole("button", { name: "Salvar e publicar" })).toBeEnabled();
    expect(screen.getByText("Alterações não salvas.")).toBeVisible();
  });

  it("copies only the last persisted public slug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: PAGE,
      readiness: READY,
      ownerTimeZone: "America/New_York",
    })));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<SchedulingSettings />);

    const slug = await screen.findByLabelText("Endereço do link");
    await user.clear(slug);
    await user.type(slug, "link-ainda-nao-salvo");
    await user.click(screen.getByRole("button", { name: "Copiar link publicado" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/agendar/maria-silva`,
    );
    expect(screen.getByText(/Salve as alterações/)).toBeVisible();
  });

  it("sends a complete PUT without client-only window ids", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ page: PAGE, readiness: READY, ownerTimeZone: "America/New_York" }))
      .mockResolvedValueOnce(json({ page: { ...PAGE, title: "Reunião inicial" }, readiness: READY, ownerTimeZone: "America/New_York" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SchedulingSettings />);

    const title = await screen.findByLabelText("Título");
    await user.clear(title);
    await user.type(title, "Reunião inicial");
    await user.click(screen.getByRole("button", { name: "Salvar e publicar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(request.method).toBe("PUT");
    expect(body).toMatchObject({
      slug: "maria-silva",
      enabled: true,
      title: "Reunião inicial",
      durationMinutes: 30,
      weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
    });
    expect(JSON.stringify(body)).not.toContain("clientId");
  });
});
