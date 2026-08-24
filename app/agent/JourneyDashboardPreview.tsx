"use client";

import { useRef } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  getPromotionJourney,
  type JacketTone,
  type PromotionMode,
  type PromotionStage,
} from "@/lib/promotion-journey";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const PC = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const WINDOW_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const BLACK_JACKET_SILHOUETTE =
  "M74 38 116 18 143 50 177 50 204 18 246 38 294 125 260 145 238 108 246 326 160 348 74 326 82 108 60 145 26 125Z";

const JACKET_NODE_TONES: Record<
  JacketTone,
  { filled: string; outlined: string; label: string }
> = {
  blue: {
    filled: "border-[#56aaf0] bg-[#56aaf0] shadow-[0_0_18px_rgba(86,170,240,0.32)]",
    outlined: "border-[#56aaf0]/75 bg-[#07100c] shadow-[0_0_0_4px_rgba(86,170,240,0.08)]",
    label: "text-[#81c3f7]",
  },
  red: {
    filled: "border-[#ff746c] bg-[#ff746c] shadow-[0_0_18px_rgba(255,116,108,0.28)]",
    outlined: "border-[#ff746c]/75 bg-[#07100c] shadow-[0_0_0_4px_rgba(255,116,108,0.07)]",
    label: "text-[#ff918b]",
  },
  green: {
    filled: "border-[#55d789] bg-[#55d789] shadow-[0_0_18px_rgba(85,215,137,0.26)]",
    outlined: "border-[#55d789]/75 bg-[#07100c] shadow-[0_0_0_4px_rgba(85,215,137,0.07)]",
    label: "text-[#78e3a3]",
  },
  purple: {
    filled: "border-[#b48bed] bg-[#b48bed] shadow-[0_0_18px_rgba(180,139,237,0.27)]",
    outlined: "border-[#b48bed]/75 bg-[#07100c] shadow-[0_0_0_4px_rgba(180,139,237,0.07)]",
    label: "text-[#c9a9f4]",
  },
  black: {
    filled: "border-white bg-white shadow-[0_0_24px_rgba(255,255,255,0.3)]",
    outlined: "border-white/75 bg-[#050505] shadow-[0_0_0_5px_rgba(255,255,255,0.07)]",
    label: "text-white",
  },
};

function formatPc(value: number) {
  return `${PC.format(Math.max(0, value))} PC`;
}

function formatWindow(windowStart: string, windowEnd: string) {
  return `${WINDOW_DATE.format(new Date(windowStart))} — ${WINDOW_DATE.format(new Date(windowEnd))}`;
}

function getRemainingLabel({
  loadError,
  hasPromotionData,
  mode,
  stage,
}: {
  loadError: boolean;
  hasPromotionData: boolean;
  mode: PromotionMode;
  stage: PromotionStage | undefined;
}) {
  if (loadError) return "Progresso indisponível";
  if (!hasPromotionData) return "Aguardando Target Premium reconhecido";
  if (!stage) return "Requisitos atingidos";

  if (mode === "individual") {
    return `${formatPc(stage.personalRemaining)} para avançar pela produção pessoal`;
  }

  const agencyProgress = stage.agencyProgress ?? 0;
  if (stage.personalProgress >= agencyProgress) {
    return `${formatPc(stage.personalRemaining)} para avançar pela rota pessoal`;
  }

  const agency = stage.agencyRemaining ?? 0;
  const agencyPersonal = stage.agencyPersonalRemaining ?? 0;
  if (agency > 0 && agencyPersonal > 0) {
    return `${formatPc(agency)} na agência + ${formatPc(agencyPersonal)} pessoais`;
  }
  if (agency > 0) return `${formatPc(agency)} na agência para avançar`;
  if (agencyPersonal > 0) {
    return `${formatPc(agencyPersonal)} pessoais para validar a rota da agência`;
  }
  return "Requisitos atingidos";
}

export function JourneyDashboardPreview({
  personalPc,
  agencyPc,
  estimatedPersonalPc,
  estimatedAgencyPc,
  pendingPersonalPc,
  pendingAgencyPc,
  hasPromotionData,
  windowStart,
  windowEnd,
  highestAchievementRankId,
  mode,
  loadError,
  journeyHref = "/agent/journey",
}: {
  personalPc: number;
  agencyPc: number;
  estimatedPersonalPc: number;
  estimatedAgencyPc: number;
  pendingPersonalPc: number;
  pendingAgencyPc: number;
  hasPromotionData: boolean;
  windowStart: string;
  windowEnd: string;
  highestAchievementRankId: string | null;
  mode: PromotionMode;
  loadError: boolean;
  journeyHref?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const journey = getPromotionJourney({ personalPc, agencyPc, mode });
  const nextStage = journey.stages.find((stage) => stage.status === "current");
  const jacketStages = journey.stages.filter((stage) => stage.jacketTone);
  const finalStage = journey.stages.at(-1);
  const highestAchievement = highestAchievementRankId
    ? journey.stages.find((stage) => stage.id === highestAchievementRankId)
    : undefined;
  const historicalAchievementIsAhead = Boolean(
    highestAchievement &&
      highestAchievement.step > (journey.currentRank?.step ?? 0),
  );
  const historicalAchievementLabel =
    highestAchievement?.jacket ?? highestAchievement?.title ?? null;
  const strongestRoute =
    mode === "agency" &&
    (journey.agencyProgress ?? 0) >= journey.personalProgress
      ? "agency"
      : "personal";
  const finalTarget =
    strongestRoute === "agency"
      ? (finalStage?.agencyTarget ?? 600_000)
      : (finalStage?.personalTarget ?? 156_000);
  const displayedPc =
    strongestRoute === "agency" ? journey.agencyPc : journey.personalPc;
  const displayedEstimatedPc =
    strongestRoute === "agency" ? estimatedAgencyPc : estimatedPersonalPc;
  const displayedPendingPc =
    strongestRoute === "agency" ? pendingAgencyPc : pendingPersonalPc;
  const currentPosition =
    journey.currentRank?.jacket ??
    journey.currentRank?.title ??
    (hasPromotionData ? "Início da jornada" : "Aguardando produção reconhecida");
  const nextPromotion = journey.nextRank?.title ?? "Black Jacket conquistada";
  const progress = loadError || !hasPromotionData ? 0 : journey.overallProgress;
  const progressPercent =
    loadError || !hasPromotionData ? null : Math.round(progress * 100);
  const remainingLabel = journey.finalReached
    ? "Conquista máxima validada"
    : getRemainingLabel({
        loadError,
        hasPromotionData,
        mode,
        stage: nextStage,
      });

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const timeline = gsap.timeline({
          defaults: { ease: "power3.out" },
          scrollTrigger: {
            trigger: root.current,
            start: "top 90%",
            once: true,
          },
        });

        timeline
          .from("[data-dashboard-journey-copy]", {
            y: 18,
            opacity: 0,
            duration: 0.56,
            stagger: 0.06,
          })
          .fromTo(
            "[data-dashboard-journey-fill]",
            { scaleX: 0 },
            {
              scaleX: 1,
              transformOrigin: "left center",
              duration: 0.78,
            },
            "-=0.32",
          )
          .from(
            "[data-dashboard-journey-node]",
            {
              scale: 0.72,
              opacity: 0.18,
              duration: 0.46,
              stagger: 0.07,
            },
            "-=0.58",
          )
          .fromTo(
            "[data-dashboard-journey-jacket]",
            { scale: 0.82, opacity: 0.12 },
            { scale: 1, opacity: 1, duration: 0.72 },
            "-=0.62",
          );
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      aria-labelledby="dashboard-journey-title"
      className="keepr-noise relative mt-7 grid min-h-[238px] grid-flow-dense grid-cols-1 overflow-hidden rounded-[28px] border border-white/15 bg-black text-paper shadow-[var(--shadow-overlay)] lg:grid-cols-12"
      data-black-reached={journey.finalReached && !loadError ? "true" : undefined}
      data-stack-card
    >
      <div
        aria-hidden="true"
        className="absolute -left-24 -top-40 h-96 w-96 rounded-full bg-white/[0.025] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 right-1/4 h-80 w-80 rounded-full bg-white/[0.025] blur-3xl"
      />

      <div className="relative flex flex-col justify-between p-6 sm:p-8 lg:col-span-5 lg:border-r lg:border-white/10">
        <div>
          <div data-dashboard-journey-copy className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-mint">
              Jornada de promoção
            </p>
            <span className="h-px w-10 bg-mint/45" aria-hidden="true" />
            <p className="text-xs text-paper/48">{currentPosition}</p>
          </div>

          <h2
            id="dashboard-journey-title"
            data-dashboard-journey-copy
            className="mt-4 max-w-2xl text-[clamp(1.8rem,2.7vw,3rem)] font-medium leading-[1.02] tracking-[-0.05em]"
          >
            {loadError
              ? "Sua rota continua aqui."
              : !hasPromotionData
                ? "Sua jornada para o Black Jacket começa aqui."
              : journey.finalReached
                ? "Black Jacket conquistada."
                : `Próxima conquista: ${nextPromotion}.`}
          </h2>

          <p data-dashboard-journey-copy className="mt-4 max-w-xl text-sm leading-6 text-paper/55">
            {loadError
              ? "Os dados de produção estão temporariamente indisponíveis. Abra a Jornada para tentar novamente."
              : !hasPromotionData
                ? "Quando a seguradora reconhecer o Target Premium de uma apólice, os PC entram aqui sem usar comissão como atalho."
              : journey.finalReached
                ? "O último nível foi alcançado. Reveja a rota que transformou produção em conquista."
                : remainingLabel}
          </p>
        </div>

        <div data-dashboard-journey-copy className="mt-7 flex flex-wrap items-center gap-4">
          <Link
            href={journeyHref}
            className="group inline-flex min-h-11 items-center justify-center gap-3 rounded-full bg-paper px-5 py-3 text-sm font-semibold text-rail-strong transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {journey.finalReached && !loadError ? "Ver conquista" : "Abrir Jornada"}
            <span
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            >
              ↗
            </span>
          </Link>
          <p className="text-xs text-paper/42">
            {mode === "agency" ? "Visão da agência" : "Minha produção"}
            {" · "}
            {formatWindow(windowStart, windowEnd)}
          </p>
        </div>
      </div>

      <div className="relative flex min-w-0 flex-col justify-between p-6 sm:p-8 lg:col-span-7">
        <div className="flex items-start justify-between gap-5">
          <div data-dashboard-journey-copy>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/42">
              Rota até Black Jacket
            </p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="font-mono text-3xl font-medium tracking-[-0.055em] tabular-nums sm:text-4xl">
                {progressPercent === null ? "—" : `${progressPercent}%`}
              </strong>
              <span className="text-xs text-paper/48">
                {loadError
                  ? "cálculo indisponível"
                  : !hasPromotionData
                    ? "sem PC confirmados"
                    : `${formatPc(displayedPc)} confirmados`}
              </span>
            </div>
            {!loadError ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-paper/42">
                <span>{formatPc(displayedEstimatedPc)} previstos</span>
                <span>{formatPc(displayedPendingPc)} em validação</span>
                {mode === "agency" && hasPromotionData ? (
                  <span>
                    Melhor rota: {strongestRoute === "agency" ? "agência" : "pessoal"}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <span
            data-dashboard-journey-jacket
            aria-hidden="true"
            className={`h-20 w-[72px] shrink-0 ${journey.finalReached && !loadError ? "text-white/76" : "text-white/25"}`}
          >
            <svg className="h-full w-full" viewBox="0 0 320 360" fill="none">
              <path d={BLACK_JACKET_SILHOUETTE} stroke="currentColor" strokeWidth="4" />
              <path d="M116 18 160 86 143 50ZM204 18 160 86 177 50Z" stroke="currentColor" strokeWidth="3" />
              <path d="M160 86V343M86 220h48M186 220h48" stroke="currentColor" strokeWidth="3" />
            </svg>
          </span>
        </div>

        <div className="mt-6">
          <div className="relative h-[82px]" role="group" aria-label="Marcos até a Black Jacket">
            <div className="absolute left-0 right-1 top-[10px] h-px bg-white/14">
              <span
                data-dashboard-journey-fill
                className={`block h-px ${journey.finalReached && !loadError ? "bg-white" : "bg-mint"}`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            {!loadError && !journey.finalReached ? (
              <span
                aria-hidden="true"
                className="absolute top-[6px] h-[9px] w-[9px] -translate-x-1/2 rounded-full border border-mint bg-[#06100a] shadow-[0_0_0_4px_rgba(105,229,157,0.09)]"
                style={{ left: `${progress * 100}%` }}
              />
            ) : null}

            <ol className="absolute inset-0 m-0 list-none p-0">
              {jacketStages.map((stage) => {
                const tone = stage.jacketTone as JacketTone;
                const target =
                  strongestRoute === "agency"
                    ? stage.agencyTarget
                    : stage.personalTarget;
                const position = Math.min((target / finalTarget) * 100, 100);
                const isReached = stage.status === "achieved";
                const isCurrent = stage.status === "current";
                const nodeTone = JACKET_NODE_TONES[tone];
                const stageState = isReached
                  ? stage.achievement === "inherited"
                    ? "reconhecida pelo nível superior"
                    : "conquistada pelos próprios requisitos"
                  : isCurrent
                    ? "em progresso"
                    : "marco futuro";

                return (
                  <li
                    key={stage.id}
                    data-dashboard-journey-node
                    className="group absolute top-0 w-0"
                    style={{ left: `${position}%` }}
                    aria-label={`${stage.jacket}: ${stageState}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute left-1/2 top-[3px] -translate-x-1/2 rounded-full border transition-transform duration-300 group-hover:scale-125 ${
                        tone === "black" ? "h-[15px] w-[15px]" : "h-[13px] w-[13px]"
                      } ${
                        isReached
                          ? nodeTone.filled
                          : isCurrent
                            ? nodeTone.outlined
                            : "border-white/20 bg-[#07100c]"
                      }`}
                    />
                    <span
                      className={`absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap text-center text-[9px] font-semibold uppercase tracking-[0.12em] transition-all duration-300 group-hover:tracking-[0.16em] ${
                        isReached || isCurrent ? nodeTone.label : "text-paper/34"
                      } ${tone === "black" ? "font-bold" : ""}`}
                    >
                      {stage.jacket?.replace(" Jacket", "")}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="flex flex-col gap-2 border-t border-white/10 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="text-paper/42">
              {historicalAchievementIsAhead && historicalAchievementLabel
                ? `Maior conquista: ${historicalAchievementLabel} · janela atual: ${currentPosition}`
                : "PC confirmados · qualificação da janela atual"}
            </span>
            <span className="font-medium text-paper/74">
              {journey.finalReached && !loadError ? "Conquista concluída" : remainingLabel}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
