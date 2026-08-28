"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyCapability } from "@/lib/agent-access";
import {
  agencyInvitationUrl,
  createAgencyInvitationToken,
} from "@/lib/agency-invitations";
import { sendAgencyInvitationEmail } from "@/lib/email/send";
import { getAgencyInvitationPriceCents } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  INVITATION_VALIDITY_DAYS,
  type AgencyActionState,
} from "./plan";

const AGENCY_INVITATION_INTENDED_TYPES = ["AGENT", "AGENCY"] as const;
const AGENCY_RECRUITMENT_STAGES = [
  "PROSPECT",
  "CONTACTED",
  "MEETING_SCHEDULED",
  "QUALIFIED",
  "INVITED",
  "ONBOARDING",
  "ACTIVE",
  "PAUSED",
  "DECLINED",
] as const;
const INITIAL_AGENCY_RECRUITMENT_STAGE = "PROSPECT" as const;

type AgencyInvitationIntendedType =
  (typeof AGENCY_INVITATION_INTENDED_TYPES)[number];

const InviteAgentSchema = z.object({
  name: z
    .string()
    .trim()
    .max(120, "O nome deve ter no máximo 120 caracteres.")
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido."),
  intendedType: z.enum(AGENCY_INVITATION_INTENDED_TYPES, {
    error: "Escolha se o convite é para um agente ou uma agência.",
  }),
});

const RevokeInvitationSchema = z.object({
  invitationId: z.string().trim().min(1, "Convite inválido."),
});

const UpdateRecruitmentStageSchema = z.object({
  invitationId: z.string().trim().min(1, "Convite inválido."),
  recruitmentStage: z.enum(AGENCY_RECRUITMENT_STAGES, {
    error: "Escolha uma etapa de recrutamento válida.",
  }),
  expectedStageUpdatedAt: z
    .string()
    .trim()
    .min(1, "Atualize a página e tente novamente.")
    .refine(
      (value) => Number.isFinite(Date.parse(value)),
      "Atualize a página e tente novamente.",
    )
    .transform((value) => new Date(value)),
});

class AgencyActionFailure extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "AgencyActionFailure";
  }
}

function actionError(message: string): AgencyActionState {
  return { status: "error", message };
}

function monthlyPriceForIntendedType(
  intendedType: AgencyInvitationIntendedType,
): number {
  return getAgencyInvitationPriceCents(intendedType);
}

async function getActorUserId(agentId: string): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { userId: true },
  });
  return agent?.userId ?? null;
}

/**
 * Registers an invitation and returns its raw-token URL exactly once. Only the
 * digest reaches the database; email delivery is best-effort and never changes
 * whether the authenticated inviter can copy the newly generated link.
 */
export async function createAgencyInvitationAction(
  _previousState: AgencyActionState,
  formData: FormData,
): Promise<AgencyActionState> {
  let access: Awaited<ReturnType<typeof requireAgencyCapability>>;
  try {
    access = await requireAgencyCapability("INVITE_AGENTS");
  } catch {
    return actionError("Uma assinatura ativa vinculada à agência é necessária para criar convites.");
  }

  if (!access.agency) {
    return actionError("Nenhuma agência ativa foi encontrada para esta conta.");
  }
  const agencyId = access.agency.id;

  const parsed = InviteAgentSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    intendedType: formData.get("intendedType"),
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Revise os dados do convite.");
  }

  const now = new Date();
  const email = parsed.data.email;
  const intendedType = parsed.data.intendedType;
  const recruitmentStage = INITIAL_AGENCY_RECRUITMENT_STAGE;
  const monthlyPriceCents = monthlyPriceForIntendedType(intendedType);

  const activeMembership = await prisma.agencyMembership.findFirst({
    where: {
      endedAt: null,
      agent: { user: { email: { equals: email, mode: "insensitive" } } },
    },
    select: {
      id: true,
      agentId: true,
      agencyId: true,
      role: true,
      agency: { select: { parentAgencyId: true } },
      acceptedInvitation: {
        select: {
          status: true,
          intendedType: true,
          acceptedPlan: true,
        },
      },
      subscriptions: {
        where: {
          plan: "AGENT_AGENCY_MEMBER",
          status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (activeMembership) {
    if (activeMembership.agentId === access.agentId) {
      return actionError("Você não pode enviar um convite para a própria conta.");
    }

    // Members may grow a new branch, but cannot move, promote, or otherwise
    // rewrite an existing commercial membership. Only the agency owner can
    // initiate the explicit MEMBER -> AGENCY transition below.
    if (access.kind === "AGENCY_MEMBER") {
      return actionError("Este e-mail não está disponível para um novo convite.");
    }

    // A fresh typed invitation is the direct member's explicit consent to
    // leave the discounted MEMBER plan and become a child-agency OWNER.
    const isDirectMember =
      activeMembership.agencyId === agencyId
      && activeMembership.role === "MEMBER";
    const isRequestedDirectMemberPromotion =
      isDirectMember && intendedType === "AGENCY";
    const isDirectMemberPromotion =
      access.kind === "AGENCY_OWNER"
      && isRequestedDirectMemberPromotion
      && activeMembership.acceptedInvitation?.status === "ACCEPTED"
      && activeMembership.acceptedInvitation.intendedType === "AGENT"
      && activeMembership.acceptedInvitation.acceptedPlan === "AGENT_AGENCY_MEMBER"
      && activeMembership.subscriptions.length > 0;

    if (isRequestedDirectMemberPromotion && !isDirectMemberPromotion) {
      return actionError(
        "Este vínculo precisa estar ativo e regular antes da conversão para Agência.",
      );
    }

    if (
      activeMembership.agencyId === agencyId
      && !isDirectMemberPromotion
    ) {
      return actionError("Este agente já faz parte da agência.");
    } else if (activeMembership.agency.parentAgencyId === agencyId) {
      return actionError("Esta pessoa já faz parte da sua estrutura.");
    } else if (!isDirectMemberPromotion) {
      const isIndependentAgency = activeMembership.role === "OWNER"
        && activeMembership.agency.parentAgencyId === null;
      if (!isIndependentAgency || intendedType !== "AGENCY") {
        return actionError("Este e-mail não está disponível para um novo convite.");
      }
    }
  }

  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_VALIDITY_DAYS);

  const { rawToken, tokenHash } = createAgencyInvitationToken();
  const invitationUrl = agencyInvitationUrl(rawToken);
  const actorUserId = await getActorUserId(access.agentId);
  if (!actorUserId) {
    return actionError("Não foi possível identificar o responsável pelo convite.");
  }

  try {
    await prisma.$transaction(async (transaction) => {
      // Keep the predicate read and insert in one serializable transaction.
      // That makes two concurrent requests for the same agency/email conflict
      // instead of both observing the earlier, empty state.
      await transaction.agencyInvitation.updateMany({
        where: {
          agencyId,
          email: { equals: email, mode: "insensitive" },
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });

      const duplicate = await transaction.agencyInvitation.findFirst({
        where: {
          agencyId,
          email: { equals: email, mode: "insensitive" },
          status: "PENDING",
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new AgencyActionFailure(
          "Já existe um convite pendente para este e-mail.",
        );
      }

      const invitation = await transaction.agencyInvitation.create({
        data: {
          agencyId,
          email,
          name: parsed.data.name || null,
          invitedByAgentId: access.agentId,
          tokenHash,
          status: "PENDING",
          intendedType,
          recruitmentStage,
          stageUpdatedAt: now,
          monthlyPriceCents,
          expiresAt,
        },
        select: { id: true },
      });

      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action: "AGENCY_INVITATION_CREATED",
          entity: "AgencyInvitation",
          entityId: invitation.id,
          after: {
            agencyId,
            intendedType,
            recruitmentStage,
            monthlyPriceCents,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (error instanceof AgencyActionFailure) {
      return actionError(error.safeMessage);
    }
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error.code === "P2002" || error.code === "P2034")
    ) {
      return actionError("Já existe um convite pendente para este e-mail.");
    }
    console.error("Agency invitation create error", error);
    return actionError("Não foi possível registrar o convite agora.");
  }

  revalidatePath("/agent/agency");

  let emailDelivered = true;
  try {
    await sendAgencyInvitationEmail({
      to: email,
      inviteeName: parsed.data.name || null,
      agencyName: access.agency.name,
      intendedType,
      monthlyPriceCents,
      invitationUrl,
      expiresAt,
    });
  } catch (error) {
    // The raw token is returned to the authenticated inviter exactly once, so a
    // provider outage never makes the already-created invitation unusable.
    console.warn("Agency invitation email could not be sent", error);
    emailDelivered = false;
  }

  return {
    status: "success",
    message: emailDelivered
      ? "Convite criado e enviado por e-mail. O link individual também está disponível abaixo."
      : "Convite criado, mas o e-mail não foi entregue. Copie e envie o link individual abaixo.",
    invitationUrl,
  };
}

/**
 * Changes only a recruitment relationship managed directly by the signed-in
 * agency. Descendant visibility is intentionally not mutation authority: a
 * parent agency cannot edit invitations created by one of its subagencies.
 */
export async function updateAgencyRecruitmentStageAction(
  _previousState: AgencyActionState,
  formData: FormData,
): Promise<AgencyActionState> {
  let access: Awaited<ReturnType<typeof requireAgencyCapability>>;
  try {
    access = await requireAgencyCapability("INVITE_AGENTS");
  } catch {
    return actionError("Uma assinatura ativa vinculada à agência é necessária para atualizar etapas.");
  }

  if (!access.agency) {
    return actionError("Nenhuma agência ativa foi encontrada para esta conta.");
  }
  const agencyId = access.agency.id;

  const parsed = UpdateRecruitmentStageSchema.safeParse({
    invitationId: formData.get("invitationId"),
    recruitmentStage: formData.get("recruitmentStage"),
    expectedStageUpdatedAt: formData.get("expectedStageUpdatedAt"),
  });
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Revise a etapa de recrutamento.",
    );
  }

  const actorUserId = await getActorUserId(access.agentId);
  if (!actorUserId) {
    return actionError("Não foi possível identificar o responsável pela alteração.");
  }

  const { invitationId, recruitmentStage, expectedStageUpdatedAt } = parsed.data;
  const invitationManagerScope = access.kind === "AGENCY_OWNER"
    ? {}
    : { invitedByAgentId: access.agentId };
  try {
    const changed = await prisma.$transaction(async (transaction) => {
      const invitation = await transaction.agencyInvitation.findFirst({
        where: {
          id: invitationId,
          agencyId,
          ...invitationManagerScope,
        },
        select: {
          id: true,
          status: true,
          recruitmentStage: true,
          stageUpdatedAt: true,
          acceptedMembership: { select: { endedAt: true } },
        },
      });

      if (!invitation) {
        throw new AgencyActionFailure(
          "Não foi possível atualizar esta etapa. Atualize a página e tente novamente.",
        );
      }
      if (invitation.stageUpdatedAt.getTime() !== expectedStageUpdatedAt.getTime()) {
        throw new AgencyActionFailure(
          "Esta etapa foi alterada em outra sessão. Atualize a página e tente novamente.",
        );
      }
      if (
        recruitmentStage === "ACTIVE"
        && (
          invitation.status !== "ACCEPTED"
          || !invitation.acceptedMembership
          || invitation.acceptedMembership.endedAt !== null
        )
      ) {
        throw new AgencyActionFailure(
          "A etapa Ativo exige um convite aceito e um vínculo vigente.",
        );
      }
      if (invitation.recruitmentStage === recruitmentStage) {
        return false;
      }

      const changedAt = new Date();
      const updated = await transaction.agencyInvitation.updateMany({
        where: {
          id: invitation.id,
          agencyId,
          ...invitationManagerScope,
          stageUpdatedAt: expectedStageUpdatedAt,
        },
        data: {
          recruitmentStage,
          stageUpdatedAt: changedAt,
        },
      });
      if (updated.count !== 1) {
        throw new AgencyActionFailure(
          "Esta etapa foi alterada em outra sessão. Atualize a página e tente novamente.",
        );
      }

      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action: "AGENCY_RECRUITMENT_STAGE_UPDATED",
          entity: "AgencyInvitation",
          entityId: invitation.id,
          before: {
            recruitmentStage: invitation.recruitmentStage,
            stageUpdatedAt: invitation.stageUpdatedAt.toISOString(),
          },
          after: {
            recruitmentStage,
            stageUpdatedAt: changedAt.toISOString(),
          },
        },
      });
      return true;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    revalidatePath("/agent/agency");
    revalidatePath("/agent/hierarchy");
    return {
      status: "success",
      message: changed
        ? "Etapa de recrutamento atualizada."
        : "A etapa de recrutamento já estava atualizada.",
    };
  } catch (error) {
    if (error instanceof AgencyActionFailure) {
      return actionError(error.safeMessage);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === "P2002" || error.code === "P2034")
    ) {
      return actionError(
        "Esta etapa foi alterada em outra sessão. Atualize a página e tente novamente.",
      );
    }
    console.error("Agency recruitment stage update error", error);
    return actionError("Não foi possível atualizar a etapa agora.");
  }
}

export async function revokeAgencyInvitationAction(
  _previousState: AgencyActionState,
  formData: FormData,
): Promise<AgencyActionState> {
  let access: Awaited<ReturnType<typeof requireAgencyCapability>>;
  try {
    access = await requireAgencyCapability("INVITE_AGENTS");
  } catch {
    return actionError("Uma assinatura ativa vinculada à agência é necessária para revogar convites.");
  }

  if (!access.agency) {
    return actionError("Nenhuma agência ativa foi encontrada para esta conta.");
  }
  const agencyId = access.agency.id;

  const parsed = RevokeInvitationSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Convite inválido.");
  }

  const actorUserId = await getActorUserId(access.agentId);
  if (!actorUserId) {
    return actionError("Não foi possível identificar o responsável pela revogação.");
  }

  const invitationManagerScope = access.kind === "AGENCY_OWNER"
    ? {}
    : { invitedByAgentId: access.agentId };

  try {
    await prisma.$transaction(async (transaction) => {
      const invitation = await transaction.agencyInvitation.findFirst({
        where: {
          id: parsed.data.invitationId,
          agencyId,
          ...invitationManagerScope,
          status: "PENDING",
        },
        select: {
          id: true,
          status: true,
          recruitmentStage: true,
        },
      });
      if (!invitation) {
        throw new AgencyActionFailure(
          "O convite não está mais disponível para revogação.",
        );
      }

      const revokedAt = new Date();
      const revoked = await transaction.agencyInvitation.updateMany({
        where: {
          id: invitation.id,
          agencyId,
          ...invitationManagerScope,
          status: "PENDING",
        },
        data: {
          status: "REVOKED",
          revokedAt,
        },
      });
      if (revoked.count !== 1) {
        throw new AgencyActionFailure(
          "O convite não está mais disponível para revogação.",
        );
      }

      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action: "AGENCY_INVITATION_REVOKED",
          entity: "AgencyInvitation",
          entityId: invitation.id,
          before: {
            status: invitation.status,
            recruitmentStage: invitation.recruitmentStage,
          },
          after: {
            status: "REVOKED",
            revokedAt: revokedAt.toISOString(),
          },
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    revalidatePath("/agent/agency");
    return { status: "success", message: "Convite revogado." };
  } catch (error) {
    if (error instanceof AgencyActionFailure) {
      return actionError(error.safeMessage);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2034"
    ) {
      return actionError("O convite não está mais disponível para revogação.");
    }
    console.error("Agency invitation revoke error", error);
    return actionError("Não foi possível revogar o convite agora.");
  }
}
