import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentScopeIds } from "@/lib/agent-access";
import { getNextSchedulingSlotsForAgent } from "@/lib/scheduling/agent-availability";
import { agentSchedulingSlotsQuerySchema } from "@/lib/scheduling/validation";

const NO_STORE = { "Cache-Control": "private, no-store" };
const ALLOWED_QUERY = new Set(["agentId", "days", "limit", "timeZone"]);

async function authenticatedOwner() {
  try {
    return await getCurrentAgent();
  } catch {
    return null;
  }
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

/**
 * Next free slots for one agent, so the K-BOT can offer times inside a
 * conversation without knowing the public slug.
 *
 * The public surface is keyed by slug on purpose. Keying by agentId turns this
 * into an authorization surface: without the scope check below any signed-in
 * user could enumerate another agent's free/busy calendar. `agentId` therefore
 * defaults to the caller and is otherwise only accepted when it falls inside the
 * scope the caller already legitimately reads.
 */
export async function GET(request: Request) {
  const agent = await authenticatedOwner();
  if (!agent) return error(401, "UNAUTHORIZED", "Acesso não autorizado.");

  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_QUERY.has(key))) {
    return error(400, "INVALID_REQUEST", "Revise os parâmetros da consulta de horários.");
  }
  const query = agentSchedulingSlotsQuerySchema.safeParse({
    agentId: url.searchParams.get("agentId") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    timeZone: url.searchParams.get("timeZone") ?? undefined,
  });
  if (!query.success) {
    return error(400, "INVALID_REQUEST", "Revise os parâmetros da consulta de horários.");
  }

  const requestedAgentId = query.data.agentId ?? agent.id;
  if (requestedAgentId !== agent.id) {
    const scope = await getAgentScopeIds(agent.id);
    if (!scope.includes(requestedAgentId)) {
      return error(403, "FORBIDDEN", "Acesso não autorizado à agenda deste agente.");
    }
  }

  try {
    const availability = await getNextSchedulingSlotsForAgent({
      agentId: requestedAgentId,
      viewerTimeZone: query.data.timeZone,
      days: query.data.days,
      limit: query.data.limit,
    });
    return Response.json(availability, { headers: NO_STORE });
  } catch {
    return error(503, "SCHEDULING_SLOTS_FAILED", "Não foi possível consultar os horários agora.");
  }
}
