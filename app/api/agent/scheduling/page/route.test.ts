import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getReadiness: vi.fn(),
  sameOrigin: vi.fn(),
  userFindUnique: vi.fn(),
  pageFindUnique: vi.fn(),
  transaction: vi.fn(),
  pageUpsert: vi.fn(),
  windowsDeleteMany: vi.fn(),
  windowsCreateMany: vi.fn(),
}));

vi.mock("@/lib/agent-context", () => ({ getCurrentAgent: mocks.getCurrentAgent }));
vi.mock("@/lib/scheduling/readiness", () => ({ getSchedulingReadinessForUser: mocks.getReadiness }));
vi.mock("@/lib/security/same-origin-action", () => ({ assertSameOriginAction: mocks.sameOrigin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    schedulingPage: { findUnique: mocks.pageFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { GET, PUT } from "./route";

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
  title: "Reunião",
  description: null,
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minimumNoticeMinutes: 120,
  maximumAdvanceDays: 30,
  weeklyWindows: [{ id: "window-1", weekday: 1, startMinute: 540, endMinute: 1020 }],
};

const VALID_INPUT = {
  slug: "maria-silva",
  enabled: true,
  title: "Reunião",
  description: null,
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minimumNoticeMinutes: 120,
  maximumAdvanceDays: 30,
  weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
};

function request(body: unknown) {
  return new Request("https://app.keepr.one/api/agent/scheduling/page", {
    method: "PUT",
    headers: {
      origin: "https://app.keepr.one",
      host: "app.keepr.one",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAgent.mockResolvedValue({ userId: "owner-1" });
  mocks.getReadiness.mockResolvedValue(READY);
  mocks.userFindUnique.mockResolvedValue({ timeZone: "America/New_York" });
  mocks.pageFindUnique.mockResolvedValue(PAGE);
  mocks.pageUpsert.mockResolvedValue({ id: "page-1" });
  mocks.windowsDeleteMany.mockResolvedValue({ count: 1 });
  mocks.windowsCreateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback) => callback({
    schedulingPage: { upsert: mocks.pageUpsert },
    schedulingWeeklyWindow: {
      deleteMany: mocks.windowsDeleteMany,
      createMany: mocks.windowsCreateMany,
    },
  }));
});

describe("agent scheduling page API", () => {
  it("returns the authenticated owner's page, readiness and timezone", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      page: PAGE,
      readiness: READY,
      ownerTimeZone: "America/New_York",
    });
    expect(mocks.pageFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: "owner-1" },
    }));
  });

  it("rejects cross-origin writes before authentication", async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error("bad origin"); });
    const response = await PUT(request(VALID_INPUT));
    expect(response.status).toBe(403);
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown fields through the strict input schema", async () => {
    const response = await PUT(request({ ...VALID_INPUT, ownerUserId: "attacker-controlled" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not publish when Google availability is incomplete", async () => {
    mocks.getReadiness.mockResolvedValueOnce({ ...READY, freeBusyGranted: false, canEnable: false });
    const response = await PUT(request(VALID_INPUT));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "SCHEDULING_INTEGRATIONS_REQUIRED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not publish when confirmation e-mail delivery is not configured", async () => {
    mocks.getReadiness.mockResolvedValueOnce({
      ...READY,
      confirmationEmailReady: false,
      canEnable: false,
    });
    const response = await PUT(request(VALID_INPUT));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "SCHEDULING_INTEGRATIONS_REQUIRED",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("upserts ownership and replaces normalized weekly windows atomically", async () => {
    const response = await PUT(request({
      ...VALID_INPUT,
      weeklyWindows: [
        { weekday: 5, startMinute: 600, endMinute: 900 },
        { weekday: 1, startMinute: 540, endMinute: 1020 },
      ],
    }));
    expect(response.status).toBe(200);
    expect(mocks.pageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: "owner-1" },
      create: expect.objectContaining({ ownerUserId: "owner-1", slug: "maria-silva" }),
    }));
    expect(mocks.windowsDeleteMany).toHaveBeenCalledWith({ where: { pageId: "page-1" } });
    expect(mocks.windowsCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: "page-1", weekday: 1, startMinute: 540, endMinute: 1020 },
        { pageId: "page-1", weekday: 5, startMinute: 600, endMinute: 900 },
      ],
    });
  });
});
