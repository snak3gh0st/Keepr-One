"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireAgencyCapability } from "@/lib/agent-access";
import { getCurrentAgent } from "@/lib/agent-context";
import { auth } from "@/lib/auth";
import { allowLocalEmailChangeWithoutVerification } from "@/lib/email-change-config";
import { prisma } from "@/lib/prisma";
import type { SettingsActionState } from "./state";

const personalProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe seu nome completo.")
    .max(100, "O nome deve ter no máximo 100 caracteres."),
  phone: z
    .string()
    .trim()
    .max(32, "O telefone informado é muito longo.")
    .refine(
      (value) => value === "" || /^\+?[0-9\s().-]+$/.test(value),
      "Informe um telefone válido.",
    )
    .transform(normalizePhone)
    .refine(
      (value) => value === null || /^\+?[0-9]{7,15}$/.test(value),
      "Informe um telefone com 7 a 15 dígitos.",
    ),
  timeZone: z
    .string()
    .trim()
    .min(1, "Selecione seu fuso horário.")
    .max(100, "O fuso horário informado é inválido.")
    .refine(isValidTimeZone, "Selecione um fuso horário válido."),
});

const emailChangeSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido.")
    .max(254, "O e-mail deve ter no máximo 254 caracteres."),
  currentPassword: z
    .string()
    .min(1, "Informe sua senha atual.")
    .max(128, "A senha atual é inválida."),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Informe sua senha atual.")
      .max(128, "A senha atual é inválida."),
    newPassword: z
      .string()
      .min(8, "A nova senha deve ter pelo menos 8 caracteres.")
      .max(128, "A nova senha deve ter no máximo 128 caracteres."),
    confirmPassword: z
      .string()
      .min(1, "Confirme a nova senha.")
      .max(128, "A confirmação da senha é inválida."),
    revokeOtherSessions: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "As novas senhas não coincidem.",
      });
    }
    if (value.newPassword === value.currentPassword) {
      context.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "A nova senha precisa ser diferente da senha atual.",
      });
    }
  });

const agencyProfileSchema = z.object({
  agencyName: z
    .string()
    .trim()
    .min(2, "Informe o nome da agência.")
    .max(120, "O nome da agência deve ter no máximo 120 caracteres."),
});

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function normalizePhone(value: string): string | null {
  if (!value) return null;
  const prefixed = value.startsWith("+");
  const digits = value.replace(/\D/g, "");
  return prefixed ? `+${digits}` : digits;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function validationFailure(error: z.ZodError): SettingsActionState {
  return {
    status: "error",
    message: "Revise os campos destacados.",
    fieldErrors: fieldErrors(error),
  };
}

function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const body = "body" in error ? error.body : null;
  if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
    return body.code;
  }
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

function revalidateProfileSurfaces() {
  revalidatePath("/agent/settings");
  revalidatePath("/agent");
  revalidatePath("/agent/calendar");
  revalidatePath("/agent/hierarchy");
  revalidatePath("/agent/agency");
}

export async function updatePersonalProfileAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = personalProfileSchema.safeParse({
    name: formString(formData, "name"),
    phone: formString(formData, "phone"),
    timeZone: formString(formData, "timeZone"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const agent = await getCurrentAgent();
    const requestHeaders = await headers();
    const current = await prisma.user.findUnique({
      where: { id: agent.userId },
      select: {
        name: true,
        timeZone: true,
        agent: { select: { phone: true } },
      },
    });
    if (!current?.agent) {
      return { status: "error", message: "Não foi possível localizar seu perfil." };
    }

    const before = {
      name: current.name,
      phone: current.agent.phone,
      timeZone: current.timeZone,
    };
    const after = {
      name: parsed.data.name,
      phone: parsed.data.phone,
      timeZone: parsed.data.timeZone,
    };
    if (
      before.name === after.name
      && before.phone === after.phone
      && before.timeZone === after.timeZone
    ) {
      return { status: "success", message: "Seu perfil já está atualizado." };
    }

    let updatedAuthName = false;
    if (before.name !== after.name) {
      await auth.api.updateUser({
        headers: requestHeaders,
        body: { name: after.name },
      });
      updatedAuthName = true;
    }

    try {
      const writes: Prisma.PrismaPromise<unknown>[] = [];
      if (before.timeZone !== after.timeZone) {
        writes.push(
          prisma.user.update({
            where: { id: agent.userId },
            data: { timeZone: after.timeZone },
          }),
        );
      }
      if (before.phone !== after.phone) {
        writes.push(
          prisma.agent.update({
            where: { id: agent.id },
            data: { phone: after.phone },
          }),
        );
      }
      writes.push(
        prisma.auditLog.create({
          data: {
            userId: agent.userId,
            action: "USER_PROFILE_UPDATED",
            entity: "User",
            entityId: agent.userId,
            before,
            after,
          },
        }),
      );
      await prisma.$transaction(writes);
    } catch (error) {
      if (updatedAuthName) {
        try {
          await auth.api.updateUser({
            headers: requestHeaders,
            body: { name: before.name },
          });
        } catch (rollbackError) {
          console.error("Profile name compensation failed", rollbackError);
        }
      }
      throw error;
    }

    revalidateProfileSurfaces();
    return { status: "success", message: "Dados pessoais atualizados." };
  } catch (error) {
    console.error("Profile update failed", error);
    return {
      status: "error",
      message: "Não foi possível atualizar seus dados agora. Tente novamente.",
    };
  }
}

export async function requestEmailChangeAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = emailChangeSchema.safeParse({
    newEmail: formString(formData, "newEmail"),
    currentPassword: formString(formData, "currentPassword"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const agent = await getCurrentAgent();
    const currentUser = await prisma.user.findUnique({
      where: { id: agent.userId },
      select: { email: true, emailVerified: true },
    });
    if (!currentUser) {
      return { status: "error", message: "Não foi possível localizar sua conta." };
    }
    if (currentUser.email.toLowerCase() === parsed.data.newEmail) {
      return {
        status: "error",
        fieldErrors: { newEmail: "Este já é o e-mail da sua conta." },
        message: "Informe um e-mail diferente do atual.",
      };
    }

    const requestHeaders = await headers();
    await auth.api.verifyPassword({
      headers: requestHeaders,
      body: { password: parsed.data.currentPassword },
    });
    await auth.api.changeEmail({
      headers: requestHeaders,
      body: {
        newEmail: parsed.data.newEmail,
        callbackURL: "/agent/settings?email=verified",
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: agent.userId,
          action: "USER_EMAIL_CHANGE_REQUESTED",
          entity: "User",
          entityId: agent.userId,
          before: { email: currentUser.email },
          after: { requestedEmail: parsed.data.newEmail },
        },
      });
    } catch (auditError) {
      console.error("Email change audit failed", auditError);
    }

    revalidatePath("/agent/settings");
    return {
      status: "success",
      message: allowLocalEmailChangeWithoutVerification() && !currentUser.emailVerified
        ? `E-mail alterado para ${parsed.data.newEmail} neste ambiente local.`
        : currentUser.emailVerified
        ? `Enviamos uma autorização para ${currentUser.email}. Depois dela, confirmaremos ${parsed.data.newEmail}.`
        : `Enviamos a confirmação para ${parsed.data.newEmail}. Seu e-mail atual continua válido até a verificação.`,
    };
  } catch (error) {
    const code = authErrorCode(error);
    if (code === "INVALID_PASSWORD") {
      return {
        status: "error",
        message: "Não foi possível confirmar sua identidade.",
        fieldErrors: { currentPassword: "A senha atual está incorreta." },
      };
    }
    if (code === "SESSION_EXPIRED" || code === "INVALID_SESSION") {
      return {
        status: "error",
        message: "Por segurança, entre novamente antes de trocar seu e-mail.",
      };
    }
    console.error("Email change request failed", error);
    return {
      status: "error",
      message: "Não foi possível enviar a confirmação agora. Tente novamente.",
    };
  }
}

export async function changePasswordAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formString(formData, "currentPassword"),
    newPassword: formString(formData, "newPassword"),
    confirmPassword: formString(formData, "confirmPassword"),
    revokeOtherSessions: formData.get("revokeOtherSessions") === "true"
      || formData.get("revokeOtherSessions") === "on",
  });
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const agent = await getCurrentAgent();
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: parsed.data.revokeOtherSessions,
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: agent.userId,
          action: "USER_PASSWORD_CHANGED",
          entity: "User",
          entityId: agent.userId,
          after: { revokedOtherSessions: parsed.data.revokeOtherSessions },
        },
      });
    } catch (auditError) {
      console.error("Password change audit failed", auditError);
    }

    revalidatePath("/agent/settings");
    return {
      status: "success",
      message: parsed.data.revokeOtherSessions
        ? "Senha alterada; suas outras sessões foram encerradas."
        : "Senha alterada com sucesso.",
    };
  } catch (error) {
    const code = authErrorCode(error);
    if (code === "INVALID_PASSWORD") {
      return {
        status: "error",
        message: "Não foi possível alterar a senha.",
        fieldErrors: { currentPassword: "A senha atual está incorreta." },
      };
    }
    if (code === "SESSION_EXPIRED" || code === "INVALID_SESSION") {
      return {
        status: "error",
        message: "Por segurança, entre novamente antes de alterar sua senha.",
      };
    }
    console.error("Password change failed", error);
    return {
      status: "error",
      message: "Não foi possível alterar sua senha agora. Tente novamente.",
    };
  }
}

export async function updateAgencyProfileAction(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = agencyProfileSchema.safeParse({
    agencyName: formString(formData, "agencyName"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const agent = await getCurrentAgent();
    const access = await requireAgencyCapability("MANAGE_TEAM");
    if (!access.agency) {
      return { status: "error", message: "Nenhuma agência editável foi encontrada." };
    }
    const agencyId = access.agency.id;
    const current = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true },
    });
    if (!current) {
      return { status: "error", message: "Não foi possível localizar sua agência." };
    }
    if (current.name === parsed.data.agencyName) {
      return { status: "success", message: "O nome da agência já está atualizado." };
    }

    await prisma.$transaction([
      prisma.agency.update({
        where: { id: agencyId },
        data: { name: parsed.data.agencyName },
      }),
      prisma.auditLog.create({
        data: {
          userId: agent.userId,
          action: "AGENCY_PROFILE_UPDATED",
          entity: "Agency",
          entityId: agencyId,
          before: { name: current.name },
          after: { name: parsed.data.agencyName },
        },
      }),
    ]);

    revalidateProfileSurfaces();
    return { status: "success", message: "Nome da agência atualizado." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        status: "error",
        message: "Não foi possível usar este nome de agência.",
        fieldErrors: { agencyName: "Escolha outro nome para a agência." },
      };
    }
    if (
      error instanceof Error
      && error.message.startsWith("Forbidden: agency capability")
    ) {
      return {
        status: "error",
        message: "Somente o responsável por um plano Agência ativo pode alterar este nome.",
      };
    }
    console.error("Agency profile update failed", error);
    return {
      status: "error",
      message: "Não foi possível atualizar a agência agora. Tente novamente.",
    };
  }
}
