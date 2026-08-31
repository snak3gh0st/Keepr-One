import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgencyCapability: vi.fn(),
  revalidatePath: vi.fn(),
  transaction: vi.fn(),
  agentFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  invitationUpdateMany: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationCreate: vi.fn(),
  auditCreate: vi.fn(),
  sendAgencyInvitationEmail: vi.fn(),
}));

const transactionClient = {
  agencyInvitation: {
    findFirst: mocks.invitationFindFirst,
    updateMany: mocks.invitationUpdateMany,
    create: mocks.invitationCreate,
  },
  auditLog: { create: mocks.auditCreate },
};

vi.mock("@/lib/agent-access", () => ({
  requireAgencyCapability: mocks.requireAgencyCapability,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/email/send", () => ({
  sendAgencyInvitationEmail: mocks.sendAgencyInvitationEmail,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: { findUnique: mocks.agentFindUnique },
    user: { findUnique: mocks.userFindUnique },
    agencyMembership: { findFirst: mocks.membershipFindFirst },
    agencyInvitation: {
      updateMany: mocks.invitationUpdateMany,
      findFirst: mocks.invitationFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  createAgencyInvitationAction,
  revokeAgencyInvitationAction,
  updateAgencyRecruitmentStageAction,
} from "./actions";
import { INITIAL_AGENCY_ACTION_STATE } from "./plan";

const now = new Date("2026-08-26T16:00:00.000Z");
const previousStageUpdatedAt = new Date("2026-08-25T12:00:00.000Z");

function invitationForm(
  email: string,
  options: {
    name?: string;
    intendedType?: "AGENT" | "AGENCY";
    recruitmentStage?: string;
  } = {},
) {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("name", options.name ?? "Agente Teste");
  formData.set("intendedType", options.intendedType ?? "AGENT");
  if (options.recruitmentStage) {
    formData.set("recruitmentStage", options.recruitmentStage);
  }
  return formData;
}

function stageForm(
  recruitmentStage: string,
  expected = previousStageUpdatedAt,
  invitationId = "invite-1",
) {
  const formData = new FormData();
  formData.set("invitationId", invitationId);
  formData.set("recruitmentStage", recruitmentStage);
  formData.set("expectedStageUpdatedAt", expected.toISOString());
  return formData;
}

function recruitmentInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    status: "PENDING",
    recruitmentStage: "PROSPECT",
    stageUpdatedAt: previousStageUpdatedAt,
    acceptedMembership: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.requireAgencyCapability.mockResolvedValue({
    agentId: "agent-owner",
    kind: "AGENCY_OWNER",
    agency: { id: "agency-1", name: "North Star" },
  });
  mocks.agentFindUnique.mockResolvedValue({ userId: "owner-user" });
  mocks.userFindUnique.mockResolvedValue({ language: "PT" });
  mocks.membershipFindFirst.mockResolvedValue(null);
  mocks.invitationUpdateMany.mockResolvedValue({ count: 0 });
  mocks.invitationFindFirst.mockResolvedValue(null);
  mocks.invitationCreate.mockResolvedValue({ id: "invite-1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.sendAgencyInvitationEmail.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (callback: (transaction: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  );
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createAgencyInvitationAction", () => {
  it("persists a normalized, server-priced invitation at the server-defined initial stage", async () => {
    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("  AGENT@Example.COM  ", {
        name: "  Maria Agent  ",
        recruitmentStage: "CONTACTED",
      }),
    );

    expect(result).toMatchObject({
      status: "success",
      message: expect.stringContaining("enviado por e-mail"),
      invitationUrl: expect.stringMatching(
        /^https:\/\/app\.example\.com\/convites\/agencia\/[A-Za-z0-9_-]{43}$/,
      ),
    });
    expect(mocks.requireAgencyCapability).toHaveBeenCalledWith("INVITE_AGENTS");
    expect(mocks.invitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agencyId: "agency-1",
        invitedByAgentId: "agent-owner",
        email: "agent@example.com",
        name: "Maria Agent",
        intendedType: "AGENT",
        recruitmentStage: "PROSPECT",
        stageUpdatedAt: now,
        monthlyPriceCents: 4_990,
        status: "PENDING",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: new Date("2026-09-09T16:00:00.000Z"),
      }),
      select: { id: true },
    });
    const rawToken = new URL(result.invitationUrl!).pathname.split("/").pop()!;
    const storedTokenHash = mocks.invitationCreate.mock.calls[0][0].data.tokenHash;
    expect(createHash("sha256").update(rawToken).digest("hex")).toBe(storedTokenHash);
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "owner-user",
        action: "AGENCY_INVITATION_CREATED",
        entityId: "invite-1",
        after: expect.objectContaining({
          intendedType: "AGENT",
          recruitmentStage: "PROSPECT",
          monthlyPriceCents: 4_990,
        }),
      }),
    });
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain(rawToken);
    expect(mocks.sendAgencyInvitationEmail).toHaveBeenCalledWith({
      to: "agent@example.com",
      inviteeName: "Maria Agent",
      agencyName: "North Star",
      intendedType: "AGENT",
      monthlyPriceCents: 4_990,
      invitationUrl: result.invitationUrl,
      expiresAt: new Date("2026-09-09T16:00:00.000Z"),
      language: "PT",
    });
  });

  it("applies the ten-dollar agency invitation discount", async () => {
    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("owner@example.com", { intendedType: "AGENCY" }),
    );

    expect(result.status).toBe("success");
    expect(mocks.invitationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        intendedType: "AGENCY",
        monthlyPriceCents: 8_990,
      }),
    }));
  });

  it("does not allow an individual account to invite", async () => {
    mocks.requireAgencyCapability.mockRejectedValue(new Error("Forbidden"));

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("agent@example.com"),
    );

    expect(result.status).toBe("error");
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
  });

  it("lets an active member create a new branch invitation in the base agency", async () => {
    mocks.requireAgencyCapability.mockResolvedValue({
      agentId: "agent-member",
      kind: "AGENCY_MEMBER",
      agency: { id: "agency-1", name: "North Star" },
    });
    mocks.agentFindUnique.mockResolvedValue({ userId: "member-user" });

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("new-branch@example.com", { intendedType: "AGENCY" }),
    );

    expect(result.status).toBe("success");
    expect(mocks.invitationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agencyId: "agency-1",
        invitedByAgentId: "agent-member",
        email: "new-branch@example.com",
        intendedType: "AGENCY",
      }),
    }));
  });

  it("blocks self-invites and any attempt by a member to move an active membership", async () => {
    mocks.requireAgencyCapability.mockResolvedValue({
      agentId: "agent-member",
      kind: "AGENCY_MEMBER",
      agency: { id: "agency-1", name: "North Star" },
    });
    mocks.membershipFindFirst.mockResolvedValue({
      id: "self-membership",
      agentId: "agent-member",
      agencyId: "agency-1",
      role: "MEMBER",
      agency: { parentAgencyId: null },
      acceptedInvitation: null,
      subscriptions: [{ id: "member-subscription" }],
    });

    const selfInvite = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("member@example.com"),
    );

    expect(selfInvite).toEqual({
      status: "error",
      message: "Você não pode enviar um convite para a própria conta.",
    });

    mocks.membershipFindFirst.mockResolvedValue({
      id: "other-membership",
      agentId: "other-agent",
      agencyId: "agency-1",
      role: "MEMBER",
      agency: { parentAgencyId: null },
      acceptedInvitation: {
        status: "ACCEPTED",
        intendedType: "AGENT",
        acceptedPlan: "AGENT_AGENCY_MEMBER",
      },
      subscriptions: [{ id: "other-subscription" }],
    });

    const promotion = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("other@example.com", { intendedType: "AGENCY" }),
    );

    expect(promotion).toEqual({
      status: "error",
      message: "Este e-mail não está disponível para um novo convite.",
    });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it("uses a generic conflict for a target linked to another structure", async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      id: "membership-other",
      agencyId: "agency-other",
      role: "MEMBER",
      agency: { parentAgencyId: null },
    });

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("agent@example.com"),
    );

    expect(result).toEqual({
      status: "error",
      message: "Este e-mail não está disponível para um novo convite.",
    });
  });

  it("allows an independent existing agency only for an agency invitation", async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      id: "owner-membership",
      agencyId: "independent-agency",
      role: "OWNER",
      agency: { parentAgencyId: null },
    });

    const agentResult = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("owner@example.com", { intendedType: "AGENT" }),
    );
    const agencyResult = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("owner@example.com", { intendedType: "AGENCY" }),
    );

    expect(agentResult.status).toBe("error");
    expect(agencyResult.status).toBe("success");
  });

  it("allows a direct MEMBER to receive only a new AGENCY promotion invitation", async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      id: "direct-member",
      agencyId: "agency-1",
      role: "MEMBER",
      agency: { parentAgencyId: null },
      acceptedInvitation: {
        status: "ACCEPTED",
        intendedType: "AGENT",
        acceptedPlan: "AGENT_AGENCY_MEMBER",
      },
      subscriptions: [{ id: "member-subscription" }],
    });

    const repeatedAgentInvite = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("member@example.com", { intendedType: "AGENT" }),
    );
    const promotionInvite = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("member@example.com", { intendedType: "AGENCY" }),
    );

    expect(repeatedAgentInvite).toEqual({
      status: "error",
      message: "Este agente já faz parte da agência.",
    });
    expect(promotionInvite.status).toBe("success");
    expect(mocks.invitationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.invitationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: "member@example.com",
        intendedType: "AGENCY",
        monthlyPriceCents: 8_990,
      }),
    }));
  });

  it("does not send an agency promotion invite for a legacy or lapsed member", async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      id: "legacy-member",
      agencyId: "agency-1",
      role: "MEMBER",
      agency: { parentAgencyId: null },
      acceptedInvitation: null,
      subscriptions: [],
    });

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("legacy@example.com", { intendedType: "AGENCY" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Este vínculo precisa estar ativo e regular antes da conversão para Agência.",
    });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
    expect(mocks.sendAgencyInvitationEmail).not.toHaveBeenCalled();
  });

  it("keeps the link usable but reports email delivery failure explicitly", async () => {
    mocks.sendAgencyInvitationEmail.mockRejectedValue(new Error("provider unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("agent@example.com"),
    );

    expect(result).toMatchObject({
      status: "success",
      message: expect.stringContaining("e-mail não foi entregue"),
      invitationUrl: expect.stringMatching(/\/convites\/agencia\//),
    });
    warning.mockRestore();
  });

  it("turns a concurrent duplicate into the same safe validation result", async () => {
    mocks.invitationCreate.mockRejectedValue({ code: "P2002" });

    const result = await createAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      invitationForm("agent@example.com"),
    );

    expect(result).toEqual({
      status: "error",
      message: "Já existe um convite pendente para este e-mail.",
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});

describe("updateAgencyRecruitmentStageAction", () => {
  it("updates and audits only a direct invitation using optimistic stage time", async () => {
    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation());
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("CONTACTED"),
    );

    expect(result).toEqual({
      status: "success",
      message: "Etapa de recrutamento atualizada.",
    });
    expect(mocks.invitationFindFirst).toHaveBeenCalledWith({
      where: { id: "invite-1", agencyId: "agency-1" },
      select: expect.any(Object),
    });
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
        agencyId: "agency-1",
        stageUpdatedAt: previousStageUpdatedAt,
      },
      data: {
        recruitmentStage: "CONTACTED",
        stageUpdatedAt: now,
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "AGENCY_RECRUITMENT_STAGE_UPDATED",
        before: expect.objectContaining({ recruitmentStage: "PROSPECT" }),
        after: expect.objectContaining({ recruitmentStage: "CONTACTED" }),
      }),
    });
  });

  it("does not disclose or mutate a descendant agency's direct invitation", async () => {
    mocks.invitationFindFirst.mockResolvedValue(null);

    const result = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("QUALIFIED", previousStageUpdatedAt, "descendant-invite"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("Atualize a página");
    expect(mocks.invitationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("restricts a member to invitations issued by that same member", async () => {
    mocks.requireAgencyCapability.mockResolvedValue({
      agentId: "agent-member",
      kind: "AGENCY_MEMBER",
      agency: { id: "agency-1", name: "North Star" },
    });
    mocks.invitationFindFirst.mockResolvedValue(null);

    const result = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("QUALIFIED"),
    );

    expect(result.status).toBe("error");
    expect(mocks.invitationFindFirst).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
        agencyId: "agency-1",
        invitedByAgentId: "agent-member",
      },
      select: expect.any(Object),
    });
    expect(mocks.invitationUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic version without overwriting the newer stage", async () => {
    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation({
      recruitmentStage: "QUALIFIED",
      stageUpdatedAt: new Date("2026-08-26T15:00:00.000Z"),
    }));

    const result = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("INVITED"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("outra sessão");
    expect(mocks.invitationUpdateMany).not.toHaveBeenCalled();
  });

  it("allows ACTIVE only for an accepted invitation with an active membership", async () => {
    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation());

    const pending = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("ACTIVE"),
    );
    expect(pending).toEqual({
      status: "error",
      message: "A etapa Ativo exige um convite aceito e um vínculo vigente.",
    });

    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation({
      status: "ACCEPTED",
      acceptedMembership: { endedAt: null },
    }));
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });
    const accepted = await updateAgencyRecruitmentStageAction(
      INITIAL_AGENCY_ACTION_STATE,
      stageForm("ACTIVE"),
    );
    expect(accepted.status).toBe("success");
  });
});

describe("revokeAgencyInvitationAction", () => {
  it("revokes and audits only a pending invitation from the current agency", async () => {
    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation({
      recruitmentStage: "INVITED",
    }));
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });
    const formData = new FormData();
    formData.set("invitationId", "invite-1");

    const result = await revokeAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      formData,
    );

    expect(result).toEqual({ status: "success", message: "Convite revogado." });
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", agencyId: "agency-1", status: "PENDING" },
      data: { status: "REVOKED", revokedAt: now },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "AGENCY_INVITATION_REVOKED",
        entityId: "invite-1",
        before: { status: "PENDING", recruitmentStage: "INVITED" },
        after: { status: "REVOKED", revokedAt: now.toISOString() },
      }),
    });
  });

  it("returns the same generic conflict for another agency or a completed invite", async () => {
    mocks.invitationFindFirst.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("invitationId", "invite-other-agency");

    const result = await revokeAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      formData,
    );

    expect(result).toEqual({
      status: "error",
      message: "O convite não está mais disponível para revogação.",
    });
    expect(mocks.invitationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("scopes a member revoke to invitations issued by that member", async () => {
    mocks.requireAgencyCapability.mockResolvedValue({
      agentId: "agent-member",
      kind: "AGENCY_MEMBER",
      agency: { id: "agency-1", name: "North Star" },
    });
    mocks.invitationFindFirst.mockResolvedValue(recruitmentInvitation());
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });
    const formData = new FormData();
    formData.set("invitationId", "invite-1");

    const result = await revokeAgencyInvitationAction(
      INITIAL_AGENCY_ACTION_STATE,
      formData,
    );

    expect(result.status).toBe("success");
    expect(mocks.invitationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "invite-1",
        agencyId: "agency-1",
        invitedByAgentId: "agent-member",
        status: "PENDING",
      },
    }));
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "invite-1",
        agencyId: "agency-1",
        invitedByAgentId: "agent-member",
        status: "PENDING",
      },
    }));
  });
});
