import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  getCurrentAgent: vi.fn(),
  requireAgencyCapability: vi.fn(),
  updateUser: vi.fn(),
  verifyPassword: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  userFindUnique: vi.fn(),
  agencyFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  txUserUpdate: vi.fn(),
  txAgentUpdate: vi.fn(),
  txAgencyUpdate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

vi.mock("@/lib/agent-context", () => ({
  getCurrentAgent: mocks.getCurrentAgent,
}));

vi.mock("@/lib/agent-access", () => ({
  requireAgencyCapability: mocks.requireAgencyCapability,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      updateUser: mocks.updateUser,
      verifyPassword: mocks.verifyPassword,
      changeEmail: mocks.changeEmail,
      changePassword: mocks.changePassword,
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.txUserUpdate },
    agent: { update: mocks.txAgentUpdate },
    agency: { findUnique: mocks.agencyFindUnique, update: mocks.txAgencyUpdate },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import {
  changePasswordAction,
  requestEmailChangeAction,
  updateAgencyProfileAction,
  updatePersonalProfileAction,
} from "./actions";
import { INITIAL_SETTINGS_ACTION_STATE } from "./state";

const SESSION_AGENT = {
  id: "agent-from-session",
  userId: "user-from-session",
};
const REQUEST_HEADERS = new Headers({ "x-request-id": "settings-test" });

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

function personalForm(overrides: Record<string, string> = {}): FormData {
  return form({
    name: "  Maria da Silva  ",
    phone: "+1 (305) 555-0100",
    timeZone: "America/New_York",
    // These fields are deliberately ignored by the action. They make tenant
    // and identity regressions visible if someone later trusts FormData IDs.
    userId: "user-controlled-by-attacker",
    agentId: "agent-controlled-by-attacker",
    ...overrides,
  });
}

function emailForm(overrides: Record<string, string> = {}): FormData {
  return form({
    newEmail: "  NEW.EMAIL@Example.COM  ",
    currentPassword: "current-password-123",
    userId: "user-controlled-by-attacker",
    agentId: "agent-controlled-by-attacker",
    ...overrides,
  });
}

function passwordForm(overrides: Record<string, string> = {}): FormData {
  return form({
    currentPassword: "current-password-123",
    newPassword: "new-password-456",
    confirmPassword: "new-password-456",
    revokeOtherSessions: "on",
    userId: "user-controlled-by-attacker",
    agentId: "agent-controlled-by-attacker",
    ...overrides,
  });
}

function agencyForm(overrides: Record<string, string> = {}): FormData {
  return form({
    agencyName: "  North Star Advisory  ",
    agencyId: "agency-controlled-by-attacker",
    userId: "user-controlled-by-attacker",
    ...overrides,
  });
}

function authError(code: string): Error & { body: { code: string } } {
  return Object.assign(new Error(code), { body: { code } });
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  mocks.getCurrentAgent.mockResolvedValue(SESSION_AGENT);
  mocks.requireAgencyCapability.mockResolvedValue({
    agentId: SESSION_AGENT.id,
    agency: { id: "agency-from-capability", name: "North Star" },
  });
  mocks.updateUser.mockResolvedValue({ status: true });
  mocks.verifyPassword.mockResolvedValue({ status: true });
  mocks.changeEmail.mockResolvedValue({ status: true });
  mocks.changePassword.mockResolvedValue({ status: true });
  mocks.agencyFindUnique.mockResolvedValue({ name: "North Star" });
  mocks.userFindUnique.mockResolvedValue({
    name: "Maria Silva",
    timeZone: "America/Chicago",
    agent: { phone: "3055550199" },
  });
  mocks.auditCreate.mockResolvedValue({ id: "audit-direct" });
  mocks.txUserUpdate.mockResolvedValue({ id: SESSION_AGENT.userId });
  mocks.txAgentUpdate.mockResolvedValue({ id: SESSION_AGENT.id });
  mocks.txAgencyUpdate.mockResolvedValue({ id: "agency-from-capability" });
  mocks.transaction.mockImplementation(async (writes: unknown[]) => Promise.all(writes));
});

describe("updatePersonalProfileAction", () => {
  it("rejects invalid name, phone and time zone before resolving the session", async () => {
    const result = await updatePersonalProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      personalForm({ name: "M", phone: "not-a-phone", timeZone: "Moon/Sea" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: {
        name: "Informe seu nome completo.",
        phone: "Informe um telefone válido.",
        timeZone: "Selecione um fuso horário válido.",
      },
    });
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("normalizes profile values and scopes every write and audit ID to the session", async () => {
    const result = await updatePersonalProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      personalForm(),
    );

    expect(result).toEqual({ status: "success", message: "Dados pessoais atualizados." });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: SESSION_AGENT.userId },
      select: {
        name: true,
        timeZone: true,
        agent: { select: { phone: true } },
      },
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { name: "Maria da Silva" },
    });
    expect(mocks.txUserUpdate).toHaveBeenCalledWith({
      where: { id: SESSION_AGENT.userId },
      data: { timeZone: "America/New_York" },
    });
    expect(mocks.txAgentUpdate).toHaveBeenCalledWith({
      where: { id: SESSION_AGENT.id },
      data: { phone: "+13055550100" },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: SESSION_AGENT.userId,
        action: "USER_PROFILE_UPDATED",
        entity: "User",
        entityId: SESSION_AGENT.userId,
        before: {
          name: "Maria Silva",
          phone: "3055550199",
          timeZone: "America/Chicago",
        },
        after: {
          name: "Maria da Silva",
          phone: "+13055550100",
          timeZone: "America/New_York",
        },
      },
    });
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("controlled-by-attacker");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agent");
  });

  it("normalizes an empty phone to null without rewriting unchanged auth data", async () => {
    mocks.userFindUnique.mockResolvedValue({
      name: "Maria da Silva",
      timeZone: "America/New_York",
      agent: { phone: "+13055550100" },
    });

    const result = await updatePersonalProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      personalForm({ phone: "" }),
    );

    expect(result.status).toBe("success");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.txUserUpdate).not.toHaveBeenCalled();
    expect(mocks.txAgentUpdate).toHaveBeenCalledWith({
      where: { id: SESSION_AGENT.id },
      data: { phone: null },
    });
  });

  it("does no writes when persisted data already matches the normalized form", async () => {
    mocks.userFindUnique.mockResolvedValue({
      name: "Maria da Silva",
      timeZone: "America/New_York",
      agent: { phone: "+13055550100" },
    });

    const result = await updatePersonalProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      personalForm(),
    );

    expect(result).toEqual({ status: "success", message: "Seu perfil já está atualizado." });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("requestEmailChangeAction", () => {
  it("requires a valid email and current password before resolving the session", async () => {
    const result = await requestEmailChangeAction(
      INITIAL_SETTINGS_ACTION_STATE,
      emailForm({ newEmail: "not-an-email", currentPassword: "" }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: {
        newEmail: "Informe um e-mail válido.",
        currentPassword: "Informe sua senha atual.",
      },
    });
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });

  it.each([
    {
      emailVerified: true,
      expectedMessage:
        "Enviamos uma autorização para old@example.com. Depois dela, confirmaremos new.email@example.com.",
    },
    {
      emailVerified: false,
      expectedMessage:
        "Enviamos a confirmação para new.email@example.com. Seu e-mail atual continua válido até a verificação.",
    },
  ])(
    "verifies the current password before requesting a normalized email when emailVerified=$emailVerified",
    async ({ emailVerified, expectedMessage }) => {
      mocks.userFindUnique.mockResolvedValue({
        email: "old@example.com",
        emailVerified,
      });

      const result = await requestEmailChangeAction(
        INITIAL_SETTINGS_ACTION_STATE,
        emailForm(),
      );

      expect(result).toEqual({ status: "success", message: expectedMessage });
      expect(mocks.userFindUnique).toHaveBeenCalledWith({
        where: { id: SESSION_AGENT.userId },
        select: { email: true, emailVerified: true },
      });
      expect(mocks.verifyPassword).toHaveBeenCalledWith({
        headers: REQUEST_HEADERS,
        body: { password: "current-password-123" },
      });
      expect(mocks.changeEmail).toHaveBeenCalledWith({
        headers: REQUEST_HEADERS,
        body: {
          newEmail: "new.email@example.com",
          callbackURL: "/agent/settings?email=verified",
        },
      });
      expect(mocks.verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.changeEmail.mock.invocationCallOrder[0],
      );
      expect(mocks.auditCreate).toHaveBeenCalledWith({
        data: {
          userId: SESSION_AGENT.userId,
          action: "USER_EMAIL_CHANGE_REQUESTED",
          entity: "User",
          entityId: SESSION_AGENT.userId,
          before: { email: "old@example.com" },
          after: { requestedEmail: "new.email@example.com" },
        },
      });
      const serializedAudit = JSON.stringify(mocks.auditCreate.mock.calls);
      expect(serializedAudit).not.toContain("current-password-123");
      expect(serializedAudit).not.toContain("controlled-by-attacker");
    },
  );

  it("stops before changeEmail and audit when current-password verification fails", async () => {
    mocks.userFindUnique.mockResolvedValue({
      email: "old@example.com",
      emailVerified: true,
    });
    mocks.verifyPassword.mockRejectedValue(authError("INVALID_PASSWORD"));

    const result = await requestEmailChangeAction(
      INITIAL_SETTINGS_ACTION_STATE,
      emailForm(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Não foi possível confirmar sua identidade.",
      fieldErrors: { currentPassword: "A senha atual está incorreta." },
    });
    expect(mocks.changeEmail).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not verify a password or request a change to the current email", async () => {
    mocks.userFindUnique.mockResolvedValue({
      email: "new.email@example.com",
      emailVerified: true,
    });

    const result = await requestEmailChangeAction(
      INITIAL_SETTINGS_ACTION_STATE,
      emailForm(),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { newEmail: "Este já é o e-mail da sua conta." },
    });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.changeEmail).not.toHaveBeenCalled();
  });
});

describe("changePasswordAction", () => {
  it("validates password policy, confirmation and reuse before invoking Better Auth", async () => {
    const result = await changePasswordAction(
      INITIAL_SETTINGS_ACTION_STATE,
      passwordForm({
        currentPassword: "same-password",
        newPassword: "same-password",
        confirmPassword: "different-password",
      }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: {
        confirmPassword: "As novas senhas não coincidem.",
        newPassword: "A nova senha precisa ser diferente da senha atual.",
      },
    });
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("uses the official password API, revokes other sessions and never audits secrets", async () => {
    const result = await changePasswordAction(
      INITIAL_SETTINGS_ACTION_STATE,
      passwordForm(),
    );

    expect(result).toEqual({
      status: "success",
      message: "Senha alterada; suas outras sessões foram encerradas.",
    });
    expect(mocks.changePassword).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: {
        currentPassword: "current-password-123",
        newPassword: "new-password-456",
        revokeOtherSessions: true,
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: SESSION_AGENT.userId,
        action: "USER_PASSWORD_CHANGED",
        entity: "User",
        entityId: SESSION_AGENT.userId,
        after: { revokedOtherSessions: true },
      },
    });
    const serializedAudit = JSON.stringify(mocks.auditCreate.mock.calls);
    expect(serializedAudit).not.toContain("current-password-123");
    expect(serializedAudit).not.toContain("new-password-456");
    expect(serializedAudit).not.toContain("controlled-by-attacker");
  });

  it("passes revokeOtherSessions=false when the checkbox is absent", async () => {
    const data = passwordForm();
    data.delete("revokeOtherSessions");

    const result = await changePasswordAction(INITIAL_SETTINGS_ACTION_STATE, data);

    expect(result).toEqual({ status: "success", message: "Senha alterada com sucesso." });
    expect(mocks.changePassword).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ revokeOtherSessions: false }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ after: { revokedOtherSessions: false } }),
    }));
  });

  it("maps an invalid current password without recording a successful audit", async () => {
    mocks.changePassword.mockRejectedValue(authError("INVALID_PASSWORD"));

    const result = await changePasswordAction(
      INITIAL_SETTINGS_ACTION_STATE,
      passwordForm(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Não foi possível alterar a senha.",
      fieldErrors: { currentPassword: "A senha atual está incorreta." },
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateAgencyProfileAction", () => {
  it("validates the name before checking agency permissions", async () => {
    const result = await updateAgencyProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      agencyForm({ agencyName: "A" }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { agencyName: "Informe o nome da agência." },
    });
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled();
    expect(mocks.requireAgencyCapability).not.toHaveBeenCalled();
  });

  it("uses the capability tenant for lookup, update and audit instead of a form agency ID", async () => {
    const result = await updateAgencyProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      agencyForm(),
    );

    expect(result).toEqual({ status: "success", message: "Nome da agência atualizado." });
    expect(mocks.requireAgencyCapability).toHaveBeenCalledWith("MANAGE_TEAM");
    expect(mocks.agencyFindUnique).toHaveBeenCalledWith({
      where: { id: "agency-from-capability" },
      select: { name: true },
    });
    expect(mocks.txAgencyUpdate).toHaveBeenCalledWith({
      where: { id: "agency-from-capability" },
      data: { name: "North Star Advisory" },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: SESSION_AGENT.userId,
        action: "AGENCY_PROFILE_UPDATED",
        entity: "Agency",
        entityId: "agency-from-capability",
        before: { name: "North Star" },
        after: { name: "North Star Advisory" },
      },
    });
    const serializedWrites = JSON.stringify([
      mocks.agencyFindUnique.mock.calls,
      mocks.txAgencyUpdate.mock.calls,
      mocks.auditCreate.mock.calls,
    ]);
    expect(serializedWrites).not.toContain("agency-controlled-by-attacker");
    expect(serializedWrites).not.toContain("user-controlled-by-attacker");
  });

  it("does not expose a cross-tenant edit surface when capability returns no agency", async () => {
    mocks.requireAgencyCapability.mockResolvedValue({
      agentId: SESSION_AGENT.id,
      agency: null,
    });

    const result = await updateAgencyProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      agencyForm(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Nenhuma agência editável foi encontrada.",
    });
    expect(mocks.agencyFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the permission-safe message when agency capability is forbidden", async () => {
    mocks.requireAgencyCapability.mockRejectedValue(
      new Error("Forbidden: agency capability MANAGE_TEAM"),
    );

    const result = await updateAgencyProfileAction(
      INITIAL_SETTINGS_ACTION_STATE,
      agencyForm(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Somente o responsável por um plano Agência ativo pode alterar este nome.",
    });
    expect(mocks.agencyFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
