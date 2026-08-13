// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";

afterEach(cleanup);

describe("GoogleCalendarSettings", () => {
  it("presents the disconnected state as an operational setup card", () => {
    render(
      <GoogleCalendarSettings
        status="DISCONNECTED"
        email={null}
        calendars={[]}
        lastSyncAt={null}
        configured
      />,
    );

    expect(screen.getByRole("heading", { name: "Conecte sua agenda Google" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Conectar Google Calendar/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/agent/integrations/google-calendar/authorize"),
    );
    expect(screen.getByText("Agenda unificada")).toBeInTheDocument();
    expect(screen.getByText("Tokens criptografados")).toBeInTheDocument();
  });

  it("shows an inert environment notice when OAuth is not configured", () => {
    render(
      <GoogleCalendarSettings
        status="DISCONNECTED"
        email={null}
        calendars={[]}
        lastSyncAt={null}
        configured={false}
      />,
    );

    expect(screen.getByText("Configuração do ambiente pendente")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Conectar Google Calendar/ })).not.toBeInTheDocument();
  });

  it("keeps connection details and sources visible in the steady connected state", () => {
    render(
      <GoogleCalendarSettings
        status="CONNECTED"
        email="agente@example.com"
        calendars={[{
          id: "calendar-1",
          name: "Principal",
          visible: true,
          isDefault: true,
          color: "#69df93",
          canWrite: true,
          syncStatus: "SYNCED",
        }]}
        lastSyncAt="2026-08-12T13:30:00.000Z"
        configured
      />,
    );

    expect(screen.getByText("Conexão ativa")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "agente@example.com" })).toBeInTheDocument();
    expect(screen.getByText("Padrão para novos compromissos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar conta" })).toBeInTheDocument();
  });

  it("uses a specific reconnect CTA when Google authorization expires", () => {
    render(
      <GoogleCalendarSettings
        status="RECONNECT_REQUIRED"
        email="agente@example.com"
        calendars={[]}
        lastSyncAt={null}
        configured
      />,
    );

    expect(screen.getByText("A autorização expirou. Reconecte para retomar a sincronização sem perder seus vínculos.")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: /Reconectar/ })) {
      expect(link).toHaveAttribute("href", expect.stringContaining("/api/agent/integrations/google-calendar/authorize"));
    }
  });

  it("keeps the calendar usable while the initial sync is in progress", () => {
    render(
      <GoogleCalendarSettings
        status="CONNECTED"
        email="agente@example.com"
        calendars={[{
          id: "calendar-1",
          name: "Principal",
          visible: true,
          isDefault: true,
          color: "#69df93",
          canWrite: true,
          syncStatus: "PROCESSING",
        }]}
        lastSyncAt={null}
        configured
      />,
    );

    expect(screen.getByText("Sincronizando")).toBeInTheDocument();
    expect(screen.getByText(/Você já pode continuar usando/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir Agenda/ })).toHaveAttribute("href", "/agent/calendar");
  });

  it("offers an explicit retry when one calendar source fails", () => {
    render(
      <GoogleCalendarSettings
        status="CONNECTED"
        email="agente@example.com"
        calendars={[{
          id: "calendar-1",
          name: "Principal",
          visible: true,
          isDefault: true,
          color: "#69df93",
          canWrite: true,
          syncStatus: "ERROR",
        }]}
        lastSyncAt={null}
        configured
      />,
    );

    expect(screen.getByText("Sincronização parcial")).toBeInTheDocument();
    expect(screen.getByText("Falha ao sincronizar")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Tentar novamente/ }).length).toBeGreaterThan(0);
  });
});
