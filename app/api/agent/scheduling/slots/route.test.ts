import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getAgentScopeIds: vi.fn(),
  getNextSlots: vi.fn(),
}));

vi.mock("@/lib/agent-context", () => ({ getCurrentAgent: mocks.getCurrentAgent }));
vi.mock("@/lib/agent-access", () => ({ getAgentScopeIds: mocks.getAgentScopeIds }));
vi.mock("@/lib/scheduling/agent-availability", () => ({
  getNextSchedulingSlotsForAgent: mocks.getNextSlots,
}));

import { GET } from "./route";

const AVAILABLE = {
  available: true,
  slug: "maria-silva",
  page: {
    slug: "maria-silva",
    title: "Conversa inicial",
    description: null,
    durationMinutes: 30,
    ownerName: "Maria Silva",
    ownerLanguage: "PT",
    ownerTimeZone: "America/New_York",
  },
  slots: [{ startsAt: "2026-08-17T13:00:00.000Z", endsAt: "2026-08-17T13:30:00.000Z" }],
};

function request(query = "") {
  return new Request(`https://app.keepr.one/api/agent/scheduling/slots${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAgent.mockResolvedValue({ id: "agent-1", userId: "owner-1" });
  mocks.getAgentScopeIds.mockResolvedValue(["agent-1"]);
  mocks.getNextSlots.mockResolvedValue(AVAILABLE);
});

describe("agent scheduling slots API", () => {
  it("returns the caller's own next free slots by default", async () => {
    const response = await GET(request("?limit=3"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(AVAILABLE);
    expect(mocks.getNextSlots).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "agent-1",
      limit: 3,
    }));
    expect(mocks.getAgentScopeIds).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers before touching the agenda", async () => {
    mocks.getCurrentAgent.mockRejectedValueOnce(new Error("no session"));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.getNextSlots).not.toHaveBeenCalled();
  });

  it("does not let an agent read another agent's agenda", async () => {
    const response = await GET(request("?agentId=agent-2"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mocks.getNextSlots).not.toHaveBeenCalled();
  });

  it("resolves the caller's own scope, never the requested agent's", async () => {
    mocks.getAgentScopeIds.mockResolvedValueOnce(["agent-1", "agent-2"]);
    const response = await GET(request("?agentId=agent-2"));
    expect(response.status).toBe(200);
    expect(mocks.getAgentScopeIds).toHaveBeenCalledWith("agent-1");
    expect(mocks.getNextSlots).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "agent-2",
    }));
  });

  it("rejects unknown query parameters instead of ignoring them", async () => {
    const response = await GET(request("?ownerUserId=attacker-controlled"));
    expect(response.status).toBe(400);
    expect(mocks.getNextSlots).not.toHaveBeenCalled();
  });

  it("rejects a limit above the supported ceiling", async () => {
    const response = await GET(request("?limit=500"));
    expect(response.status).toBe(400);
    expect(mocks.getNextSlots).not.toHaveBeenCalled();
  });

  it("passes the missing-page reason through so the K-BOT can explain it", async () => {
    mocks.getNextSlots.mockResolvedValueOnce({ available: false, reason: "NO_SCHEDULING_PAGE" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: "NO_SCHEDULING_PAGE",
    });
  });

  it("does not answer with an agenda when the lookup fails unexpectedly", async () => {
    mocks.getNextSlots.mockRejectedValueOnce(new Error("database offline"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "SCHEDULING_SLOTS_FAILED" });
  });
});
