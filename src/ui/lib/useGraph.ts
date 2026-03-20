import { useState, useCallback, useRef } from "react";
import Graph from "graphology";
import {
  mergeSubgraph,
  updateNodeSizes,
  runLayout,
} from "./graph-builder.js";
import { fetchNeighborhood } from "./api.js";
import { parseToolUse } from "./tool-result-parser.js";
import type { Subgraph } from "../../api/types.js";

interface UseGraphReturn {
  graph: Graph;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;
  expandNode: (id: string, type: string) => Promise<void>;
  addFromToolEvent: (tool: string, input: Record<string, unknown>) => void;
  addSubgraph: (subgraph: Subgraph) => void;
}

export function useGraph(): UseGraphReturn {
  const graphRef = useRef<Graph>(new Graph());
  const [, forceUpdate] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const graph = graphRef.current;

  const triggerUpdate = useCallback(() => {
    forceUpdate((n) => n + 1);
  }, []);

  const addSubgraph = useCallback(
    (subgraph: Subgraph) => {
      mergeSubgraph(graph, subgraph);
      updateNodeSizes(graph);
      runLayout(graph);
      triggerUpdate();
    },
    [graph, triggerUpdate],
  );

  const expandNode = useCallback(
    async (id: string, type: string) => {
      const subgraph = await fetchNeighborhood(id, type);
      addSubgraph(subgraph);
    },
    [addSubgraph],
  );

  const addFromToolEvent = useCallback(
    (tool: string, input: Record<string, unknown>) => {
      const subgraph = parseToolUse(tool, input);
      if (subgraph) addSubgraph(subgraph);
    },
    [addSubgraph],
  );

  return {
    graph,
    selectedNode,
    setSelectedNode,
    expandNode,
    addFromToolEvent,
    addSubgraph,
  };
}
