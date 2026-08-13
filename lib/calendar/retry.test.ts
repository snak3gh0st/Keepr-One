import { describe, expect, it, vi } from "vitest";
import { retryCalendarEventSync } from "./retry";

describe("retryCalendarEventSync", () => {
  it("reopens the existing dead-letter job without creating a duplicate", async () => {
    const updateJob = vi.fn(async () => ({ count: 1 }));
    const updateEvent = vi.fn(async () => ({ count: 1 }));
    const tx = {
      calendarEvent: {
        findFirst: vi.fn(async () => ({ id: "event-1", localRevision: 4 })),
        updateMany: updateEvent,
      },
      calendarSyncJob: {
        findFirst: vi.fn(async () => ({ id: "job-1", status: "DEAD_LETTER" })),
        updateMany: updateJob,
      },
    };
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) };

    await expect(retryCalendarEventSync(
      { ownerUserId: "user-1", eventId: "event-1" },
      db as never,
    )).resolves.toEqual({ eventId: "event-1", jobId: "job-1" });

    expect(updateJob).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", status: { in: ["FAILED", "DEAD_LETTER"] } },
      data: expect.objectContaining({ status: "PENDING", attempts: 0 }),
    }));
    expect(updateEvent).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: "user-1", localRevision: 4 }),
      data: { syncStatus: "PENDING", syncErrorCode: null },
    }));
  });

  it("is idempotent while the same retry is already pending", async () => {
    const updateJob = vi.fn();
    const tx = {
      calendarEvent: {
        findFirst: vi.fn(async () => ({ id: "event-1", localRevision: 4 })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      calendarSyncJob: {
        findFirst: vi.fn(async () => ({ id: "job-1", status: "PENDING" })),
        updateMany: updateJob,
      },
    };
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) };
    await retryCalendarEventSync({ ownerUserId: "user-1", eventId: "event-1" }, db as never);
    expect(updateJob).not.toHaveBeenCalled();
  });
});
