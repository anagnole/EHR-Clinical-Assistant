import React, { useState, useCallback } from "react";
import Graph from "graphology";
import { SigmaRenderer } from "./SigmaRenderer.js";
import { GraphSearch } from "./GraphSearch.js";
import { GraphLegend } from "./GraphLegend.js";
import { NodeDetail } from "./NodeDetail.js";
import { DateFilter } from "./DateFilter.js";
import { fetchNeighborhood } from "../lib/api.js";
import type { Subgraph, SearchResult } from "../../api/types.js";

export interface DateRange {
  from: string;
  to: string;
}

interface Props {
  graph: Graph;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  onExpandNode: (id: string, type: string) => Promise<void>;
  onAddSubgraph: (subgraph: Subgraph) => void;
  onAddContext: (id: string) => void;
}

export function GraphPanel({
  graph,
  selectedNode,
  onSelectNode,
  onExpandNode,
  onAddSubgraph,
  onAddContext,
}: Props) {
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });

  const handleToggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleSearchSelect = async (result: SearchResult) => {
    const subgraph = await fetchNeighborhood(result.id, result.type, 30, dateRange.from || undefined, dateRange.to || undefined);
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

      <div className="graph-toolbar">
        <DateFilter
          from={dateRange.from}
          to={dateRange.to}
          onChange={(from, to) => setDateRange({ from, to })}
          onClear={() => setDateRange({ from: "", to: "" })}
        />
      </div>

      <div className="graph-canvas-container">
        {graph.order > 0 ? (
          <SigmaRenderer
            graph={graph}
            selectedNode={selectedNode}
            hiddenTypes={hiddenTypes}
            dateRange={dateRange}
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
          dateRange={dateRange}
          onClose={() => onSelectNode(null)}
          onExpand={(id, type) => {
            fetchNeighborhood(id, type, 30, dateRange.from || undefined, dateRange.to || undefined)
              .then(onAddSubgraph);
          }}
          onSelectNode={onSelectNode}
          onAddContext={onAddContext}
        />
      )}
    </div>
  );
}
