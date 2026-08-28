"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type AgencyRecruitmentPipelineStage<StageId extends string = string> = {
  id: StageId;
  label: string;
  shortLabel?: string;
  count: number;
  description?: string;
};

function relationshipCountLabel(count: number): string {
  return count === 1 ? "1 vínculo" : `${count} vínculos`;
}

function stageDescription(
  stage: AgencyRecruitmentPipelineStage,
): string {
  if (stage.description) return stage.description;

  if (stage.count === 0) {
    return "Nenhum vínculo direto está nesta etapa agora.";
  }

  if (stage.count === 1) {
    return "Um vínculo direto está avançando por esta etapa.";
  }

  return `${stage.count} vínculos diretos estão avançando por esta etapa.`;
}

export function AgencyRecruitmentPipeline<StageId extends string>({
  stages,
  ariaLabel = "Etapas do recrutamento direto",
}: {
  stages: readonly AgencyRecruitmentPipelineStage<StageId>[];
  ariaLabel?: string;
}) {
  const navigationId = useId();
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const preferredStageId =
    stages.find((stage) => stage.count > 0)?.id ?? stages[0]?.id ?? null;
  const [selectedStageId, setSelectedStageId] = useState<StageId | null>(
    preferredStageId,
  );
  const activeStage =
    stages.find((stage) => stage.id === selectedStageId)
    ?? stages.find((stage) => stage.id === preferredStageId)
    ?? stages[0]
    ?? null;

  if (!activeStage) return null;

  const activeStageIndex = stages.findIndex(
    (stage) => stage.id === activeStage.id,
  );
  const panelId = `${navigationId}-panel`;

  function selectStage(index: number, moveFocus = false) {
    const stage = stages[index];
    if (!stage) return;

    setSelectedStageId(stage.id);
    const trigger = triggerRefs.current[index];
    if (moveFocus) trigger?.focus({ preventScroll: true });
    trigger?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % stages.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + stages.length) % stages.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = stages.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    selectStage(nextIndex, true);
  }

  return (
    <section className="agency-pipeline-navigation" aria-label={ariaLabel}>
      <div
        className="agency-pipeline-tabs"
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
      >
        {stages.map((stage, index) => {
          const active = stage.id === activeStage.id;
          const triggerId = `${navigationId}-tab-${index}`;

          return (
            <button
              ref={(node) => {
                triggerRefs.current[index] = node;
              }}
              key={stage.id}
              id={triggerId}
              type="button"
              role="tab"
              className="agency-pipeline-tab"
              data-active={active || undefined}
              aria-label={`${stage.label}. ${relationshipCountLabel(stage.count)} nesta etapa.`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => selectStage(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{stage.shortLabel ?? stage.label}</span>
              <strong aria-hidden="true">{stage.count}</strong>
            </button>
          );
        })}
      </div>

      <div
        id={panelId}
        className="agency-pipeline-panel"
        role="tabpanel"
        aria-labelledby={`${navigationId}-tab-${activeStageIndex}`}
        tabIndex={0}
      >
        <div>
          <strong>{activeStage.label}</strong>
          <p>{stageDescription(activeStage)}</p>
        </div>
        <span>{relationshipCountLabel(activeStage.count)}</span>
      </div>
    </section>
  );
}
