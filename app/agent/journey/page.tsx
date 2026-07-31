import Link from "next/link";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { Shell } from "@/components/Shell";
import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentPromotionSnapshot } from "@/lib/agent-promotion";
import { prisma } from "@/lib/prisma";
import {
  getPromotionIdentity,
  getPromotionJourney,
  type PromotionMode,
} from "@/lib/promotion-journey";
import { PromotionJourney } from "./PromotionJourney";

export const dynamic = "force-dynamic";

function getLocalPromotionPreview(preview?: string) {
  if (process.env.NODE_ENV !== "development") return null;

  if (preview === "blue-jacket") {
    return { personalPc: 60_000, agencyPc: 120_000 };
  }

  if (preview === "black-jacket") {
    return { personalPc: 156_000, agencyPc: 600_000 };
  }

  return null;
}

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
  const hasAgencyStructure =
    Boolean(localPreview) || promotion.hasAgencyStructure;
  const initialMode: PromotionMode = hasAgencyStructure ? "agency" : "individual";
  const promotionIdentity = getPromotionIdentity(
    getPromotionJourney({
      personalPc: displayedPersonalPc,
      agencyPc: displayedAgencyPc,
      mode: initialMode,
    }),
  );
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
            : "Transforme cada dólar registrado em um avanço visível — da primeira meta à conquista do Black Jacket."
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
            hasAgencyStructure={hasAgencyStructure}
          />
        </div>
      )}
    </Shell>
  );
}
