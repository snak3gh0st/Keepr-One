"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CrmStageView } from "@/lib/crm";
import { OverlaySurface } from "@/components/overlays/OverlaySurface";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { localizedCrmStageName } from "./i18n";

type Result = { ok: true } | { ok: false; message: string };

export type StageManagerActions = {
  create: (input: { name: string; position: number }) => Promise<Result>;
  rename: (input: { stageId: string; name: string }) => Promise<Result>;
  reorder: (orderedStageIds: string[]) => Promise<Result>;
  archive: (input: {
    stageId: string;
    transferToStageId?: string;
  }) => Promise<Result>;
};

function sortStages(stages: CrmStageView[]) {
  return [...stages].sort((a, b) => a.position - b.position);
}

export function StageManagerDrawer({
  open,
  onClose,
  stages,
  actions,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  stages: CrmStageView[];
  actions: StageManagerActions;
  onChanged: () => void;
}) {
  const { copy } = useI18n();
  const [ordered, setOrdered] = useState(() => sortStages(stages));
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState(stages.length + 1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const transferRef = useRef<HTMLElement>(null);

  const removing = useMemo(
    () => ordered.find((stage) => stage.id === removingId) ?? null,
    [ordered, removingId],
  );
  const transferCandidates = useMemo(
    () =>
      ordered.filter(
        (stage) =>
          stage.id !== removing?.id && (!removing?.systemKey || !stage.systemKey),
      ),
    [ordered, removing],
  );

  useEffect(() => {
    if (!removingId) return;
    const frame = window.requestAnimationFrame(() => transferRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [removingId]);

  function run(task: () => Promise<Result>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      after?.();
      onChanged();
    });
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[destination]] = [next[destination], next[index]];
    setOrdered(next);
    setError(null);
    startTransition(async () => {
      const result = await actions.reorder(next.map((stage) => stage.id));
      if (!result.ok) {
        setOrdered(ordered);
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <OverlaySurface
      open={open}
      onClose={onClose}
      titleId="stage-manager-title"
      descriptionId="stage-manager-description"
      variant="drawer"
    >
      <div className="crm-stage-manager" aria-busy={pending}>
        <header>
          <div>
            <span>{copy("Pipeline pessoal", "Personal pipeline")}</span>
            <h2 id="stage-manager-title">{copy("Gerenciar etapas", "Manage stages")}</h2>
            <p id="stage-manager-description">
              {copy("Adapte a sequência ao seu processo sem perder nenhum lead.", "Adapt the sequence to your process without losing any leads.")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={copy("Fechar painel", "Close panel")}>
            ×
          </button>
        </header>

        <form
          className="crm-stage-create"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) return;
            run(
              () => actions.create({ name, position: newPosition }),
              () => setNewName(""),
            );
          }}
        >
          <label>
            <span>{copy("Nova etapa", "New stage")}</span>
            <input
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={copy("Nome da etapa", "Stage name")}
            />
          </label>
          <label>
            <span>{copy("Posição", "Position")}</span>
            <select
              value={newPosition}
              onChange={(event) => setNewPosition(Number(event.target.value))}
            >
              {Array.from({ length: ordered.length + 1 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || !newName.trim()}>
            {copy("Adicionar", "Add")}
          </button>
        </form>

        <div className="crm-stage-list-heading">
          <span>{ordered.length === 1 ? copy("1 etapa", "1 stage") : copy("{count} etapas", "{count} stages", { count: ordered.length })}</span>
          <small>{copy("Use as setas para alterar a ordem", "Use the arrows to change the order")}</small>
        </div>

        <ol className="crm-stage-list">
          {ordered.map((stage, index) => (
            <li key={stage.id} data-system={stage.systemKey || undefined}>
              <span className="crm-stage-position">{String(index + 1).padStart(2, "0")}</span>
              {editingId === stage.id ? (
                <form
                  className="crm-stage-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = editingName.trim();
                    if (!name) return;
                    run(
                      () => actions.rename({ stageId: stage.id, name }),
                      () => setEditingId(null),
                    );
                  }}
                >
                  <label className="sr-only" htmlFor={`rename-${stage.id}`}>
                    {copy("Novo nome", "New name")}
                  </label>
                  <input
                    id={`rename-${stage.id}`}
                    autoFocus
                    value={editingName}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.target.value)}
                  />
                  <button type="submit" disabled={pending}>{copy("Salvar", "Save")}</button>
                  <button type="button" onClick={() => setEditingId(null)}>{copy("Cancelar", "Cancel")}</button>
                </form>
              ) : (
                <div className="crm-stage-name">
                  <strong>{localizedCrmStageName(copy, stage)}</strong>
                  <small>
                    {stage.caseCount === 1 ? copy("1 lead", "1 lead") : copy("{count} leads", "{count} leads", { count: stage.caseCount })}
                    {stage.systemKey ? copy(" · etapa padrão", " · default stage") : copy(" · personalizada", " · custom")}
                  </small>
                </div>
              )}
              {editingId !== stage.id ? (
                <div className="crm-stage-actions">
                  <button
                    type="button"
                    disabled={pending || index === 0}
                    aria-label={copy("Mover {stage} para cima", "Move {stage} up", { stage: localizedCrmStageName(copy, stage) })}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending || index === ordered.length - 1}
                    aria-label={copy("Mover {stage} para baixo", "Move {stage} down", { stage: localizedCrmStageName(copy, stage) })}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={copy("Editar {stage}", "Edit {stage}", { stage: localizedCrmStageName(copy, stage) })}
                    onClick={() => {
                      setEditingId(stage.id);
                      setEditingName(stage.name);
                    }}
                  >
                    {copy("Editar", "Edit")}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={pending || ordered.length <= 1}
                    aria-label={copy("Remover {stage}", "Remove {stage}", { stage: localizedCrmStageName(copy, stage) })}
                    onClick={() => {
                      setRemovingId(stage.id);
                      setError(null);
                      const candidate = ordered.find(
                        (item) =>
                          item.id !== stage.id && (!stage.systemKey || !item.systemKey),
                      );
                      setTransferTo(candidate?.id ?? "");
                    }}
                  >
                    {copy("Remover", "Remove")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>

        {removing ? (
          <section
            ref={transferRef}
            tabIndex={-1}
            className="crm-stage-transfer"
            aria-labelledby="stage-transfer-title"
          >
            <div>
              <span>{copy("Confirmar remoção", "Confirm removal")}</span>
              <h3 id="stage-transfer-title">{copy("Mover leads antes de excluir?", "Move leads before deleting?")}</h3>
              <p>
                {removing.caseCount > 0
                  ? copy("Existem {count} leads em “{stage}”. Escolha a etapa de destino.", "There are {count} leads in “{stage}”. Choose the destination stage.", { count: removing.caseCount, stage: localizedCrmStageName(copy, removing) })
                  : removing.systemKey
                    ? copy("“{stage}” está vazia. Escolha qual etapa herdará seu comportamento padrão.", "“{stage}” is empty. Choose which stage will inherit its default behavior.", { stage: localizedCrmStageName(copy, removing) })
                    : copy("“{stage}” está vazia e pode ser removida com segurança.", "“{stage}” is empty and can be safely removed.", { stage: removing.name })}
              </p>
            </div>
            {removing.caseCount > 0 || removing.systemKey ? (
              <label>
                <span>{copy("Transferir para", "Transfer to")}</span>
                <select
                  value={transferTo}
                  disabled={transferCandidates.length === 0}
                  onChange={(event) => setTransferTo(event.target.value)}
                >
                  {transferCandidates.length === 0 ? (
                    <option value="">{copy("Crie uma etapa personalizada", "Create a custom stage")}</option>
                  ) : null}
                  {transferCandidates.map((stage) => (
                    <option key={stage.id} value={stage.id}>{localizedCrmStageName(copy, stage)}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {removing.systemKey && transferCandidates.length === 0 ? (
              <p role="status">
                {copy("Para remover uma etapa padrão, crie primeiro uma etapa personalizada. Ela receberá os leads e o comportamento automático desta etapa.", "To remove a default stage, first create a custom stage. It will receive the leads and the automatic behavior from this stage.")}
              </p>
            ) : null}
            <footer>
              <button type="button" onClick={() => setRemovingId(null)}>{copy("Cancelar", "Cancel")}</button>
              <button
                type="button"
                className="danger"
                disabled={pending || ((removing.caseCount > 0 || Boolean(removing.systemKey)) && !transferTo)}
                onClick={() =>
                  run(
                    () =>
                      actions.archive({
                        stageId: removing.id,
                        transferToStageId:
                          removing.caseCount > 0 || removing.systemKey ? transferTo : undefined,
                      }),
                    () => setRemovingId(null),
                  )
                }
              >
                {copy("Remover etapa", "Remove stage")}
              </button>
            </footer>
          </section>
        ) : null}

        {error ? <p className="crm-stage-error" role="alert">{error}</p> : null}
      </div>
    </OverlaySurface>
  );
}
