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
} from "@/lib/promotion-journey";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const PC = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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

function getRemainingLabel({
  loadError,
  mode,
  personalRemaining,
  agencyRemaining,
}: {
  loadError: boolean;
  mode: PromotionMode;
  personalRemaining: number;
  agencyRemaining: number | null;
}) {
  if (loadError) return "Progresso indisponível";

  if (mode === "individual") {
    return `${formatPc(personalRemaining)} para avançar`;
  }

  const agency = agencyRemaining ?? 0;
  if (agency > 0 && personalRemaining > 0) {
    return `${formatPc(agency)} na agência + ${formatPc(personalRemaining)} pessoais`;
  }
  if (agency > 0) return `${formatPc(agency)} na agência para avançar`;
  if (personalRemaining > 0) return `${formatPc(personalRemaining)} pessoais para avançar`;
  return "Requisitos atingidos";
}

export function JourneyDashboardPreview({
  personalPc,
  agencyPc,
  mode,
  loadError,
}: {
  personalPc: number;
  agencyPc: number;
  mode: PromotionMode;
  loadError: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const journey = getPromotionJourney({ personalPc, agencyPc, mode });
  const nextStage = journey.stages.find((stage) => stage.status === "current");
  const jacketStages = journey.stages.filter((stage) => stage.jacketTone);
  const finalStage = journey.stages.at(-1);
  const finalTarget =
    mode === "agency"
      ? (finalStage?.agencyTarget ?? 600_000)
      : (finalStage?.personalTarget ?? 156_000);
  const displayedPc = mode === "agency" ? journey.agencyPc : journey.personalPc;
  const currentPosition = journey.currentRank?.jacket ?? journey.currentRank?.title ?? "Início da jornada";
  const nextPromotion = journey.nextRank?.title ?? "Black Jacket conquistada";
  const progress = loadError ? 0 : journey.overallProgress;
  const progressPercent = loadError ? null : Math.round(progress * 100);
  const remainingLabel = journey.finalReached
    ? "Conquista máxima validada"
    : getRemainingLabel({
        loadError,
        mode,
        personalRemaining: nextStage?.personalRemaining ?? 0,
        agencyRemaining: nextStage?.agencyRemaining ?? null,
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
      className={`keepr-noise relative mt-7 grid min-h-[238px] grid-flow-dense grid-cols-1 overflow-hidden rounded-[28px] border text-paper shadow-[var(--shadow-overlay)] lg:grid-cols-12 ${
        journey.finalReached && !loadError
          ? "border-white/15 bg-black"
          : "border-white/10 bg-[#06100a]"
      }`}
      data-black-reached={journey.finalReached && !loadError ? "true" : undefined}
      data-stack-card
    >
      <div
        aria-hidden="true"
        className="absolute -left-24 -top-40 h-96 w-96 rounded-full bg-mint/10 blur-3xl"
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
              : journey.finalReached
                ? "Black Jacket conquistada."
                : `Próxima conquista: ${nextPromotion}.`}
          </h2>

          <p data-dashboard-journey-copy className="mt-4 max-w-xl text-sm leading-6 text-paper/55">
            {loadError
              ? "Os dados de produção estão temporariamente indisponíveis. Abra a Jornada para tentar novamente."
              : journey.finalReached
                ? "O último nível foi alcançado. Reveja a rota que transformou produção em conquista."
                : remainingLabel}
          </p>
        </div>

        <div data-dashboard-journey-copy className="mt-7 flex flex-wrap items-center gap-4">
          <Link
            href="/agent/journey"
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
                {loadError ? "—" : `${progressPercent}%`}
              </strong>
              <span className="text-xs text-paper/48">
                {loadError ? "cálculo indisponível" : `${formatPc(displayedPc)} registrados`}
              </span>
            </div>
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
                const target = mode === "agency" ? stage.agencyTarget : stage.personalTarget;
                const position = Math.min((target / finalTarget) * 100, 100);
                const isReached = stage.status === "achieved";
                const isCurrent = stage.status === "current";
                const nodeTone = JACKET_NODE_TONES[tone];

                return (
                  <li
                    key={stage.id}
                    data-dashboard-journey-node
                    className="group absolute top-0 w-0"
                    style={{ left: `${position}%` }}
                    aria-label={`${stage.jacket}: ${isReached ? "conquistada" : isCurrent ? "em progresso" : "marco futuro"}`}
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
            <span className="text-paper/42">Posição atual: {currentPosition}</span>
            <span className="font-medium text-paper/74">
              {journey.finalReached && !loadError ? "Conquista concluída" : remainingLabel}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
