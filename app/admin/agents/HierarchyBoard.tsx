"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { animate } from "motion";
import { useReducedMotion } from "motion/react";
import { updateAgentHierarchy } from "./actions";
import { AgentNode, RootZoneNode, type AgentFlowNode, type RootZoneFlowNode } from "./nodes";
import { layoutHierarchy, ROOT_ZONE_ID } from "@/lib/hierarchy-layout";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Agent = { id: string; name: string; rank: string; parentAgentId: string | null };
type FlowNode = AgentFlowNode | RootZoneFlowNode;

const nodeTypes = { agent: AgentNode, rootzone: RootZoneNode };

function isDescendant(agents: Agent[], candidateId: string, ofId: string): boolean {
  const childrenByParent = new Map<string, string[]>();
  for (const a of agents) {
    if (!a.parentAgentId) continue;
    const list = childrenByParent.get(a.parentAgentId) ?? [];
    list.push(a.id);
    childrenByParent.set(a.parentAgentId, list);
  }
  const stack = [...(childrenByParent.get(ofId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === candidateId) return true;
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return false;
}

function HierarchyCanvas({ agents }: { agents: Agent[] }) {
  const { copy } = useI18n();
  const reducedMotion = useReducedMotion() ?? false;
  const rf = useReactFlow<FlowNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const committedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodesRef = useRef<FlowNode[]>([]);
  const stopAnimRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const parentOptions = useMemo(() => agents.map((a) => ({ id: a.id, name: a.name })), [agents]);

  const reassign = useCallback(async (agentId: string, parentAgentId: string | null, rank: string) => {
    const formData = new FormData();
    formData.set("agentId", agentId);
    formData.set("parentAgentId", parentAgentId ?? "");
    formData.set("rank", rank);
    const result = await updateAgentHierarchy(formData);
    if (!result.ok) throw new Error(result.message);
  }, []);

  // Recomputes the tree layout whenever the agent list changes (first load,
  // or once a reassignment revalidates the page with fresh data). Positions
  // are tweened through React state — not CSS — so edges, which are
  // recomputed from node position each render, glide in sync with their
  // nodes instead of snapping to the new shape a frame early or late.
  useEffect(() => {
    const { positions, edges: rawEdges } = layoutHierarchy(agents);
    const nextEdges: Edge[] = rawEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      style: { stroke: "var(--color-border-steel)", strokeWidth: 1.5 },
    }));

    const agentNodes: AgentFlowNode[] = agents.map((agent) => ({
      id: agent.id,
      type: "agent",
      position: positions.get(agent.id) ?? { x: 0, y: 0 },
      draggable: true,
      data: {
        name: agent.name,
        rank: agent.rank,
        parentName: agent.parentAgentId ? (byId.get(agent.parentAgentId)?.name ?? null) : null,
        currentParentAgentId: agent.parentAgentId,
        dragState: "idle",
        editing: false,
        parentOptions: parentOptions.filter((p) => p.id !== agent.id),
        onToggleEdit: () => setEditingId((id) => (id === agent.id ? null : agent.id)),
        onSave: async (parentAgentId: string | null, rank: string) => {
          await reassign(agent.id, parentAgentId, rank);
          setBanner({ ok: true, text: copy(`${agent.name} atualizado.`, `${agent.name} updated.`) });
          setEditingId(null);
        },
      },
    }));
    const rootZoneNode: RootZoneFlowNode = {
      id: ROOT_ZONE_ID,
      type: "rootzone",
      position: positions.get(ROOT_ZONE_ID) ?? { x: 0, y: -140 },
      draggable: false,
      selectable: false,
      data: { active: false },
    };
    const targetNodes: FlowNode[] = [...agentNodes, rootZoneNode];

    stopAnimRef.current?.();
    const prevCommitted = committedRef.current;
    committedRef.current = positions;
    setEdges(nextEdges);

    if (prevCommitted.size === 0 || reducedMotion) {
      setNodes(targetNodes);
      return;
    }

    const fromPositions = new Map(nodesRef.current.map((n) => [n.id, n.position]));
    const controls = animate(0, 1, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t: number) => {
        setNodes(
          targetNodes.map((n) => {
            const from = fromPositions.get(n.id) ?? n.position;
            const to = n.position;
            return { ...n, position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } };
          }),
        );
      },
    });
    stopAnimRef.current = () => controls.stop();
    // Agent data and the active language are the only inputs that should
    // re-trigger a layout pass; translated callbacks must not stay stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, copy]);

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_e, node) => {
    if (node.type !== "agent") return;
    setDraggedId(node.id);
  }, []);

  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback(
    (_e, node) => {
      if (node.type !== "agent") return;
      const candidate = rf.getIntersectingNodes(node, true).find((n) => n.id !== node.id);
      setOverId(candidate ? candidate.id : null);
    },
    [rf],
  );

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    async (_e, node) => {
      if (node.type !== "agent") return;
      const targetId = overId;
      setDraggedId(null);
      setOverId(null);

      const snapBack = () => {
        setNodes((nds) =>
          nds.map((n) => (n.id === node.id ? { ...n, position: committedRef.current.get(node.id) ?? n.position } : n)),
        );
      };

      const agent = byId.get(node.id);
      if (!agent || !targetId || targetId === node.id) {
        snapBack();
        return;
      }
      const newParentId = targetId === ROOT_ZONE_ID ? null : targetId;
      if (newParentId === agent.parentAgentId) {
        snapBack();
        return;
      }
      if (newParentId && isDescendant(agents, newParentId, agent.id)) {
        setBanner({
          ok: false,
          text: copy(
            "Não é possível mover um agente para dentro da própria rede descendente.",
            "An agent cannot be moved into their own downline.",
          ),
        });
        snapBack();
        return;
      }
      try {
        await reassign(agent.id, newParentId, agent.rank);
        setBanner({ ok: true, text: copy(`${agent.name} atualizado.`, `${agent.name} updated.`) });
      } catch (err) {
        setBanner({
          ok: false,
          text: err instanceof Error
            ? err.message
            : copy("Erro ao mover agente.", "We couldn't move the agent."),
        });
        snapBack();
      }
    },
    [overId, byId, agents, reassign, setNodes, copy],
  );

  const displayNodes = useMemo<FlowNode[]>(
    () =>
      nodes.map((n) => {
        if (n.type === "rootzone") {
          return { ...n, data: { ...n.data, active: Boolean(draggedId) && overId === ROOT_ZONE_ID } };
        }
        if (n.type === "agent") {
          let dragState: "idle" | "valid-target" | "invalid-target" = "idle";
          if (draggedId && draggedId !== n.id && overId === n.id) {
            dragState = isDescendant(agents, n.id, draggedId) ? "invalid-target" : "valid-target";
          }
          return { ...n, data: { ...n.data, dragState, editing: editingId === n.id } };
        }
        return n;
      }),
    [nodes, draggedId, overId, editingId, agents],
  );

  return (
    <div>
      {banner && (
        <p
          role="alert"
          className={`mb-3 rounded-md px-3 py-2 text-sm ${banner.ok ? "bg-success-pale text-success" : "bg-danger-pale text-danger"}`}
        >
          {banner.text}
        </p>
      )}
      <div className="hierarchy-flow relative h-[70vh] min-h-[520px] w-full overflow-hidden rounded-lg border border-border-steel bg-panel/40">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.5, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-border-steel)" />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeColor="var(--color-border-steel)"
            maskColor="oklch(0.99 0.004 200 / 0.75)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function HierarchyBoard({ agents }: { agents: Agent[] }) {
  return (
    <ReactFlowProvider>
      <HierarchyCanvas agents={agents} />
    </ReactFlowProvider>
  );
}
