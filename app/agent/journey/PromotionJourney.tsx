"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  getPromotionJourney,
  type PromotionMode,
} from "@/lib/promotion-journey";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { UserLanguage } from "@/lib/i18n/config";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const JACKET_SEQUENCE = [
  { name: "Blue Jacket", tone: "blue" },
  { name: "Red Jacket", tone: "red" },
  { name: "Green Jacket", tone: "green" },
  { name: "Purple Jacket", tone: "purple" },
  { name: "Black Jacket", tone: "black" },
] as const;

const BLACK_JACKET_SILHOUETTE =
  "M74 38 116 18 143 50 177 50 204 18 246 38 294 125 260 145 238 108 246 326 160 348 74 326 82 108 60 145 26 125Z";

function formatPcNumber(value: number, language: UserLanguage) {
  return formatNumber(Math.max(0, value), language, { maximumFractionDigits: 0 });
}

function formatPc(value: number, language: UserLanguage) {
  return `${formatPcNumber(value, language)} PC`;
}

function progressLabel(value: number, language: UserLanguage) {
  return formatNumber(value, language, {
    style: "percent",
    maximumFractionDigits: 0,
  });
}

function ratio(value: number, target: number) {
  if (target <= 0) return 1;
  return Math.min(Math.max(value / target, 0), 1);
}

function formatWindow(windowStart: string, windowEnd: string, language: UserLanguage) {
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  };
  return `${formatDate(windowStart, language, options)} — ${formatDate(windowEnd, language, options)}`;
}

export function PromotionJourney({
  personalPc,
  agencyPc,
  canViewAgencyJourney,
  hasAgencyStructure,
  estimatedPersonalPc,
  estimatedAgencyPc,
  pendingPersonalPc,
  pendingAgencyPc,
  hasPromotionData,
  windowStart,
  windowEnd,
  highestAchievementRankId,
}: {
  personalPc: number;
  agencyPc: number;
  canViewAgencyJourney: boolean;
  hasAgencyStructure: boolean;
  estimatedPersonalPc: number;
  estimatedAgencyPc: number;
  pendingPersonalPc: number;
  pendingAgencyPc: number;
  hasPromotionData: boolean;
  windowStart: string;
  windowEnd: string;
  highestAchievementRankId: string | null;
}) {
  const { copy, language } = useI18n();
  const root = useRef<HTMLElement>(null);
  const marquee = useRef<HTMLDivElement>(null);
  const jacketId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const previousBlackProgress = useRef(0);
  const [requestedMode, setRequestedMode] = useState<PromotionMode>(
    canViewAgencyJourney ? "agency" : "individual",
  );
  const mode = canViewAgencyJourney ? requestedMode : "individual";
  const journey = useMemo(
    () => getPromotionJourney({ personalPc, agencyPc, mode }),
    [agencyPc, mode, personalPc],
  );
  const suggestedIndex = Math.min(
    journey.currentIndex + 1,
    journey.stages.length - 1,
  );
  const [selectedIndex, setSelectedIndex] = useState(suggestedIndex);
  const selected = journey.stages[selectedIndex] ?? journey.stages[0];
  const nextPromotionStage =
    journey.stages.find((stage) => stage.status === "current") ??
    journey.stages.at(-1);
  const currentName = journey.currentRank?.title ?? copy("Agente", "Agent");
  const nextName = journey.nextRank?.title ?? copy("Black Jacket conquistada", "Black Jacket achieved");
  const rankSignature = journey.currentRank?.jacket ?? currentName;
  const highestAchievement = highestAchievementRankId
    ? journey.stages.find((stage) => stage.id === highestAchievementRankId)
    : undefined;
  const historicalAchievementIsAhead = Boolean(
    highestAchievement &&
      highestAchievement.step > (journey.currentRank?.step ?? 0),
  );
  const historicalAchievementLabel =
    highestAchievement?.jacket ?? highestAchievement?.title ?? null;
  const blackStage = journey.stages.at(-1);
  const blackProgress = blackStage?.progress ?? 0;
  const blackReached = blackStage?.qualifies ?? false;
  const blackPersonalTarget = blackStage?.personalTarget ?? 156_000;
  const blackAgencyPersonalTarget =
    blackStage?.agencyPersonalMinimum ?? 10_000;
  const blackPersonalRemaining = blackStage?.personalRemaining ?? 0;
  const blackAgencyPersonalRemaining =
    blackStage?.agencyPersonalRemaining ?? 0;
  const blackPersonalProgress = blackStage?.personalProgress ?? 0;
  const blackAgencyTarget = blackStage?.agencyTarget ?? 600_000;
  const blackAgencyRemaining = blackStage?.agencyRemaining ?? 0;
  const blackAgencyProgress = blackStage?.agencyProgress ?? 0;
  const blackAgencyProductionProgress = ratio(
    journey.agencyPc,
    blackAgencyTarget,
  );
  const strongestBlackRoute =
    mode === "agency" && blackAgencyProgress > blackPersonalProgress
      ? "agency"
      : "personal";
  const blackDisplayedTarget =
    strongestBlackRoute === "agency"
      ? blackAgencyTarget
      : blackPersonalTarget;
  const displayedEstimatedPc =
    strongestBlackRoute === "agency"
      ? estimatedAgencyPc
      : estimatedPersonalPc;
  const displayedPendingPc =
    strongestBlackRoute === "agency" ? pendingAgencyPc : pendingPersonalPc;
  const productionWindow = formatWindow(windowStart, windowEnd, language);
  const blackMilestones = journey.stages.flatMap((stage, index) => {
    if (!stage.jacketTone) return [];
    const stageTarget =
      strongestBlackRoute === "agency"
        ? stage.agencyTarget
        : stage.personalTarget;
    return [
      {
        index,
        stage,
        position: Math.min((stageTarget / blackDisplayedTarget) * 100, 100),
      },
    ];
  });
  const blackProgressMessage = blackReached
    ? copy(
        "Meta final validada. A Black Jacket está conquistada.",
        "Final goal validated. You have earned the Black Jacket.",
      )
    : strongestBlackRoute === "personal"
      ? copy(
          `${formatPc(blackPersonalRemaining, language)} restantes pela rota pessoal.`,
          `${formatPc(blackPersonalRemaining, language)} remaining on the personal path.`,
        )
      : blackAgencyRemaining > 0 && blackAgencyPersonalRemaining > 0
        ? copy(
            `${formatPc(blackAgencyRemaining, language)} na agência e ${formatPc(blackAgencyPersonalRemaining, language)} pessoais.`,
            `${formatPc(blackAgencyRemaining, language)} in agency production and ${formatPc(blackAgencyPersonalRemaining, language)} in personal production.`,
          )
        : blackAgencyRemaining > 0
          ? copy(
              `${formatPc(blackAgencyRemaining, language)} restantes na produção da agência.`,
              `${formatPc(blackAgencyRemaining, language)} remaining in agency production.`,
            )
          : copy(
              `${formatPc(blackAgencyPersonalRemaining, language)} restantes no mínimo pessoal.`,
              `${formatPc(blackAgencyPersonalRemaining, language)} remaining in the personal minimum.`,
            );
  const journeyIntro = copy(
    "Cada apólice avança pela produção reconhecida no Target Premium. A Jornada soma os PC confirmados dos últimos 12 meses.",
    "Each policy advances through production recognized in Target Premium. The Journey totals confirmed PC from the last 12 months.",
  );

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro
          .from("[data-promotion-intro]", {
            y: 20,
            opacity: 0,
            duration: 0.64,
            stagger: 0.07,
            clearProps: "transform,opacity",
          })
          .from(
            "[data-promotion-summary]",
            {
              y: 18,
              scale: 0.985,
              opacity: 0,
              duration: 0.52,
              stagger: 0.08,
              clearProps: "transform,opacity",
            },
            "-=0.34",
          );

        gsap.from("[data-promotion-stage]", {
          scrollTrigger: {
            trigger: "[data-promotion-stage-list]",
            start: "top 84%",
            once: true,
          },
          y: 22,
          opacity: 0,
          duration: 0.5,
          stagger: 0.055,
          ease: "power3.out",
          clearProps: "transform,opacity",
        });

        gsap.fromTo(
          "[data-promotion-stage-fill]",
          { scaleX: 0 },
          {
            scrollTrigger: {
              trigger: "[data-promotion-stage-list]",
              start: "top 82%",
              once: true,
            },
            scaleX: 1,
            transformOrigin: "left center",
            duration: 0.68,
            stagger: 0.045,
            ease: "power2.out",
            clearProps: "transform",
          },
        );

        gsap.fromTo(
          "[data-black-jacket-visual]",
          { scale: 0.82, opacity: 0.18 },
          {
            scrollTrigger: {
              trigger: "[data-black-jacket-visual]",
              start: "top 92%",
              once: true,
            },
            scale: 1,
            opacity: 1,
            duration: 0.78,
            ease: "power3.out",
            clearProps: "transform,opacity",
          },
        );

        gsap.fromTo(
          "[data-promotion-word]",
          { opacity: 0.18 },
          {
            opacity: 1,
            stagger: 0.045,
            ease: "none",
            scrollTrigger: {
              trigger: root.current,
              start: "top 86%",
              end: "top 42%",
              scrub: 0.6,
            },
          },
        );

        if (marquee.current) {
          const motion = gsap.to(marquee.current, {
            xPercent: -50,
            duration: 28,
            repeat: -1,
            ease: "none",
            paused: true,
          });
          const observer = new IntersectionObserver(([entry]) => {
            motion.paused(!entry.isIntersecting);
          });
          observer.observe(marquee.current);

          return () => observer.disconnect();
        }
      });

      mm.add(
        "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
        () => {
          const preview = root.current?.querySelector<HTMLElement>(
            "[data-promotion-preview]",
          );
          const layout = root.current?.querySelector<HTMLElement>(
            "[data-promotion-layout]",
          );
          if (!preview || !layout) return;

          ScrollTrigger.create({
            trigger: layout,
            start: "top 88px",
            end: "bottom bottom-=28",
            pin: preview,
            pinSpacing: false,
            anticipatePin: 1,
          });
        },
      );

      return () => mm.revert();
    },
    { scope: root },
  );

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        "[data-promotion-dynamic]",
        { y: 8, opacity: 0.35 },
        {
          y: 0,
          opacity: 1,
          duration: 0.32,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );
    },
    {
      scope: root,
      dependencies: [mode, selectedIndex],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      const previous = previousBlackProgress.current;
      previousBlackProgress.current = blackProgress;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set("[data-black-quest-fill]", {
          width: `${blackProgress * 100}%`,
        });
        gsap.set("[data-black-jacket-fill]", { scaleY: blackProgress });
        return;
      }

      gsap.fromTo(
        "[data-black-quest-fill]",
        { width: `${previous * 100}%` },
        {
          width: `${blackProgress * 100}%`,
          duration: 0.76,
          ease: "power3.out",
        },
      );
      gsap.fromTo(
        "[data-black-jacket-fill]",
        { scaleY: previous },
        {
          scaleY: blackProgress,
          duration: 0.82,
          ease: "power3.out",
        },
      );
      gsap.fromTo(
        "[data-black-progress-number]",
        { y: 7, opacity: 0.4 },
        {
          y: 0,
          opacity: 1,
          duration: 0.38,
          ease: "power3.out",
          clearProps: "transform,opacity",
        },
      );

      if (blackReached) {
        gsap.fromTo(
          "[data-black-final-node]",
          { scale: 0.72, opacity: 0.5 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.7,
            delay: 0.08,
            ease: "back.out(1.65)",
            clearProps: "transform,opacity",
          },
        );
        gsap.fromTo(
          "[data-black-target-label]",
          { opacity: 0.48, letterSpacing: "0.22em" },
          {
            opacity: 1,
            letterSpacing: "0.14em",
            duration: 0.62,
            ease: "power3.out",
            clearProps: "opacity,letterSpacing",
          },
        );
      }
    },
    {
      scope: root,
      dependencies: [blackProgress],
      revertOnUpdate: true,
    },
  );

  function selectMode(nextMode: PromotionMode) {
    const nextJourney = getPromotionJourney({
      personalPc,
      agencyPc,
      mode: nextMode,
    });
    setRequestedMode(nextMode);
    setSelectedIndex(
      Math.min(nextJourney.currentIndex + 1, nextJourney.stages.length - 1),
    );
  }

  function changeSelected(direction: -1 | 1) {
    setSelectedIndex((current) => {
      return (
        (current + direction + journey.stages.length) % journey.stages.length
      );
    });
  }

  return (
    <section
      ref={root}
      className="promotion-journey"
      aria-labelledby="promotion-journey-title"
    >
      <div
        className="promotion-theme-wash"
        data-promotion-theme-wash
        aria-hidden="true"
      />
      <p className="sr-only" aria-live="polite">
        {copy(`Identidade da jornada: ${rankSignature}.`, `Journey identity: ${rankSignature}.`)}
      </p>
      <header className="promotion-journey-header">
        <div className="promotion-journey-copy" data-promotion-intro>
          <span>{copy("Jornada de promoção", "Promotion journey")}</span>
          <h2 id="promotion-journey-title">
            {copy("Sua jornada ao", "Your journey to the")} <em>Black Jacket.</em>
          </h2>
          <p aria-label={journeyIntro}>
            {journeyIntro.split(" ").map((word, index) => (
              <span key={`${word}-${index}`} data-promotion-word aria-hidden="true">
                {word}{" "}
              </span>
            ))}
          </p>
        </div>

        <div className="promotion-scope" data-promotion-intro>
          <header className="promotion-scope-heading">
            <span>
              {canViewAgencyJourney
                ? copy("Escolha sua visão", "Choose your view")
                : copy("Sua visão", "Your view")}
            </span>
            <strong>{rankSignature}</strong>
          </header>
          <div
            role="group"
            aria-label={copy("Visão da jornada de promoção", "Promotion journey view")}
            data-single={!canViewAgencyJourney || undefined}
          >
            <button
              type="button"
              aria-pressed={mode === "individual"}
              data-active={mode === "individual" || undefined}
              onClick={() => selectMode("individual")}
            >
              {copy("Minha produção", "My production")}
            </button>
            {canViewAgencyJourney ? (
              <button
                type="button"
                aria-pressed={mode === "agency"}
                data-active={mode === "agency" || undefined}
                onClick={() => selectMode("agency")}
              >
                {copy("Minha agência", "My agency")}
              </button>
            ) : null}
          </div>
          <p>
            {historicalAchievementIsAhead && historicalAchievementLabel
              ? copy(
                  `Maior conquista histórica: ${historicalAchievementLabel}. Qualificação da janela atual: ${currentName}.`,
                  `Highest historical achievement: ${historicalAchievementLabel}. Current window qualification: ${currentName}.`,
                )
              : mode === "agency"
                ? hasAgencyStructure
                  ? copy(
                      "Você avança pela melhor rota: produção pessoal ou agência com mínimo pessoal.",
                      "You advance through the strongest path: personal production or agency production with a personal minimum.",
                    )
                  : copy(
                      "Uma projeção para quando sua estrutura estiver conectada.",
                      "A projection for when your structure is connected.",
                    )
                : copy(
                    "Seu avanço considera somente PC pessoais confirmados.",
                    "Your progress considers only confirmed personal PC.",
                  )}
          </p>
        </div>
      </header>

      <div className="promotion-pc-summary" data-promotion-dynamic>
        <article data-promotion-summary data-tone="personal">
          <header>
            <span>{copy("PC pessoais confirmados", "Confirmed personal PC")}</span>
            <i aria-hidden="true" />
          </header>
          <strong>{formatPcNumber(journey.personalPc, language)}</strong>
          {nextPromotionStage ? (
            <div className="promotion-personal-next">
              <span>
                {journey.finalReached
                  ? copy("Conquista atual", "Current achievement")
                  : copy("Próxima promoção", "Next promotion")}
              </span>
              <strong>{nextPromotionStage.title}</strong>
              <div>
                <span aria-hidden="true">
                  <i style={{ width: `${nextPromotionStage.progress * 100}%` }} />
                </span>
                <small>{progressLabel(nextPromotionStage.progress, language)}</small>
              </div>
            </div>
          ) : null}
          <div
            className="promotion-pc-evidence"
            aria-label={copy("Qualidade dos créditos de promoção", "Promotion credit quality")}
          >
            <span>
              {copy("Previstos", "Estimated")}
              <strong>{formatPcNumber(estimatedPersonalPc, language)}</strong>
            </span>
            <span>
              {copy("Em validação", "Pending validation")}
              <strong>{formatPcNumber(pendingPersonalPc, language)}</strong>
            </span>
          </div>
          <footer>
            <span>{copy("Target Premium reconhecido", "Recognized Target Premium")}</span>
            <small>{copy("Dias inclusivos em UTC", "Inclusive days in UTC")} · {productionWindow}</small>
          </footer>
        </article>
        <article
          className="promotion-black-quest"
          data-promotion-summary
          data-kind="quest"
          data-tone="black"
          data-black-reached={blackReached || undefined}
        >
          <div className="promotion-black-quest-copy">
            <header>
              <span>
                {mode === "agency"
                  ? copy(
                      `Melhor rota: ${strongestBlackRoute === "agency" ? "agência" : "pessoal"}`,
                      `Strongest path: ${strongestBlackRoute === "agency" ? "agency" : "personal"}`,
                    )
                  : copy("Rota individual", "Individual path")}
              </span>
              <span
                className="promotion-black-target"
                data-black-target-label
              >
                <i aria-hidden="true" />
                Black Jacket
              </span>
            </header>

            <div className="promotion-black-quest-heading">
              <strong data-black-progress-number>{progressLabel(blackProgress, language)}</strong>
              <div>
                <h3>
                  {blackReached
                    ? copy("Conquista desbloqueada", "Achievement unlocked")
                    : hasPromotionData
                      ? copy("Complete a jaqueta", "Complete the jacket")
                      : copy("Aguardando o primeiro PC", "Waiting for the first PC")}
                </h3>
                <p>
                  {hasPromotionData
                    ? blackProgressMessage
                    : copy(
                        "A promoção começa quando o Target Premium for reconhecido pela seguradora.",
                        "Promotion progress begins when the carrier recognizes the Target Premium.",
                      )}
                </p>
              </div>
            </div>

            <div className="promotion-black-roadmap">
              <progress
                className="sr-only"
                max={1}
                value={blackProgress}
                aria-label={copy(
                  `Progresso total até a Black Jacket: ${progressLabel(blackProgress, language)}`,
                  `Overall progress toward the Black Jacket: ${progressLabel(blackProgress, language)}`,
                )}
              />
              <div className="promotion-black-roadmap-track" aria-hidden="true">
                <i
                  data-black-quest-fill
                  style={{ width: `${blackProgress * 100}%` }}
                />
              </div>
              <ol aria-label={copy("Marcos até a Black Jacket", "Milestones toward the Black Jacket")}>
                {blackMilestones.map(({ index, position, stage }) => (
                  <li
                    key={stage.id}
                    data-status={stage.status}
                    data-tone={stage.jacketTone}
                    data-final={stage.jacketTone === "black" || undefined}
                    style={{ left: `${position}%` }}
                  >
                    <button
                      type="button"
                      aria-label={copy(`Ver ${stage.title}`, `View ${stage.title}`)}
                      aria-pressed={selectedIndex === index}
                      data-selected={selectedIndex === index || undefined}
                      onClick={() => setSelectedIndex(index)}
                    >
                      <i
                        aria-hidden="true"
                        data-black-final-node={
                          stage.jacketTone === "black" || undefined
                        }
                      />
                      <span>
                        {stage.jacketTone === "black"
                          ? stage.jacket
                          : stage.jacket?.replace(" Jacket", "")}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <dl className="promotion-black-requirements">
              <div>
                <dt>
                  {mode === "agency"
                    ? copy("Rota pessoal", "Personal path")
                    : copy("Produção pessoal", "Personal production")}
                </dt>
                <dd>
                  <strong>{formatPcNumber(journey.personalPc, language)}</strong>
                  <span>/ {formatPc(blackPersonalTarget, language)}</span>
                </dd>
                <small className="promotion-requirement-note">
                  {blackPersonalRemaining > 0
                    ? copy(
                        `Faltam ${formatPc(blackPersonalRemaining, language)}`,
                        `${formatPc(blackPersonalRemaining, language)} remaining`,
                      )
                    : copy("Rota pessoal concluída", "Personal path completed")}
                </small>
                <span aria-hidden="true">
                  <i style={{ width: `${blackPersonalProgress * 100}%` }} />
                </span>
              </div>
              {mode === "agency" ? (
                <div>
                  <dt>{copy("Rota da agência", "Agency path")}</dt>
                  <dd>
                    <strong>{formatPcNumber(journey.agencyPc, language)}</strong>
                    <span>/ {formatPc(blackAgencyTarget, language)}</span>
                  </dd>
                  <small className="promotion-requirement-note">
                    {copy("Produção", "Production")} {progressLabel(blackAgencyProductionProgress, language)} · {copy("mínimo pessoal", "personal minimum")} {formatPcNumber(journey.personalPc, language)} / {formatPcNumber(blackAgencyPersonalTarget, language)} PC
                  </small>
                  <span aria-hidden="true">
                    <i style={{ width: `${blackAgencyProgress * 100}%` }} />
                  </span>
                </div>
              ) : (
                <div>
                  <dt>{copy("Falta para a conquista", "Remaining to achievement")}</dt>
                  <dd>
                    <strong>{formatPcNumber(blackPersonalRemaining, language)}</strong>
                    <span>PC</span>
                  </dd>
                  <span aria-hidden="true">
                    <i style={{ width: `${blackProgress * 100}%` }} />
                  </span>
                </div>
              )}
            </dl>
          </div>

          <figure
            className="promotion-jacket-visual"
            data-black-jacket-visual
            aria-hidden="true"
          >
            <span>
              {blackReached
                ? copy("Conquistada", "Achieved")
                : copy(
                    `${progressLabel(blackProgress, language)} revelada`,
                    `${progressLabel(blackProgress, language)} revealed`,
                  )}
            </span>
            <svg viewBox="0 0 320 360" focusable="false">
              <defs>
                <clipPath id={`black-jacket-clip-${jacketId}`}>
                  <path d={BLACK_JACKET_SILHOUETTE} />
                </clipPath>
                <linearGradient
                  id={`black-jacket-fabric-${jacketId}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop
                    offset="0"
                    stopColor={blackReached ? "#5a5a5a" : "#4a554e"}
                  />
                  <stop
                    offset="0.3"
                    stopColor={blackReached ? "#171717" : "#151a17"}
                  />
                  <stop
                    offset="0.7"
                    stopColor={blackReached ? "#020202" : "#050706"}
                  />
                  <stop
                    offset="1"
                    stopColor={blackReached ? "#292929" : "#262d28"}
                  />
                </linearGradient>
              </defs>
              <path
                className="promotion-jacket-base"
                d={BLACK_JACKET_SILHOUETTE}
              />
              <g clipPath={`url(#black-jacket-clip-${jacketId})`}>
                <g
                  data-black-jacket-fill
                  style={{ transform: `scaleY(${blackProgress})` }}
                >
                  <rect
                    x="0"
                    y="18"
                    width="320"
                    height="330"
                    fill={`url(#black-jacket-fabric-${jacketId})`}
                  />
                  <line
                    className="promotion-jacket-level"
                    x1="26"
                    x2="294"
                    y1="19"
                    y2="19"
                  />
                </g>
              </g>
              <path
                className="promotion-jacket-outline"
                d={BLACK_JACKET_SILHOUETTE}
              />
              <path
                className="promotion-jacket-lapel"
                d="M116 18 160 86 143 50ZM204 18 160 86 177 50Z"
              />
              <path className="promotion-jacket-seam" d="M160 86V343" />
              <path className="promotion-jacket-pocket" d="M86 220h48M186 220h48" />
              <circle className="promotion-jacket-button" cx="160" cy="174" r="3" />
              <circle className="promotion-jacket-button" cx="160" cy="196" r="3" />
            </svg>
          </figure>
        </article>
      </div>

      <div className="promotion-jacket-marquee" aria-hidden="true">
        <div ref={marquee} className="promotion-jacket-track">
          {[0, 1].flatMap((cycle) =>
            JACKET_SEQUENCE.map((jacket) => (
              <span key={`${cycle}-${jacket.tone}`} data-tone={jacket.tone}>
                <i />
                {jacket.name}
              </span>
            )),
          )}
        </div>
      </div>

      <div className="promotion-layout" data-promotion-layout>
        <aside
          className="promotion-preview"
          data-promotion-preview
          data-tone={selected.jacketTone ?? "leader"}
        >
          <div data-promotion-dynamic>
            <header>
              <span>
                {selected.status === "achieved"
                  ? selected.achievement === "inherited"
                    ? copy("Marco reconhecido pelo nível superior", "Milestone recognized through a higher level")
                    : copy("Conquista alcançada pelos próprios requisitos", "Achievement earned through its own requirements")
                  : selected.status === "current"
                    ? copy("Próxima conquista", "Next achievement")
                    : copy("Marco futuro", "Future milestone")}
              </span>
              <small>
                {copy(
                  `Etapa ${String(selected.step).padStart(2, "0")}`,
                  `Stage ${String(selected.step).padStart(2, "0")}`,
                )}
              </small>
            </header>

            <div className="promotion-preview-rank">
              <p>{selected.jacket ?? copy("Liderança em construção", "Leadership in progress")}</p>
              <h3>{selected.title}</h3>
            </div>

            <div className="promotion-preview-progress">
              <span>
                <strong>{progressLabel(selected.progress, language)}</strong>
                {copy("pela rota mais avançada", "through the most advanced path")}
              </span>
              <progress
                max={1}
                value={selected.progress}
                aria-label={copy(`Progresso para ${selected.title}`, `Progress toward ${selected.title}`)}
              />
            </div>

            <dl>
              <div>
                <dt>{copy("Meta pessoal", "Personal goal")}</dt>
                <dd>{formatPc(selected.personalTarget, language)}</dd>
              </div>
              <div>
                <dt>{copy("Falta na rota pessoal", "Remaining on personal path")}</dt>
                <dd>{formatPc(selected.personalRemaining, language)}</dd>
              </div>
              {mode === "agency" ? (
                <>
                  <div>
                    <dt>{copy("Meta da agência", "Agency goal")}</dt>
                    <dd>
                      {formatPc(selected.agencyTarget, language)}
                      <small>{copy(
                        `Faltam ${formatPc(selected.agencyRemaining ?? 0, language)}`,
                        `${formatPc(selected.agencyRemaining ?? 0, language)} remaining`,
                      )}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>{copy("Mínimo pessoal da agência", "Agency personal minimum")}</dt>
                    <dd>
                      {formatPc(selected.agencyPersonalMinimum, language)}
                      <small>
                        {copy(
                          `Faltam ${formatPc(selected.agencyPersonalRemaining ?? 0, language)}`,
                          `${formatPc(selected.agencyPersonalRemaining ?? 0, language)} remaining`,
                        )}
                      </small>
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>

            <footer>
              <div>
                <span>{copy("Posição atual", "Current position")}</span>
                <strong>{currentName}</strong>
              </div>
              <div className="promotion-preview-controls">
                <button
                  type="button"
                  aria-label={copy("Ver promoção anterior", "View previous promotion")}
                  onClick={() => changeSelected(-1)}
                >
                  <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                    <path d="M13.5 9h-9M8 5.5 4.5 9 8 12.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={copy("Ver próxima promoção", "View next promotion")}
                  onClick={() => changeSelected(1)}
                >
                  <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                    <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
                  </svg>
                </button>
              </div>
            </footer>
          </div>
        </aside>

        <div className="promotion-stage-list" data-promotion-stage-list>
          <header>
            <div>
              <span>{copy("Seu caminho", "Your path")}</span>
              <h3>{nextName}</h3>
            </div>
            <div>
              <strong>{progressLabel(journey.overallProgress, language)}</strong>
              <small>{copy("até o Black Jacket", "to the Black Jacket")}</small>
            </div>
          </header>

          <ol>
            {journey.stages.map((stage, index) => (
              <li key={stage.id}>
                <button
                  type="button"
                  data-promotion-stage
                  data-status={stage.status}
                  data-selected={selectedIndex === index || undefined}
                  data-tone={stage.jacketTone ?? "leader"}
                  aria-pressed={selectedIndex === index}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="promotion-stage-number">
                    {String(stage.step).padStart(2, "0")}
                  </span>
                  <span className="promotion-stage-name">
                    <small>{stage.jacket ?? copy("Liderança", "Leadership")}</small>
                    <strong>{stage.title}</strong>
                  </span>
                  <span className="promotion-stage-meta">
                    <small>
                      {stage.status === "achieved"
                        ? stage.achievement === "inherited"
                          ? copy("Reconhecido pelo nível superior", "Recognized through a higher level")
                          : copy("Requisitos concluídos", "Requirements completed")
                        : stage.status === "current"
                          ? copy("Em progresso", "In progress")
                          : copy("Próximo marco", "Next milestone")}
                    </small>
                    <strong>{progressLabel(stage.progress, language)}</strong>
                  </span>
                  <span className="promotion-stage-track" aria-hidden="true">
                    <i
                      data-promotion-stage-fill
                      style={{ width: `${stage.progress * 100}%` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <footer className="promotion-method-note">
        <span>{copy("Como calculamos", "How we calculate it")}</span>
        <p>
          {copy(
            `PC confirmado usa o menor valor entre o Commissionable Target Premium e o AAP, multiplicado pelo peso aplicável do produto. A janela é móvel de 12 meses e inclui integralmente, em UTC, as duas datas exibidas (${productionWindow}). ${formatPc(displayedEstimatedPc, language)} estão previstos e ${formatPc(displayedPendingPc, language)} aguardam validação nessa mesma rota; nenhum deles concede promoção antes do reconhecimento da seguradora.`,
            `Confirmed PC uses the lower of Commissionable Target Premium and AAP, multiplied by the applicable product weight. The rolling 12-month window fully includes both displayed dates in UTC (${productionWindow}). ${formatPc(displayedEstimatedPc, language)} are estimated and ${formatPc(displayedPendingPc, language)} await validation on this same path; neither grants a promotion before carrier recognition.`,
          )}
        </p>
      </footer>
    </section>
  );
}
