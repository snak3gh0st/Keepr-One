"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutHierarchy } from "@/lib/hierarchy-layout";
import { HierarchyOutline } from "./HierarchyOutline";
import { ViewNode, type ViewFlowNode } from "./nodes";
import type { HierarchyViewNode } from "./view-model";

const nodeTypes = { view: ViewNode };

function Canvas({ agents }: { agents: readonly HierarchyViewNode[] }) {
  const { edges, nodes } = useMemo(() => {
    const layoutInput = agents.map((agent) => ({
      id: agent.agentId,
      parentAgentId: agent.parentAgentId,
    }));
    const { positions, edges: rawEdges } = layoutHierarchy(layoutInput);

    const nextEdges: Edge[] = rawEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: false,
      style: { stroke: "var(--color-border-steel)", strokeWidth: 1.5 },
    }));
    const nextNodes: ViewFlowNode[] = agents.map((agent) => ({
      id: agent.agentId,
      type: "view",
      position: positions.get(agent.agentId) ?? { x: 0, y: 0 },
      draggable: false,
      selectable: false,
      focusable: false,
      data: {
        name: agent.name,
        depth: agent.depth,
        kind: agent.kind,
        agencyName: agent.agencyName,
        recruitmentStage: agent.recruitmentStage,
        subscriptionStatus: agent.subscriptionStatus,
      },
    }));

    return { edges: nextEdges, nodes: nextNodes };
  }, [agents]);

  return (
    <div
      className="hierarchy-flow hierarchy-desktop-canvas"
      role="region"
      aria-label="Árvore visual começando em você e seguindo somente para os descendentes"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.45, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.35}
        panOnScroll
        preventScrolling={false}
      >
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function EmptyHierarchy({ name }: { name: string }) {
  return (
    <div className="hierarchy-empty-state">
      <span className="hierarchy-empty-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <h3>Sua estrutura começa em {name}.</h3>
        <p>Ainda não há agentes ou agências abaixo de você.</p>
      </div>
      <Link href="/agent/agency#invite-agent-title">Convidar para a equipe</Link>
    </div>
  );
}

export function HierarchyCanvas({ agents }: { agents: readonly HierarchyViewNode[] }) {
  const rootName = agents[0]?.name ?? "você";
  const hasDescendants = agents.length > 1;

  return (
    <section className="module-main-surface module-hierarchy-surface hierarchy-workspace" aria-labelledby="hierarchy-tree-title">
      <header className="hierarchy-workspace-header">
        <div>
          <h2 id="hierarchy-tree-title">Sua árvore descendente</h2>
          <p>O primeiro nome é o seu. Cada ramo segue somente para quem está abaixo.</p>
        </div>
        <span aria-label={`${Math.max(0, agents.length - 1)} pessoas abaixo de você`}>
          {Math.max(0, agents.length - 1)} abaixo de você
        </span>
      </header>

      {hasDescendants ? (
        <ReactFlowProvider>
          <Canvas agents={agents} />
        </ReactFlowProvider>
      ) : (
        <EmptyHierarchy name={rootName} />
      )}

      {hasDescendants ? <HierarchyOutline nodes={agents} /> : null}
    </section>
  );
}
