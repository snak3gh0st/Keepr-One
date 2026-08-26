import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingExperience } from "@/components/onboarding/OnboardingExperience";
import "@/components/onboarding/onboarding.css";
import { getCurrentAgentOnboarding } from "@/lib/agent-onboarding";
import { isGoogleCalendarConfigured } from "@/lib/calendar/google/env";
import { FounderAccessRequiredError } from "@/lib/founder-access";
import { chatwootConfigFromEnv } from "@/lib/messaging/chatwoot-config";
import { whatsappChannelModeFromEnv } from "@/lib/messaging/channel-mode";
import { whatsappConfigFromEnv } from "@/lib/messaging/whatsapp-config";
import { getNationalLifeLocalConnectorConfig } from "@/lib/national-life/local-connector/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prepare seu acesso",
  description:
    "Confirme seus dados, conecte sua operação e conheça as áreas disponíveis na Keepr One.",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  let data: Awaited<ReturnType<typeof getCurrentAgentOnboarding>>;
  try {
    data = await getCurrentAgentOnboarding();
  } catch (error) {
    if (error instanceof FounderAccessRequiredError) {
      redirect("/founders/expired");
    }
    throw error;
  }
  if (!data.onboarding || data.onboarding.status === "COMPLETED") {
    redirect("/agent");
  }

  const nationalLifeConfig = getNationalLifeLocalConnectorConfig();
  const calendarConfigured = isGoogleCalendarConfigured();
  const chatwootConfig = chatwootConfigFromEnv(process.env);
  const whatsappMode = whatsappChannelModeFromEnv(process.env);
  const evolutionConfig = whatsappConfigFromEnv(process.env);

  // The connect endpoints provision the isolated Chatwoot account only after
  // the user asks to connect. A new account must therefore be offered whenever
  // the deployment configuration is complete; a GET render performs no setup.
  const whatsappAvailable = Boolean(
    chatwootConfig
      && (whatsappMode === "META_CLOUD" || evolutionConfig),
  );

  return (
    <OnboardingExperience
      {...data}
      onboarding={data.onboarding}
      nationalLifeConfig={nationalLifeConfig}
      calendarConfigured={calendarConfigured}
      whatsapp={{ available: whatsappAvailable, mode: whatsappMode }}
    />
  );
}
