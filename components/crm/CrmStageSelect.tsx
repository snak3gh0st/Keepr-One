"use client";

import { useId, useState, useTransition } from "react";
import type { CrmStageView } from "@/lib/crm";
import { CrmStagePill } from "@/components/StatusPill";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { localizedCrmStage, localizedCrmStageName } from "./i18n";

type Result = { ok: true } | { ok: false; message: string };

export function CrmStageSelect({
  caseId,
  stage,
  stages,
  onChange,
  onFollowUpRequired,
  compact = false,
}: {
  caseId: string;
  stage: Pick<CrmStageView, "id" | "name" | "systemKey"> | null;
  stages: CrmStageView[];
  onChange: (caseId: string, stageId: string) => Promise<Result>;
  onFollowUpRequired?: (stageId: string) => void;
  compact?: boolean;
}) {
  const { copy } = useI18n();
  const id = useId();
  const errorId = `${id}-error`;
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        type="button"
        className="crm-stage-pill-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setError(null);
          setEditing(true);
        }}
        aria-label={stage
          ? copy("Alterar etapa: {stage}", "Change stage: {stage}", {
              stage: localizedCrmStageName(copy, stage),
            })
          : copy("Alterar etapa", "Change stage")}
      >
        <CrmStagePill stage={localizedCrmStage(copy, stage)} />
        <span aria-hidden="true">⌄</span>
      </button>
    );
  }

  return (
    <span
      className="crm-stage-select-wrap"
      data-compact={compact || undefined}
      aria-busy={pending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {copy("Alterar etapa do lead", "Change lead stage")}
      </label>
      <select
        id={id}
        autoFocus
        disabled={pending}
        value={stage?.id ?? ""}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onBlur={(event) => {
          if (pending || error) return;
          const nextFocus = event.relatedTarget as Node | null;
          if (!nextFocus || !event.currentTarget.parentElement?.contains(nextFocus)) {
            setEditing(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || pending) return;
          event.preventDefault();
          setError(null);
          setEditing(false);
        }}
        onChange={(event) => {
          const nextId = event.target.value;
          const next = stages.find((item) => item.id === nextId);
          if (!next) return;
          if (next.id === stage?.id) {
            setEditing(false);
            return;
          }
          setError(null);
          if (next.systemKey === "FOLLOW_UP" && onFollowUpRequired) {
            onFollowUpRequired(next.id);
            setEditing(false);
            return;
          }
          startTransition(async () => {
            const result = await onChange(caseId, next.id);
            if (result.ok) setEditing(false);
            else setError(result.message);
          });
        }}
      >
        {!stage ? <option value="">{copy("Sem etapa", "No stage")}</option> : null}
        {stages.map((item) => (
          <option key={item.id} value={item.id}>
            {localizedCrmStageName(copy, item)}
          </option>
        ))}
      </select>
      {pending ? (
        <>
          <i aria-hidden="true" />
          <span className="sr-only" role="status">{copy("Salvando etapa…", "Saving stage…")}</span>
        </>
      ) : null}
      {error ? (
        <small id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </span>
  );
}
