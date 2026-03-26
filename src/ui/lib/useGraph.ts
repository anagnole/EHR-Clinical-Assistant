import { useState, useCallback, useRef } from "react";
import Graph from "graphology";
import {
  mergeSubgraph,
  updateNodeSizes,
  runLayout,
} from "./graph-builder.js";
import { fetchNeighborhood } from "./api.js";
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
    async (tool: string, input: Record<string, unknown>) => {
      // Strip MCP server prefix (e.g., "mcp__thesis-ehr__find_cohort" → "find_cohort")
      const toolName = tool.replace(/^mcp__[^_]+__/, "");
      // Skip internal tools (ToolSearch, etc.)
      if (tool === toolName && tool !== "find_cohort") return;
      console.log("[graph] tool event:", toolName, input);
      const patientId = input.patient_id as string | undefined;

      switch (toolName) {
        case "get_patient_summary":
        case "get_medications":
        case "get_diagnoses":
        case "get_labs": {
          // Expand the patient node with their full neighborhood
          if (patientId) {
            const subgraph = await fetchNeighborhood(patientId, "Patient");
            addSubgraph(subgraph);
            setSelectedNode(patientId);
          }
          break;
        }

        case "find_cohort": {
          // Expand based on conditions searched — find the concept nodes
          const conditions = input.conditions as string[] | undefined;
          if (conditions && conditions.length > 0) {
            // Search for the first condition concept and expand it
            try {
              const { searchGraphNodes } = await import("./api.js");
              const results = await searchGraphNodes(conditions[0], 1);
              if (results.length > 0) {
                const subgraph = await fetchNeighborhood(results[0].id, results[0].type);
                addSubgraph(subgraph);
                setSelectedNode(results[0].id);
              }
            } catch { /* ignore */ }
          }
          break;
        }

        case "search_patients": {
          // Search and expand the first result
          const query = input.query as string | undefined;
          if (query) {
            try {
              const { searchGraphNodes } = await import("./api.js");
              const results = await searchGraphNodes(query, 1);
              if (results.length > 0) {
                const subgraph = await fetchNeighborhood(results[0].id, results[0].type);
                addSubgraph(subgraph);
                setSelectedNode(results[0].id);
              }
            } catch { /* ignore */ }
          }
          break;
        }

        case "get_temporal_relation": {
          if (patientId) {
            const subgraph = await fetchNeighborhood(patientId, "Patient");
            addSubgraph(subgraph);
            setSelectedNode(patientId);
          }
          break;
        }
      }
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
