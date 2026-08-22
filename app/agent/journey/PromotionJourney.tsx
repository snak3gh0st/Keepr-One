"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  getPromotionJourney,
  type PromotionMode,
} from "@/lib/promotion-journey";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const PC = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const WINDOW_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const JACKET_SEQUENCE = [
  { name: "Blue Jacket", tone: "blue" },
  { name: "Red Jacket", tone: "red" },
  { name: "Green Jacket", tone: "green" },
  { name: "Purple Jacket", tone: "purple" },
  { name: "Black Jacket", tone: "black" },
] as const;

const JOURNEY_INTRO =
  "Cada apólice avança pela produção reconhecida no Target Premium. A Jornada soma os PC confirmados dos últimos 12 meses.";

const BLACK_JACKET_SILHOUETTE =
  "M74 38 116 18 143 50 177 50 204 18 246 38 294 125 260 145 238 108 246 326 160 348 74 326 82 108 60 145 26 125Z";

function formatPc(value: number) {
  return `${PC.format(Math.max(0, value))} PC`;
}

function progressLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function ratio(value: number, target: number) {
  if (target <= 0) return 1;
  return Math.min(Math.max(value / target, 0), 1);
}

function formatWindow(windowStart: string, windowEnd: string) {
  return `${WINDOW_DATE.format(new Date(windowStart))} — ${WINDOW_DATE.format(new Date(windowEnd))}`;
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
  const currentName = journey.currentRank?.title ?? "Agente";
  const nextName = journey.nextRank?.title ?? "Black Jacket conquistada";
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
  const blackPercent = Math.round(blackProgress * 100);
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
  const productionWindow = formatWindow(windowStart, windowEnd);
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
    ? "Meta final validada. A Black Jacket está conquistada."
    : strongestBlackRoute === "personal"
      ? `${formatPc(blackPersonalRemaining)} restantes pela rota pessoal.`
      : blackAgencyRemaining > 0 && blackAgencyPersonalRemaining > 0
        ? `${formatPc(blackAgencyRemaining)} na agência e ${formatPc(blackAgencyPersonalRemaining)} pessoais.`
        : blackAgencyRemaining > 0
          ? `${formatPc(blackAgencyRemaining)} restantes na produção da agência.`
          : `${formatPc(blackAgencyPersonalRemaining)} restantes no mínimo pessoal.`;

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
        Identidade da jornada: {rankSignature}.
      </p>
      <header className="promotion-journey-header">
        <div className="promotion-journey-copy" data-promotion-intro>
          <span>Jornada de promoção</span>
          <h2 id="promotion-journey-title">
            Sua jornada ao <em>Black Jacket.</em>
          </h2>
          <p aria-label={JOURNEY_INTRO}>
            {JOURNEY_INTRO.split(" ").map((word, index) => (
              <span key={`${word}-${index}`} data-promotion-word aria-hidden="true">
                {word}{" "}
              </span>
            ))}
          </p>
        </div>

        <div className="promotion-scope" data-promotion-intro>
          <header className="promotion-scope-heading">
            <span>{canViewAgencyJourney ? "Escolha sua visão" : "Sua visão"}</span>
            <strong>{rankSignature}</strong>
          </header>
          <div
            role="group"
            aria-label="Visão da jornada de promoção"
            data-single={!canViewAgencyJourney || undefined}
          >
            <button
              type="button"
              aria-pressed={mode === "individual"}
              data-active={mode === "individual" || undefined}
              onClick={() => selectMode("individual")}
            >
              Minha produção
            </button>
            {canViewAgencyJourney ? (
              <button
                type="button"
                aria-pressed={mode === "agency"}
                data-active={mode === "agency" || undefined}
                onClick={() => selectMode("agency")}
              >
                Minha agência
              </button>
            ) : null}
          </div>
          <p>
            {historicalAchievementIsAhead && historicalAchievementLabel
              ? `Maior conquista histórica: ${historicalAchievementLabel}. Qualificação da janela atual: ${currentName}.`
              : mode === "agency"
                ? hasAgencyStructure
                  ? "Você avança pela melhor rota: produção pessoal ou agência com mínimo pessoal."
                  : "Uma projeção para quando sua estrutura estiver conectada."
                : "Seu avanço considera somente PC pessoais confirmados."}
          </p>
        </div>
      </header>

      <div className="promotion-pc-summary" data-promotion-dynamic>
        <article data-promotion-summary data-tone="personal">
          <header>
            <span>PC pessoais confirmados</span>
            <i aria-hidden="true" />
          </header>
          <strong>{PC.format(journey.personalPc)}</strong>
          {nextPromotionStage ? (
            <div className="promotion-personal-next">
              <span>
                {journey.finalReached ? "Conquista atual" : "Próxima promoção"}
              </span>
              <strong>{nextPromotionStage.title}</strong>
              <div>
                <span aria-hidden="true">
                  <i style={{ width: `${nextPromotionStage.progress * 100}%` }} />
                </span>
                <small>{progressLabel(nextPromotionStage.progress)}</small>
              </div>
            </div>
          ) : null}
          <div className="promotion-pc-evidence" aria-label="Qualidade dos créditos de promoção">
            <span>
              Previstos
              <strong>{PC.format(estimatedPersonalPc)}</strong>
            </span>
            <span>
              Em validação
              <strong>{PC.format(pendingPersonalPc)}</strong>
            </span>
          </div>
          <footer>
            <span>Target Premium reconhecido</span>
            <small>Dias inclusivos em UTC · {productionWindow}</small>
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
                  ? `Melhor rota: ${strongestBlackRoute === "agency" ? "agência" : "pessoal"}`
                  : "Rota individual"}
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
              <strong data-black-progress-number>{blackPercent}%</strong>
              <div>
                <h3>
                  {blackReached
                    ? "Conquista desbloqueada"
                    : hasPromotionData
                      ? "Complete a jaqueta"
                      : "Aguardando o primeiro PC"}
                </h3>
                <p>
                  {hasPromotionData
                    ? blackProgressMessage
                    : "A promoção começa quando o Target Premium for reconhecido pela seguradora."}
                </p>
              </div>
            </div>

            <div className="promotion-black-roadmap">
              <progress
                className="sr-only"
                max={1}
                value={blackProgress}
                aria-label={`Progresso total até a Black Jacket: ${blackPercent}%`}
              />
              <div className="promotion-black-roadmap-track" aria-hidden="true">
                <i
                  data-black-quest-fill
                  style={{ width: `${blackProgress * 100}%` }}
                />
              </div>
              <ol aria-label="Marcos até a Black Jacket">
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
                      aria-label={`Ver ${stage.title}`}
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
                <dt>{mode === "agency" ? "Rota pessoal" : "Produção pessoal"}</dt>
                <dd>
                  <strong>{PC.format(journey.personalPc)}</strong>
                  <span>/ {formatPc(blackPersonalTarget)}</span>
                </dd>
                <small className="promotion-requirement-note">
                  {blackPersonalRemaining > 0
                    ? `Faltam ${formatPc(blackPersonalRemaining)}`
                    : "Rota pessoal concluída"}
                </small>
                <span aria-hidden="true">
                  <i style={{ width: `${blackPersonalProgress * 100}%` }} />
                </span>
              </div>
              {mode === "agency" ? (
                <div>
                  <dt>Rota da agência</dt>
                  <dd>
                    <strong>{PC.format(journey.agencyPc)}</strong>
                    <span>/ {formatPc(blackAgencyTarget)}</span>
                  </dd>
                  <small className="promotion-requirement-note">
                    Produção {progressLabel(blackAgencyProductionProgress)} · mínimo
                    pessoal {PC.format(journey.personalPc)} / {PC.format(blackAgencyPersonalTarget)} PC
                  </small>
                  <span aria-hidden="true">
                    <i style={{ width: `${blackAgencyProgress * 100}%` }} />
                  </span>
                </div>
              ) : (
                <div>
                  <dt>Falta para a conquista</dt>
                  <dd>
                    <strong>{PC.format(blackPersonalRemaining)}</strong>
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
            <span>{blackReached ? "Conquistada" : `${blackPercent}% revelada`}</span>
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
          {[0, 1].flatMap((copy) =>
            JACKET_SEQUENCE.map((jacket) => (
              <span key={`${copy}-${jacket.tone}`} data-tone={jacket.tone}>
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
                    ? "Marco reconhecido pelo nível superior"
                    : "Conquista alcançada pelos próprios requisitos"
                  : selected.status === "current"
                    ? "Próxima conquista"
                    : "Marco futuro"}
              </span>
              <small>Etapa {String(selected.step).padStart(2, "0")}</small>
            </header>

            <div className="promotion-preview-rank">
              <p>{selected.jacket ?? "Liderança em construção"}</p>
              <h3>{selected.title}</h3>
            </div>

            <div className="promotion-preview-progress">
              <span>
                <strong>{progressLabel(selected.progress)}</strong>
                pela rota mais avançada
              </span>
              <progress
                max={1}
                value={selected.progress}
                aria-label={`Progresso para ${selected.title}`}
              />
            </div>

            <dl>
              <div>
                <dt>Meta pessoal</dt>
                <dd>{formatPc(selected.personalTarget)}</dd>
              </div>
              <div>
                <dt>Falta na rota pessoal</dt>
                <dd>{formatPc(selected.personalRemaining)}</dd>
              </div>
              {mode === "agency" ? (
                <>
                  <div>
                    <dt>Meta da agência</dt>
                    <dd>
                      {formatPc(selected.agencyTarget)}
                      <small>Faltam {formatPc(selected.agencyRemaining ?? 0)}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Mínimo pessoal da agência</dt>
                    <dd>
                      {formatPc(selected.agencyPersonalMinimum)}
                      <small>
                        Faltam {formatPc(selected.agencyPersonalRemaining ?? 0)}
                      </small>
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>

            <footer>
              <div>
                <span>Posição atual</span>
                <strong>{currentName}</strong>
              </div>
              <div className="promotion-preview-controls">
                <button
                  type="button"
                  aria-label="Ver promoção anterior"
                  onClick={() => changeSelected(-1)}
                >
                  <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
                    <path d="M13.5 9h-9M8 5.5 4.5 9 8 12.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Ver próxima promoção"
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
              <span>Seu caminho</span>
              <h3>{nextName}</h3>
            </div>
            <div>
              <strong>{progressLabel(journey.overallProgress)}</strong>
              <small>até o Black Jacket</small>
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
                    <small>{stage.jacket ?? "Liderança"}</small>
                    <strong>{stage.title}</strong>
                  </span>
                  <span className="promotion-stage-meta">
                    <small>
                      {stage.status === "achieved"
                        ? stage.achievement === "inherited"
                          ? "Reconhecido pelo nível superior"
                          : "Requisitos concluídos"
                        : stage.status === "current"
                          ? "Em progresso"
                          : "Próximo marco"}
                    </small>
                    <strong>{progressLabel(stage.progress)}</strong>
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
        <span>Como calculamos</span>
        <p>
          PC confirmado usa o menor valor entre o Commissionable Target Premium
          e o AAP, multiplicado pelo peso aplicável do produto. A janela é móvel
          de 12 meses e inclui integralmente, em UTC, as duas datas exibidas
          ({productionWindow}). {formatPc(displayedEstimatedPc)} estão previstos e{" "}
          {formatPc(displayedPendingPc)} aguardam validação nessa mesma rota;
          nenhum deles concede promoção antes do reconhecimento da seguradora.
        </p>
      </footer>
    </section>
  );
}
