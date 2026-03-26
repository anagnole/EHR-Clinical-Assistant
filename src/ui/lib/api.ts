import type { Subgraph, SearchResult } from "../../api/types.js";

const BASE = "/api";

export async function fetchNeighborhood(
  id: string,
  type = "Patient",
  maxNodes = 30,
  dateFrom?: string,
  dateTo?: string,
): Promise<Subgraph> {
  const params = new URLSearchParams({ id, type, maxNodes: String(maxNodes) });
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  const res = await fetch(`${BASE}/graph/neighborhood?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch neighborhood: ${res.status}`);
  return res.json();
}

export async function searchGraphNodes(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${BASE}/graph/search?${params}`);
  if (!res.ok) throw new Error(`Failed to search: ${res.status}`);
  return res.json();
}

export interface ModelInfo {
  id: string;
  display_name: string;
  provider: string;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = await res.json();
  return data.models;
}

export async function fetchNodeCard(
  id: string,
  type: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ id, type });
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  const res = await fetch(`${BASE}/graph/card?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch card: ${res.status}`);
  return res.json();
}
