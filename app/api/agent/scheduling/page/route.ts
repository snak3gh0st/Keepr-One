import { Prisma } from "@prisma/client";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { getSchedulingReadinessForUser } from "@/lib/scheduling/readiness";
import { schedulingPageInputSchema, type SchedulingPageInput } from "@/lib/scheduling/validation";
import { assertSameOriginAction } from "@/lib/security/same-origin-action";

const NO_STORE = { "Cache-Control": "no-store" };

const privatePageSelect = {
  id: true,
  slug: true,
  enabled: true,
  title: true,
  description: true,
  durationMinutes: true,
  slotIntervalMinutes: true,
  bufferBeforeMinutes: true,
  bufferAfterMinutes: true,
  minimumNoticeMinutes: true,
  maximumAdvanceDays: true,
  weeklyWindows: {
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    select: { id: true, weekday: true, startMinute: true, endMinute: true },
  },
} satisfies Prisma.SchedulingPageSelect;

async function authenticatedOwner() {
  try {
    return await getCurrentAgent();
  } catch {
    return null;
  }
}

async function privatePageResponse(ownerUserId: string) {
  const [owner, page, readiness] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { timeZone: true },
    }),
    prisma.schedulingPage.findUnique({ where: { ownerUserId }, select: privatePageSelect }),
    getSchedulingReadinessForUser(ownerUserId),
  ]);
  if (!owner) throw new Error("Scheduling owner not found");
  return { page, readiness, ownerTimeZone: owner.timeZone };
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function GET() {
  const agent = await authenticatedOwner();
  if (!agent) return error(401, "UNAUTHORIZED", "Acesso não autorizado.");
  try {
    return Response.json(await privatePageResponse(agent.userId), { headers: NO_STORE });
  } catch {
    return error(500, "SCHEDULING_PAGE_FAILED", "Não foi possível carregar o agendamento agora.");
  }
}

function pageData(input: SchedulingPageInput) {
  return {
    slug: input.slug,
    enabled: input.enabled,
    title: input.title,
    description: input.description,
    durationMinutes: input.durationMinutes,
    slotIntervalMinutes: input.slotIntervalMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
    minimumNoticeMinutes: input.minimumNoticeMinutes,
    maximumAdvanceDays: input.maximumAdvanceDays,
  };
}

export async function PUT(request: Request) {
  try {
    assertSameOriginAction({
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
    });
  } catch {
    return error(403, "FORBIDDEN", "Origem da solicitação inválida.");
  }

  const agent = await authenticatedOwner();
  if (!agent) return error(401, "UNAUTHORIZED", "Acesso não autorizado.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "INVALID_REQUEST", "Revise os dados da página de agendamento.");
  }
  const parsed = schedulingPageInputSchema.safeParse(body);
  if (!parsed.success) {
    const overlapping = parsed.error.issues.some((issue) =>
      issue.path[0] === "weeklyWindows" && issue.message.toLowerCase().includes("sobrepostas"),
    );
    return overlapping
      ? error(409, "OVERLAPPING_WINDOWS", "Existem períodos de disponibilidade sobrepostos.")
      : error(400, "INVALID_REQUEST", "Revise os dados da página de agendamento.");
  }

  try {
    const readiness = await getSchedulingReadinessForUser(agent.userId);
    if (parsed.data.enabled && !readiness.canEnable) {
      return error(
        409,
        "SCHEDULING_INTEGRATIONS_REQUIRED",
        "Conclua as integrações do Google Agenda e do e-mail antes de publicar o link.",
      );
    }

    await prisma.$transaction(async (tx) => {
      const page = await tx.schedulingPage.upsert({
        where: { ownerUserId: agent.userId },
        create: { ownerUserId: agent.userId, ...pageData(parsed.data) },
        update: pageData(parsed.data),
        select: { id: true },
      });
      await tx.schedulingWeeklyWindow.deleteMany({ where: { pageId: page.id } });
      const windows = [...parsed.data.weeklyWindows].sort((a, b) =>
        a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute,
      );
      if (windows.length) {
        await tx.schedulingWeeklyWindow.createMany({
          data: windows.map((window) => ({ pageId: page.id, ...window })),
        });
      }
    });
    return Response.json(await privatePageResponse(agent.userId), { headers: NO_STORE });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
      return error(409, "SLUG_TAKEN", "Este endereço já está em uso. Escolha outro link.");
    }
    return error(500, "SCHEDULING_PAGE_FAILED", "Não foi possível salvar o agendamento agora.");
  }
}
