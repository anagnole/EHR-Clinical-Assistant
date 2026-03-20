import kuzu from "kuzu";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Subgraph, SubgraphNode, SubgraphEdge, SearchResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../.brainifai/data/kuzu");

let db: kuzu.Database | null = null;
let conn: kuzu.Connection | null = null;

// Primary key per node type
const PK: Record<string, string> = {
  Patient: "patient_id",
  Encounter: "encounter_id",
  ConceptCondition: "code",
  ConceptMedication: "code",
  ConceptObservation: "code",
  ConceptProcedure: "code",
  Provider: "provider_id",
  Organization: "organization_id",
};

export async function getConnection(): Promise<kuzu.Connection> {
  if (conn) return conn;
  db = new kuzu.Database(DB_PATH, 0, true, true);
  conn = new kuzu.Connection(db);
  await conn.query("LOAD EXTENSION fts");
  return conn;
}

export async function closeConnection(): Promise<void> {
  conn = null;
  if (db) {
    await db.close();
    db = null;
  }
}

async function q(c: kuzu.Connection, cypher: string): Promise<Record<string, unknown>[]> {
  const result = await c.query(cypher);
  return await result.getAll() as Record<string, unknown>[];
}

function nodeLabel(type: string, row: Record<string, unknown>): string {
  switch (type) {
    case "Patient":
      return `${row.fn ?? row.first_name ?? ""} ${row.ln ?? row.last_name ?? ""}`.trim() || String(row.patient_id ?? "");
    case "Provider":
      return String(row.mname ?? row.name ?? row.provider_id ?? "");
    case "Organization":
      return String(row.mname ?? row.name ?? row.organization_id ?? "");
    default:
      // Concept nodes and encounters
      return String(row.mdescription ?? row.description ?? row.code ?? "");
  }
}

export async function neighborhoodQuery(
  nodeId: string,
  nodeType: string,
  maxNodes = 30,
): Promise<Subgraph> {
  const c = await getConnection();
  const nodes: SubgraphNode[] = [];
  const edges: SubgraphEdge[] = [];
  const seen = new Set<string>();
  const safeId = nodeId.replace(/'/g, "''");
  const pk = PK[nodeType] ?? "code";

  // Get center node label
  let centerLabel = nodeId;
  if (nodeType === "Patient") {
    const rows = await q(c, `MATCH (n:Patient {patient_id: '${safeId}'}) RETURN n.first_name AS fn, n.last_name AS ln`);
    if (rows.length > 0) centerLabel = `${rows[0].fn} ${rows[0].ln}`;
  } else {
    const labelCol = nodeType === "Provider" || nodeType === "Organization" ? "name" : "description";
    const rows = await q(c, `MATCH (n:${nodeType} {${pk}: '${safeId}'}) RETURN n.${labelCol} AS lbl`);
    if (rows.length > 0) centerLabel = rows[0].lbl as string ?? nodeId;
  }

  nodes.push({ id: nodeId, type: nodeType, label: centerLabel });
  seen.add(nodeId);

  // Get 1-hop neighbors — balanced across relationship types
  // Query each relationship type separately with a per-type limit to avoid one type dominating
  const relTypes = nodeType === "Patient"
    ? ["DIAGNOSED_WITH", "PRESCRIBED", "HAS_RESULT", "UNDERWENT", "HAD_ENCOUNTER"]
    : nodeType === "Encounter"
    ? ["TREATED_BY", "AT_ORGANIZATION", "REASON_FOR"]
    : nodeType === "Organization"
    ? ["AFFILIATED_WITH"] // Only show providers, not 1000s of encounters
    : nodeType === "Provider"
    ? ["AFFILIATED_WITH"]
    : null; // For concept nodes, just get all neighbors

  let neighborRows: Record<string, unknown>[];
  if (relTypes) {
    const perType = Math.max(3, Math.floor(maxNodes / relTypes.length));
    const allRows: Record<string, unknown>[] = [];
    for (const rel of relTypes) {
      const rows = await q(c,
        `MATCH (n:${nodeType} {${pk}: '${safeId}'})-[r:${rel}]-(m)
         RETURN label(m) AS mtype, label(r) AS rtype,
                m.description AS mdescription, m.name AS mname,
                m.first_name AS fn, m.last_name AS ln, m.code AS mcode,
                m.patient_id AS m_patient_id, m.encounter_id AS m_encounter_id,
                m.provider_id AS m_provider_id, m.organization_id AS m_organization_id
         LIMIT ${perType}`);
      allRows.push(...rows);
    }
    neighborRows = allRows;
  } else {
    neighborRows = await q(c,
      `MATCH (n:${nodeType} {${pk}: '${safeId}'})-[r]-(m)
       RETURN label(m) AS mtype, label(r) AS rtype,
              m.description AS mdescription, m.name AS mname,
              m.first_name AS fn, m.last_name AS ln, m.code AS mcode,
              m.patient_id AS m_patient_id, m.encounter_id AS m_encounter_id,
              m.provider_id AS m_provider_id, m.organization_id AS m_organization_id
       LIMIT ${maxNodes}`);
  }

  for (const r of neighborRows) {
    const mtype = r.mtype as string;
    const rtype = r.rtype as string;

    // Determine the neighbor's ID from its primary key
    const neighborPk = PK[mtype];
    let mid: string | null = null;
    if (neighborPk === "code") mid = r.mcode as string;
    else if (neighborPk === "patient_id") mid = r.m_patient_id as string;
    else if (neighborPk === "encounter_id") mid = r.m_encounter_id as string;
    else if (neighborPk === "provider_id") mid = r.m_provider_id as string;
    else if (neighborPk === "organization_id") mid = r.m_organization_id as string;
    if (!mid) continue;

    // Build label
    let label: string;
    if (r.fn && r.ln) label = `${r.fn} ${r.ln}`;
    else label = (r.mdescription as string) ?? (r.mname as string) ?? mid;

    if (!seen.has(mid)) {
      nodes.push({ id: mid, type: mtype, label });
      seen.add(mid);
    }
    edges.push({ source: nodeId, target: mid, type: rtype });
  }

  return { nodes, edges };
}

export async function searchNodes(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const c = await getConnection();
  const results: SearchResult[] = [];
  const safeQ = query.trim().replace(/'/g, "''");
  if (!safeQ) return results;

  // Search patients
  try {
    const rows = await q(c,
      `CALL QUERY_FTS_INDEX('Patient', 'patient_fts', '${safeQ}')
       RETURN node.patient_id AS id, node.first_name AS fn, node.last_name AS ln, score
       ORDER BY score DESC LIMIT ${limit}`);
    for (const r of rows) {
      results.push({ id: r.id as string, type: "Patient", label: `${r.fn} ${r.ln}`, score: r.score as number });
    }
  } catch (e) { console.error("[graph search] patient FTS error:", e); }

  // Search concept conditions — naturally deduplicated (289 nodes)
  try {
    const rows = await q(c,
      `CALL QUERY_FTS_INDEX('ConceptCondition', 'condition_fts', '${safeQ}')
       RETURN node.code AS id, node.description AS description, score
       ORDER BY score DESC LIMIT ${limit}`);
    for (const r of rows) {
      results.push({ id: r.id as string, type: "ConceptCondition", label: r.description as string, score: r.score as number });
    }
  } catch (e) { console.error("[graph search] condition FTS error:", e); }

  // Search concept medications
  try {
    const rows = await q(c,
      `CALL QUERY_FTS_INDEX('ConceptMedication', 'medication_fts', '${safeQ}')
       RETURN node.code AS id, node.description AS description, score
       ORDER BY score DESC LIMIT ${limit}`);
    for (const r of rows) {
      results.push({ id: r.id as string, type: "ConceptMedication", label: r.description as string, score: r.score as number });
    }
  } catch (e) { console.error("[graph search] medication FTS error:", e); }

  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return results.slice(0, limit);
}
