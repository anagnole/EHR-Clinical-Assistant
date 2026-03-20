import type { Subgraph, SearchResult } from "../../api/types.js";

const BASE = "/api";

export async function fetchNeighborhood(
  id: string,
  type = "Patient",
  maxNodes = 30,
): Promise<Subgraph> {
  const params = new URLSearchParams({ id, type, maxNodes: String(maxNodes) });
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
