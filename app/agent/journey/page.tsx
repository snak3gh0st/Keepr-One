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

export const dynamic = "force-dynamic";

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
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
        title="Jornada"
        eyebrow={
          isBlackJacket
            ? "Black Jacket · nível máximo conquistado"
            : "Caminho de promoção"
        }
        description={
          isBlackJacket
            ? "Você concluiu a jornada e alcançou o último nível. A Black Jacket agora representa a sua maior conquista."
            : "Acompanhe os PC reconhecidos pelo Target Premium — da primeira meta à conquista do Black Jacket."
        }
        variant={isBlackJacket ? "black-achievement" : undefined}
      >
        <Link href="/agent/commissions" className="commission-header-link">
          Ver extrato
          <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
            <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
          </svg>
        </Link>
      </PageHeader>

      {promotion.loadError && !localPreview ? (
        <ErrorBanner>
          Não foi possível calcular sua jornada agora. Tente atualizar a página.
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
