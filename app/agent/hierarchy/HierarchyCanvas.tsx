"use client";

import { useEffect, useRef } from "react";
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, useNodesState, useEdgesState, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { animate } from "motion";
import { useReducedMotion } from "motion/react";
import { ViewNode, type ViewFlowNode } from "./nodes";
import { layoutHierarchy } from "@/lib/hierarchy-layout";

type Agent = { id: string; name: string; rank: string; parentAgentId: string | null; level: number | null };

const nodeTypes = { view: ViewNode };

function Canvas({ agents, youId }: { agents: Agent[]; youId: string }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [nodes, setNodes, onNodesChange] = useNodesState<ViewFlowNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const committedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodesRef = useRef<ViewFlowNode[]>([]);
  const stopAnimRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Same animated-relayout approach as the admin org chart: positions are
  // tweened through state (not CSS) so edges stay glued to their nodes.
  // Nodes here are freely draggable for the viewer's own exploration —
  // there's no server mutation to react to, so in practice this effect
  // only ever runs once per page load.
  useEffect(() => {
    const { positions, edges: rawEdges } = layoutHierarchy(agents);
    const nextEdges: Edge[] = rawEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      style: { stroke: "var(--color-border-steel)", strokeWidth: 1.5 },
    }));

    const targetNodes: ViewFlowNode[] = agents.map((agent) => ({
      id: agent.id,
      type: "view",
      position: positions.get(agent.id) ?? { x: 0, y: 0 },
      draggable: true,
      data: { name: agent.name, rank: agent.rank, level: agent.level, isYou: agent.id === youId },
    }));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, youId]);

  return (
    <div className="hierarchy-flow module-main-surface module-hierarchy-surface relative h-[70vh] min-h-[480px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.5, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-border-steel)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap position="bottom-left" pannable zoomable nodeStrokeWidth={0} nodeColor="var(--color-border-steel)" maskColor="oklch(0.99 0.004 200 / 0.75)" />
      </ReactFlow>
    </div>
  );
}

export function HierarchyCanvas({ agents, youId }: { agents: Agent[]; youId: string }) {
  return (
    <ReactFlowProvider>
      <Canvas agents={agents} youId={youId} />
    </ReactFlowProvider>
  );
}
