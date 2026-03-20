import React, { useState, useCallback } from "react";
import Graph from "graphology";
import { SigmaRenderer } from "./SigmaRenderer.js";
import { GraphSearch } from "./GraphSearch.js";
import { GraphLegend } from "./GraphLegend.js";
import { NodeDetail } from "./NodeDetail.js";
import { fetchNeighborhood } from "../lib/api.js";
import type { Subgraph, SearchResult } from "../../api/types.js";

interface Props {
  graph: Graph;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  onExpandNode: (id: string, type: string) => Promise<void>;
  onAddSubgraph: (subgraph: Subgraph) => void;
}

export function GraphPanel({
  graph,
  selectedNode,
  onSelectNode,
  onExpandNode,
  onAddSubgraph,
}: Props) {
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const handleToggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleSearchSelect = async (result: SearchResult) => {
    const subgraph = await fetchNeighborhood(result.id, result.type);
    onAddSubgraph(subgraph);
    onSelectNode(result.id);
  };

  const handleClickNode = (id: string) => {
    onSelectNode(id || null);
  };

  return (
    <div className="graph-panel">
      <div className="graph-header">
        <h2>Knowledge Graph</h2>
        <GraphSearch onSelect={handleSearchSelect} />
      </div>

      <div className="graph-canvas-container">
        {graph.order > 0 ? (
          <SigmaRenderer
            graph={graph}
            selectedNode={selectedNode}
            hiddenTypes={hiddenTypes}
            onClickNode={handleClickNode}
          />
        ) : (
          <div className="graph-empty">
            Graph will populate as you ask questions.
          </div>
        )}
      </div>

      <GraphLegend hiddenTypes={hiddenTypes} onToggle={handleToggleType} />

      {selectedNode && graph.hasNode(selectedNode) && (
        <NodeDetail
          graph={graph}
          nodeId={selectedNode}
          onClose={() => onSelectNode(null)}
          onExpand={onExpandNode}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  );
}
