"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CrmStageView } from "@/lib/crm";
import { OverlaySurface } from "@/components/overlays/OverlaySurface";

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
            <span>Pipeline pessoal</span>
            <h2 id="stage-manager-title">Gerenciar etapas</h2>
            <p id="stage-manager-description">
              Adapte a sequência ao seu processo sem perder nenhum lead.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar painel">
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
            <span>Nova etapa</span>
            <input
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nome da etapa"
            />
          </label>
          <label>
            <span>Posição</span>
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
            Adicionar
          </button>
        </form>

        <div className="crm-stage-list-heading">
          <span>{ordered.length} etapas</span>
          <small>Use as setas para alterar a ordem</small>
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
                    Novo nome
                  </label>
                  <input
                    id={`rename-${stage.id}`}
                    autoFocus
                    value={editingName}
                    maxLength={80}
                    onChange={(event) => setEditingName(event.target.value)}
                  />
                  <button type="submit" disabled={pending}>Salvar</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancelar</button>
                </form>
              ) : (
                <div className="crm-stage-name">
                  <strong>{stage.name}</strong>
                  <small>
                    {stage.caseCount} {stage.caseCount === 1 ? "lead" : "leads"}
                    {stage.systemKey ? " · etapa padrão" : " · personalizada"}
                  </small>
                </div>
              )}
              {editingId !== stage.id ? (
                <div className="crm-stage-actions">
                  <button
                    type="button"
                    disabled={pending || index === 0}
                    aria-label={`Mover ${stage.name} para cima`}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending || index === ordered.length - 1}
                    aria-label={`Mover ${stage.name} para baixo`}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Editar ${stage.name}`}
                    onClick={() => {
                      setEditingId(stage.id);
                      setEditingName(stage.name);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={pending || ordered.length <= 1}
                    aria-label={`Remover ${stage.name}`}
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
                    Remover
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
              <span>Confirmar remoção</span>
              <h3 id="stage-transfer-title">Mover leads antes de excluir?</h3>
              <p>
                {removing.caseCount > 0
                  ? `Existem ${removing.caseCount} leads em “${removing.name}”. Escolha a etapa de destino.`
                  : removing.systemKey
                    ? `“${removing.name}” está vazia. Escolha qual etapa herdará seu comportamento padrão.`
                    : `“${removing.name}” está vazia e pode ser removida com segurança.`}
              </p>
            </div>
            {removing.caseCount > 0 || removing.systemKey ? (
              <label>
                <span>Transferir para</span>
                <select
                  value={transferTo}
                  disabled={transferCandidates.length === 0}
                  onChange={(event) => setTransferTo(event.target.value)}
                >
                  {transferCandidates.length === 0 ? (
                    <option value="">Crie uma etapa personalizada</option>
                  ) : null}
                  {transferCandidates.map((stage) => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {removing.systemKey && transferCandidates.length === 0 ? (
              <p role="status">
                Para remover uma etapa padrão, crie primeiro uma etapa personalizada.
                Ela receberá os leads e o comportamento automático desta etapa.
              </p>
            ) : null}
            <footer>
              <button type="button" onClick={() => setRemovingId(null)}>Cancelar</button>
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
                Remover etapa
              </button>
            </footer>
          </section>
        ) : null}

        {error ? <p className="crm-stage-error" role="alert">{error}</p> : null}
      </div>
    </OverlaySurface>
  );
}
