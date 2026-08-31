// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicScheduling, dateKeyInTimeZone, slotsByLocalDate } from "./PublicScheduling";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function futureSlot(offsetDays = 1, offsetMinutes = 0) {
  const startsAt = new Date(Date.now() + offsetDays * 86_400_000);
  startsAt.setUTCSeconds(0, 0);
  startsAt.setUTCMinutes(offsetMinutes);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

function page(ownerTimeZone = "America/New_York", ownerLanguage: "PT" | "EN" = "PT") {
  return {
    slug: "maria-silva",
    title: "Conversa de 30 minutos",
    description: "Escolha o horário mais conveniente.",
    durationMinutes: 30,
    ownerName: "Maria Silva",
    ownerLanguage,
    ownerTimeZone,
  };
}

function timeButton() {
  return screen.getAllByRole("button").find((button) => /^\d{2}:\d{2}$/.test(button.textContent ?? ""));
}

async function fillGuestForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nome completo"), "Ana Cliente");
  await user.type(screen.getByLabelText("E-mail"), "ana@example.com");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public scheduling timezone helpers", () => {
  it("groups the same instant under the visitor's local date", () => {
    const slot = { startsAt: "2026-08-29T01:00:00.000Z", endsAt: "2026-08-29T01:30:00.000Z" };
    expect(dateKeyInTimeZone(new Date(slot.startsAt), "UTC")).toBe("2026-08-29");
    expect([...slotsByLocalDate([slot], "America/New_York").keys()]).toEqual(["2026-08-28"]);
  });
});

describe("PublicScheduling", () => {
  it("uses the owner language while preserving the agent-created event copy", async () => {
    const slot = futureSlot(1, 0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: page("America/New_York", "EN"),
      slots: [slot],
    })));
    const user = userEvent.setup();

    render(<PublicScheduling slug="maria-silva" initialLanguage="EN" />);

    expect(await screen.findByRole("heading", { name: "Conversa de 30 minutos" })).toBeVisible();
    expect(screen.getByText("Meeting with Maria Silva")).toBeVisible();
    expect(screen.getByRole("group", { name: "Available dates" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeDisabled();
    await user.click(timeButton()!);
    expect(await screen.findByRole("heading", { name: "Confirm your details" })).toHaveFocus();
    expect(screen.getByLabelText("Full name")).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeVisible();
  });

  it("shows one week at a time and keeps the navigation within fourteen days", async () => {
    const firstWeekSlot = futureSlot(1, 0);
    const secondWeekSlot = futureSlot(8, 30);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: page(),
      slots: [firstWeekSlot, secondWeekSlot],
    })));
    const user = userEvent.setup();
    render(<PublicScheduling slug="maria-silva" />);

    await screen.findByRole("heading", { name: "Conversa de 30 minutos" });
    const dates = screen.getByRole("group", { name: "Datas disponíveis" });
    expect(within(dates).getAllByRole("button")).toHaveLength(7);
    const previous = screen.getByRole("button", { name: "Semana anterior" });
    const next = screen.getByRole("button", { name: "Próxima semana" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    const firstTime = timeButton()?.textContent;

    await user.click(next);

    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    await waitFor(() => expect(timeButton()?.textContent).not.toBe(firstTime));
  });

  it("opens on the week containing the first available slot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      page: page(),
      slots: [futureSlot(8, 0)],
    })));
    render(<PublicScheduling slug="maria-silva" />);

    await screen.findByRole("heading", { name: "Conversa de 30 minutos" });
    expect(screen.getByRole("button", { name: "Semana anterior" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Próxima semana" })).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Datas disponíveis" })).getAllByRole("button")).toHaveLength(7);
  });

  it("books the selected slot and renders a direct confirmation", async () => {
    const slot = futureSlot();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ page: page(), slots: [slot] }))
      .mockResolvedValueOnce(json({
        booking: {
          id: "booking-1",
          status: "CONFIRMED",
          title: "Conversa de 30 minutos",
          ownerName: "Maria Silva",
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          inviteeTimeZone: zone,
        },
        idempotent: false,
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PublicScheduling slug="maria-silva" />);

    expect(await screen.findByRole("heading", { name: "Conversa de 30 minutos" })).toBeVisible();
    const availableTime = timeButton();
    expect(availableTime).toBeDefined();
    await user.click(availableTime!);
    await user.click(screen.getByRole("button", { name: /Voltar aos horários/ }));
    await waitFor(() => expect(timeButton()).toHaveFocus());
    await user.click(timeButton()!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Confirme seus dados" })).toHaveFocus());
    await fillGuestForm(user);
    await user.click(screen.getByRole("button", { name: "Confirmar agendamento" }));

    const confirmationHeading = await screen.findByRole("heading", { name: "Agendamento confirmado" });
    expect(confirmationHeading).toHaveFocus();
    expect(screen.getByText("Conversa de 30 minutos")).toBeVisible();
    expect(screen.getByText(/Nova York|New York|UTC/)).toBeVisible();

    const calendarDisclosure = screen.getByText("Adicionar à agenda").closest("summary");
    expect(calendarDisclosure).not.toBeNull();
    await user.click(calendarDisclosure!);

    const googleLink = screen.getByRole("link", { name: /Google Agenda/ });
    const googleUrl = new URL(googleLink.getAttribute("href")!);
    expect(googleUrl.origin).toBe("https://calendar.google.com");
    expect(googleUrl.searchParams.get("text")).toBe("Conversa de 30 minutos");
    expect(googleLink).toHaveAttribute("target", "_blank");
    expect(googleLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(googleLink).toHaveAttribute("referrerpolicy", "no-referrer");

    const outlookLink = screen.getByRole("link", { name: /Microsoft Outlook/ });
    expect(new URL(outlookLink.getAttribute("href")!).origin).toBe("https://outlook.live.com");
    expect(screen.getByRole("button", { name: /Apple Calendar e outros/ })).toBeVisible();
    const [, bookingRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(bookingRequest.body));
    expect(body).toMatchObject({
      startsAt: slot.startsAt,
      name: "Ana Cliente",
      email: "ana@example.com",
      timeZone: zone,
      hp: "",
    });
    expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("refreshes availability after a 409 without keeping the stale selection", async () => {
    const firstSlot = futureSlot(1, 0);
    const replacementSlot = futureSlot(1, 30);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ page: page(), slots: [firstSlot] }))
      .mockResolvedValueOnce(json({ error: "SLOT_UNAVAILABLE", message: "Este horário acabou de ser reservado." }, 409))
      .mockResolvedValueOnce(json({ page: page(), slots: [replacementSlot] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PublicScheduling slug="maria-silva" />);

    await screen.findByRole("heading", { name: "Conversa de 30 minutos" });
    await user.click(timeButton()!);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Confirme seus dados" })).toHaveFocus());
    await fillGuestForm(user);
    await user.click(screen.getByRole("button", { name: "Confirmar agendamento" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3_000 });
    expect(await screen.findByRole("alert", undefined, { timeout: 3_000 })).toHaveTextContent("Este horário acabou de ser reservado.");
    expect(screen.queryByRole("heading", { name: "Confirme seus dados" })).not.toBeInTheDocument();
    expect(timeButton()).toBeDefined();
  });

  it("keeps the guest data available for retry after a temporary provider failure", async () => {
    const slot = futureSlot();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ page: page(), slots: [slot] }))
      .mockResolvedValueOnce(json({
        error: "SCHEDULING_UNAVAILABLE",
        message: "Não foi possível confirmar a disponibilidade com o Google Agenda.",
      }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PublicScheduling slug="maria-silva" />);

    await screen.findByRole("heading", { name: "Conversa de 30 minutos" });
    await user.click(timeButton()!);
    await fillGuestForm(user);
    await user.click(screen.getByRole("button", { name: "Confirmar agendamento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Google Agenda/);
    expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Cliente");
    expect(screen.getByLabelText("E-mail")).toHaveValue("ana@example.com");
    expect(screen.getByRole("button", { name: "Confirmar agendamento" })).toBeEnabled();
  });
});
