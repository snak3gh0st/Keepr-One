export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/PageHeader";
import { Shell } from "@/components/Shell";
import { getCurrentAgentAccess } from "@/lib/agent-access";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { getNationalLifeLocalConnectorConfig } from "@/lib/national-life/local-connector/config";
import { getKBotCredentialWebConfig } from "@/lib/national-life/credentials/config";
import { getNationalLifeCredentialSummary } from "@/lib/national-life/credentials/settings-service";
import { SettingsForms } from "./SettingsForms";
import { getServerI18n } from "@/lib/i18n/server";

export default async function AgentSettingsPage() {
  const { copy } = await getServerI18n();
  const agent = await getCurrentAgent();
  const [access, user, credentialSummary] = await Promise.all([
    getCurrentAgentAccess(),
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: {
        name: true,
        email: true,
        emailVerified: true,
        timeZone: true,
      },
    }),
    getNationalLifeCredentialSummary(agent.id),
  ]);

  if (!user) {
    throw new Error(copy("Usuário da conta não encontrado.", "Account user not found."));
  }
  const kbot = getNationalLifeLocalConnectorConfig();
  const credentialConfig = getKBotCredentialWebConfig();
  const credentialBrokerEnabled = credentialConfig.enabled && (
    credentialConfig.autoLoginAllAgents
    || credentialConfig.autoLoginAgentIds.has(agent.id)
  );

  return (
    <Shell role="AGENT" userName={user.name}>
      <PageHeader
        title={copy("Configurações da conta", "Account settings")}
        eyebrow={copy("Conta e segurança", "Account and security")}
        description={copy("Atualize seus dados pessoais, credenciais de acesso e a identificação da sua agência em um só lugar.", "Update your personal details, sign-in credentials, and agency identity in one place.")}
      />

      <SettingsForms
        personal={{
          name: user.name,
          phone: agent.phone ?? "",
          timeZone: user.timeZone,
        }}
        professional={{
          npn: agent.npn,
          rank: agent.rank,
          status: agent.status,
        }}
        security={{
          email: user.email,
          emailVerified: user.emailVerified,
        }}
        agency={{
          kind: access.kind,
          name: access.agencyName,
          subscriptionStatus: access.subscriptionStatus,
          canEditAgency: access.canManageTeam,
        }}
        kbot={{
          enabled: kbot.enabled,
          credentialBrokerEnabled,
          credentialSummary,
        }}
      />
    </Shell>
  );
}
