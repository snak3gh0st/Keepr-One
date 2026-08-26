// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrialCountdownPhase,
  TrialCountdown,
} from "./TrialCountdown";

const DAY = 24 * 60 * 60;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TrialCountdown", () => {
  it("derives its first render from the serialized server clock, not the browser clock", () => {
    render(
      <TrialCountdown
        endsAt="2026-09-25T12:00:30.000Z"
        serverNow="2026-09-25T12:00:00.000Z"
      />,
    );

    const timer = screen.getByRole("timer");
    expect(timer).toHaveAccessibleName(
      "Tempo restante do período gratuito: 0 dias, 0 horas, 0 minutos, 30 segundos.",
    );
    expect(timer).toHaveAttribute("aria-live", "off");
    expect(screen.getByText("Últimas 24 horas")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("hydrates the server-rendered timer without changing its initial markup", async () => {
    const element = (
      <TrialCountdown
        endsAt="2026-09-25T12:00:30.000Z"
        serverNow="2026-09-25T12:00:00.000Z"
      />
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    const serverMarkup = container.innerHTML;
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(container, element);
    });

    expect(container.innerHTML).toBe(serverMarkup);

    act(() => {
      root?.unmount();
    });
  });

  it("ticks once per second and stops at zero without announcing every tick", () => {
    render(
      <TrialCountdown
        endsAt="2026-09-25T12:00:02.000Z"
        initialRemainingSeconds={2}
      />,
    );

    expect(screen.getByRole("timer")).toHaveAccessibleName(/2 segundos/);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("timer")).toHaveAccessibleName(/1 segundo/);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("timer")).toHaveAccessibleName(
      "O período gratuito foi encerrado. Tempo restante: zero.",
    );
    expect(screen.getByText("Período gratuito encerrado")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("timer")).toHaveAccessibleName(
      "O período gratuito foi encerrado. Tempo restante: zero.",
    );
  });

  it("offers the plan action and reports expiration only once", () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <TrialCountdown
        endsAt="2032-01-01T00:00:01.000Z"
        initialRemainingSeconds={1}
        actionHref="/agent/agency"
        actionLabel="Escolher assinatura"
        onExpire={onExpire}
      />,
    );

    expect(screen.getByRole("link", { name: "Escolher assinatura" })).toHaveAttribute(
      "href",
      "/agent/agency",
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender(
      <TrialCountdown
        endsAt="2032-01-01T00:00:01.000Z"
        initialRemainingSeconds={1}
        actionHref="/agent/agency"
        onExpire={onExpire}
      />,
    );
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("corrects elapsed time immediately when a suspended tab becomes visible", () => {
    render(
      <TrialCountdown
        endsAt="2032-01-01T00:00:10.000Z"
        initialRemainingSeconds={10}
      />,
    );

    vi.setSystemTime(new Date("2032-01-01T00:00:05.000Z"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByRole("timer")).toHaveAccessibleName(/5 segundos/);
  });

  it.each([
    [7 * DAY + 1, "normal", "Teste gratuito ativo"],
    [7 * DAY, "last-7-days", "Últimos 7 dias"],
    [DAY, "last-24-hours", "Últimas 24 horas"],
    [0, "expired", "Período gratuito encerrado"],
  ] as const)(
    "renders %s remaining seconds as the %s state",
    (initialRemainingSeconds, expectedState, expectedLabel) => {
      const { container } = render(
        <TrialCountdown
          endsAt="2026-10-25T12:00:00.000Z"
          initialRemainingSeconds={initialRemainingSeconds}
        />,
      );

      expect(container.querySelector(".trial-countdown")).toHaveAttribute(
        "data-state",
        expectedState,
      );
      expect(screen.getByText(expectedLabel)).toBeVisible();
    },
  );

  it("resets cleanly when a new serialized trial window is supplied", () => {
    const { rerender } = render(
      <TrialCountdown
        endsAt="2026-09-25T12:00:10.000Z"
        initialRemainingSeconds={10}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("timer")).toHaveAccessibleName(/7 segundos/);

    rerender(
      <TrialCountdown
        endsAt="2026-10-25T12:00:00.000Z"
        initialRemainingSeconds={30 * DAY}
      />,
    );

    expect(screen.getByRole("timer")).toHaveAccessibleName(/30 dias/);
    expect(screen.getByText("Teste gratuito ativo")).toBeVisible();
  });

  it("fails closed for malformed serialized timestamps", () => {
    const { container } = render(
      <TrialCountdown endsAt="not-an-iso-date" serverNow="also-invalid" />,
    );

    expect(container.querySelector(".trial-countdown")).toHaveAttribute(
      "data-state",
      "expired",
    );
  });
});

describe("getTrialCountdownPhase", () => {
  it("uses inclusive urgency boundaries", () => {
    expect(getTrialCountdownPhase(7 * DAY + 1)).toBe("normal");
    expect(getTrialCountdownPhase(7 * DAY)).toBe("last-7-days");
    expect(getTrialCountdownPhase(DAY)).toBe("last-24-hours");
    expect(getTrialCountdownPhase(1)).toBe("last-24-hours");
    expect(getTrialCountdownPhase(0)).toBe("expired");
  });
});
