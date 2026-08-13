"use client";

import { useRef } from "react";
import type { CrmStageView } from "@/lib/crm";

type PipelineRailProps = {
  stages: CrmStageView[];
  allCount: number;
  activeStageKey: string | null;
  onStageChange: (stageKey: string | null) => void;
  onManage?: () => void;
  panelId?: string;
};

export function pipelineTabId(stageKey: string | null) {
  const suffix = stageKey ? stageKey.replace(/[^a-zA-Z0-9_-]/g, "-") : "all";
  return `crm-pipeline-tab-${suffix}`;
}

export function PipelineRail({
  stages,
  allCount,
  activeStageKey,
  onStageChange,
  onManage,
  panelId,
}: PipelineRailProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const items = [
    { id: null, filterKey: null, name: "Todos", caseCount: allCount },
    ...stages.map((stage) => ({
      ...stage,
      filterKey: stage.systemKey ? `system:${stage.systemKey}` : `stage:${stage.id}`,
    })),
  ];
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.filterKey === activeStageKey),
  );

  function select(index: number) {
    const item = items[index];
    if (!item) return;
    onStageChange(item.filterKey);
    refs.current[index]?.focus({ preventScroll: true });
    refs.current[index]?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    select(next);
  }

  return (
    <div className="crm-pipeline-shell">
      <div
        className="crm-pipeline-rail"
        role="tablist"
        aria-label="Filtrar leads por etapa do pipeline"
      >
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={pipelineTabId(item.filterKey)}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              data-active={active || undefined}
              key={item.id ?? "all"}
              onClick={() => select(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{item.name}</span>
              <b aria-label={`${item.caseCount} leads`}>{item.caseCount}</b>
            </button>
          );
        })}
      </div>
      {onManage ? (
        <button type="button" className="crm-pipeline-manage" onClick={onManage}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 6.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
            <path d="m15.7 11.5 1.2.9-1.6 2.8-1.5-.6c-.5.4-1 .7-1.6.9l-.2 1.6H8l-.2-1.6a6 6 0 0 1-1.6-.9l-1.5.6-1.6-2.8 1.2-.9a6 6 0 0 1 0-1.9l-1.2-.9 1.6-2.8 1.5.6c.5-.4 1-.7 1.6-.9L8 4h4l.2 1.6c.6.2 1.1.5 1.6.9l1.5-.6 1.6 2.8-1.2.9a6 6 0 0 1 0 1.9Z" />
          </svg>
          <span>Gerenciar etapas</span>
        </button>
      ) : null}
    </div>
  );
}
