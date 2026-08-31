"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Field";
import { RANKS } from "@/lib/ranks";
import { NODE_WIDTH } from "@/lib/hierarchy-layout";
import { useI18n } from "@/components/i18n/LanguageProvider";

export type AgentNodeData = {
  name: string;
  rank: string;
  parentName: string | null;
  currentParentAgentId: string | null;
  dragState: "idle" | "valid-target" | "invalid-target";
  editing: boolean;
  parentOptions: { id: string; name: string }[];
  onToggleEdit: () => void;
  onSave: (parentAgentId: string | null, rank: string) => Promise<void>;
};

export type AgentFlowNode = Node<AgentNodeData, "agent">;

export function AgentNode({ data }: NodeProps<AgentFlowNode>) {
  const { copy } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setMessage(null);
    const parentAgentId = (formData.get("parentAgentId") as string) || null;
    const rank = formData.get("rank") as string;
    try {
      await data.onSave(parentAgentId, rank);
      setMessage({ ok: true, text: copy("Salvo.", "Saved.") });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : copy("Erro ao salvar.", "We couldn't save your changes."),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
      <div
        className={`group flex cursor-grab items-center gap-3 rounded-lg border bg-paper px-4 py-3 shadow-[var(--shadow-overlay)] transition-[border-color,box-shadow] duration-150 active:cursor-grabbing ${
          data.dragState === "valid-target"
            ? "border-teal ring-2 ring-teal-pale"
            : data.dragState === "invalid-target"
              ? "border-danger ring-2 ring-danger-pale"
              : "border-border-steel hover:border-teal"
        }`}
      >
        <Avatar name={data.name} rank={data.rank} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{data.name}</p>
          <p className="truncate text-xs text-ink-muted">
            {data.parentName
              ? copy(`Reporta para ${data.parentName}`, `Reports to ${data.parentName}`)
              : copy("Topo da hierarquia", "Top of hierarchy")}
          </p>
        </div>
        <button
          type="button"
          onClick={data.onToggleEdit}
          className="nodrag shrink-0 text-xs font-semibold text-teal opacity-100 transition-opacity duration-150 hover:text-teal-deep sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
        >
          {data.editing ? copy("Fechar", "Close") : copy("Editar", "Edit")}
        </button>
      </div>

      {data.editing && (
        <div className="nodrag absolute left-0 top-full z-10 mt-2 w-full rounded-lg border border-border-steel bg-paper p-3 shadow-[var(--shadow-overlay)]">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-panel px-2 py-[3px] text-[11px] font-semibold text-ink-muted">{data.rank}</span>
          </div>
          <form action={handleSubmit} className="flex flex-col gap-2">
            <Select name="parentAgentId" defaultValue={data.currentParentAgentId ?? ""} aria-label={copy('Gerente', 'Manager')}>
              <option value="">{copy('— nenhum —', '— none —')}</option>
              {data.parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select name="rank" defaultValue={data.rank} aria-label={copy('Cargo', 'Rank')}>
              {!RANKS.includes(data.rank as (typeof RANKS)[number]) && <option value={data.rank}>{data.rank}</option>}
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md border border-border-steel bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:border-teal disabled:opacity-50"
            >
              {submitting ? copy("Salvando…", "Saving…") : copy("Salvar", "Save")}
            </button>
            {message && (
              <span role="alert" className={`text-xs ${message.ok ? "text-success" : "text-danger"}`}>
                {message.text}
              </span>
            )}
          </form>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
    </div>
  );
}

export type RootZoneData = { active: boolean };
export type RootZoneFlowNode = Node<RootZoneData, "rootzone">;

export function RootZoneNode({ data }: NodeProps<RootZoneFlowNode>) {
  const { copy } = useI18n();
  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={`flex min-h-[52px] items-center justify-center rounded-lg border border-dashed px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide transition-colors duration-150 ${
        data.active ? "border-teal bg-teal-pale text-teal" : "border-border-steel text-ink-muted"
      }`}
    >
      {copy('Solte aqui para remover o gerente', 'Drop here to remove the manager')}
    </div>
  );
}
