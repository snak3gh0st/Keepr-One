import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentPromotionSnapshot } from "@/lib/agent-promotion";
import { getLocalPromotionPreview } from "@/lib/promotion-preview";
import { prisma } from "@/lib/prisma";
import {
  getPromotionIdentity,
  getPromotionJourney,
  type PromotionMode,
} from "@/lib/promotion-journey";
import { PromotionJourney } from "./PromotionJourney";
import { getServerI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  const { copy } = await getServerI18n();
  const localPreview = getLocalPromotionPreview(preview);
  const agent = await getCurrentAgent();
  const [user, promotion] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getAgentPromotionSnapshot(agent.id),
  ]);

  const displayedPersonalPc = localPreview
    ? localPreview.personalPc
    : promotion.personalPc;
  const displayedAgencyPc = localPreview
    ? localPreview.agencyPc
    : promotion.agencyPc;
  const canViewAgencyJourney = localPreview
    ? localPreview.canViewAgencyJourney
    : promotion.canViewAgencyJourney;
  const hasAgencyStructure = localPreview
    ? localPreview.hasAgencyStructure
    : promotion.hasAgencyStructure;
  const initialMode: PromotionMode = localPreview
    ? localPreview.mode
    : promotion.mode;
  const currentPromotionIdentity = getPromotionIdentity(
    getPromotionJourney({
      personalPc: displayedPersonalPc,
      agencyPc: displayedAgencyPc,
      mode: initialMode,
    }),
  );
  const promotionIdentity = localPreview
    ? currentPromotionIdentity
    : promotion.identity;
  const isBlackJacket = promotionIdentity.tone === "black";

  return (
    <Shell
      role="AGENT"
      userName={user?.name ?? ""}
      promotionIdentity={promotionIdentity}
    >
      <PageHeader
        title={copy("Jornada", "Journey")}
        eyebrow={
          isBlackJacket
            ? copy("Black Jacket · nível máximo conquistado", "Black Jacket · highest level achieved")
            : copy("Caminho de promoção", "Promotion path")
        }
        description={
          isBlackJacket
            ? copy(
                "Você concluiu a jornada e alcançou o último nível. A Black Jacket agora representa a sua maior conquista.",
                "You completed the journey and reached the final level. The Black Jacket now represents your greatest achievement.",
              )
            : copy(
                "Acompanhe os PC reconhecidos pelo Target Premium — da primeira meta à conquista do Black Jacket.",
                "Track the PC recognized through Target Premium — from your first goal to earning the Black Jacket.",
              )
        }
        variant={isBlackJacket ? "black-achievement" : undefined}
      >
        <Link href="/agent/commissions" className="commission-header-link">
          {copy("Ver extrato", "View statement")}
          <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
            <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
          </svg>
        </Link>
      </PageHeader>

      {promotion.loadError && !localPreview ? (
        <ErrorBanner>
          {copy(
            "Não foi possível calcular sua jornada agora. Tente atualizar a página.",
            "We could not calculate your journey right now. Try refreshing the page.",
          )}
        </ErrorBanner>
      ) : (
        <div className="journey-workspace">
          <PromotionJourney
            personalPc={displayedPersonalPc}
            agencyPc={displayedAgencyPc}
            canViewAgencyJourney={canViewAgencyJourney}
            hasAgencyStructure={hasAgencyStructure}
            estimatedPersonalPc={localPreview ? 0 : promotion.estimatedPersonalPc}
            estimatedAgencyPc={localPreview ? 0 : promotion.estimatedAgencyPc}
            pendingPersonalPc={localPreview ? 0 : promotion.pendingPersonalPc}
            pendingAgencyPc={localPreview ? 0 : promotion.pendingAgencyPc}
            hasPromotionData={Boolean(localPreview) || promotion.hasPromotionData}
            windowStart={promotion.windowStart}
            windowEnd={promotion.windowEnd}
            highestAchievementRankId={
              localPreview ? null : promotion.highestAchievement?.rankId ?? null
            }
          />
        </div>
      )}
    </Shell>
  );
}
