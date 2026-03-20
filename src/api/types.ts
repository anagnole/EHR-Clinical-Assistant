export interface SubgraphNode {
  id: string;
  type: string;
  label: string;
  props?: Record<string, unknown>;
}

export interface SubgraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface Subgraph {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
}

export interface SearchResult {
  id: string;
  type: string;
  label: string;
  score?: number;
}

// WebSocket protocol
export type WsClientMessage = {
  type: "user_message";
  content: string;
};

export type WsServerMessage =
  | { type: "text_delta"; text: string }
  | { type: "status"; status: "ready" | "thinking" | "error" }
  | { type: "error"; message: string }
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; data: unknown };
