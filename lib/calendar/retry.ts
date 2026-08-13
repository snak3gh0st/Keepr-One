import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CalendarDomainError } from "./access";

type RetryDb = Pick<PrismaClient, "$transaction">;

/**
 * Reopens the existing outbox row instead of creating a second provider
 * mutation. Repeated clicks remain idempotent because PENDING/PROCESSING jobs
 * are simply returned as the active retry.
 */
export async function retryCalendarEventSync(
  input: { ownerUserId: string; eventId: string },
  db: RetryDb = prisma,
) {
  return db.$transaction(async (tx) => {
    const event = await tx.calendarEvent.findFirst({
      where: {
        id: input.eventId,
        ownerUserId: input.ownerUserId,
        integration: { userId: input.ownerUserId },
        syncStatus: "ERROR",
      },
      select: { id: true, localRevision: true },
    });
    if (!event) {
      throw new CalendarDomainError(
        "EVENT_NOT_FOUND",
        "Esse compromisso não possui uma falha de sincronização pendente.",
      );
    }

    const job = await tx.calendarSyncJob.findFirst({
      where: {
        eventId: event.id,
        desiredRevision: event.localRevision,
        direction: "OUTBOUND",
        operation: { in: ["CREATE_EVENT", "UPDATE_EVENT", "DELETE_EVENT"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!job) {
      throw new CalendarDomainError(
        "EVENT_NOT_FOUND",
        "Não encontramos a tentativa original. Atualize o compromisso para gerar uma nova sincronização.",
      );
    }

    if (job.status !== "PENDING" && job.status !== "PROCESSING" && job.status !== "FAILED" && job.status !== "DEAD_LETTER") {
      throw new CalendarDomainError(
        "VALIDATION_ERROR",
        "A tentativa original já foi concluída. Recarregue a agenda para ver o estado atual.",
      );
    }
    if (job.status === "FAILED" || job.status === "DEAD_LETTER") {
      await tx.calendarSyncJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["FAILED", "DEAD_LETTER"] },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
        },
      });
    }
    await tx.calendarEvent.updateMany({
      where: {
        id: event.id,
        ownerUserId: input.ownerUserId,
        localRevision: event.localRevision,
        syncStatus: "ERROR",
      },
      data: { syncStatus: "PENDING", syncErrorCode: null },
    });
    return { eventId: event.id, jobId: job.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
