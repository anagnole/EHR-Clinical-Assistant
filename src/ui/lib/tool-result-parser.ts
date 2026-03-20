import type { Subgraph, SubgraphNode, SubgraphEdge } from "../../api/types.js";

/**
 * Converts an MCP tool_use event into graph nodes/edges.
 * Since we get tool name + input (not the result data), we create
 * placeholder nodes based on what the tool was querying.
 */
export function parseToolUse(
  tool: string,
  input: Record<string, unknown>,
): Subgraph | null {
  const nodes: SubgraphNode[] = [];
  const edges: SubgraphEdge[] = [];

  const patientId = input.patient_id as string | undefined;

  switch (tool) {
    case "get_patient_summary":
    case "get_medications":
    case "get_diagnoses":
    case "get_labs":
    case "get_temporal_relation": {
      if (patientId) {
        nodes.push({
          id: patientId,
          type: "Patient",
          label: `Patient ${patientId.slice(0, 8)}...`,
        });
      }
      break;
    }

    case "search_patients": {
      // We don't know results yet, nothing to add
      break;
    }

    case "find_cohort": {
      // We don't know results yet, nothing to add
      break;
    }
  }

  if (nodes.length === 0) return null;
  return { nodes, edges };
}
