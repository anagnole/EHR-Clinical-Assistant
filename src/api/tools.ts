/**
 * EHR tool definitions and executors for non-Claude models.
 * These mirror the MCP tools but execute directly against the local Kuzu database.
 */

import { getConnection, withLock } from "./kuzu-client.js";

// ─── Tool definitions (OpenAI function-calling format, used by Ollama) ───────

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_patients",
      description: "Search for patients by name or city",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text (patient name, city, etc.)" },
          limit: { type: "number", description: "Maximum results (default 20, max 50)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_patient_summary",
      description: "Get a full clinical overview of a patient: demographics, conditions, medications, labs, procedures",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "The patient ID to look up" },
        },
        required: ["patient_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_medications",
      description: "Get medications for a patient, optionally filtered by active status or name",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "The patient ID" },
          active: { type: "boolean", description: "If true, only return active medications" },
          name: { type: "string", description: "Filter by medication name (partial match)" },
        },
        required: ["patient_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_diagnoses",
      description: "Get conditions/diagnoses for a patient, optionally filtered by active or resolved status",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "The patient ID" },
          status: { type: "string", enum: ["active", "resolved"], description: "Filter by condition status" },
        },
        required: ["patient_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_labs",
      description: "Get lab results for a patient, optionally filtered by LOINC code or date range",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "The patient ID" },
          code: { type: "string", description: "LOINC code to filter by (e.g., '4548-4' for HbA1c)" },
          start_date: { type: "string", description: "Start date filter (YYYY-MM-DD)" },
          end_date: { type: "string", description: "End date filter (YYYY-MM-DD)" },
        },
        required: ["patient_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_cohort",
      description: "Find patients matching clinical criteria (conditions, medications, age, gender)",
      parameters: {
        type: "object",
        properties: {
          conditions: { type: "array", items: { type: "string" }, description: "Condition descriptions to match (partial match, all must be present)" },
          medications: { type: "array", items: { type: "string" }, description: "Medication descriptions to match (partial match, all must be present)" },
          age_min: { type: "number", description: "Minimum age in years" },
          age_max: { type: "number", description: "Maximum age in years" },
          gender: { type: "string", description: "Gender filter (M or F)" },
        },
      },
    },
  },
];

// ─── Tool executors ──────────────────────────────────────────────────────────

async function q(cypher: string): Promise<Record<string, unknown>[]> {
  return withLock(async () => {
    const c = await getConnection();
    const result = await c.query(cypher);
    return (await result.getAll()) as Record<string, unknown>[];
  });
}

function safe(s: string): string {
  return s.replace(/'/g, "''");
}

type ToolArgs = Record<string, unknown>;

const executors: Record<string, (args: ToolArgs) => Promise<unknown>> = {
  async search_patients(args) {
    const query = safe(String(args.query ?? ""));
    const limit = Math.min(Number(args.limit) || 20, 50);
    const rows = await q(
      `CALL QUERY_FTS_INDEX('Patient', 'patient_fts', '${query}')
       RETURN node.patient_id AS id, node.first_name AS first_name,
              node.last_name AS last_name, node.city AS city, score
       ORDER BY score DESC LIMIT ${limit}`,
    );
    return rows.map((r) => ({
      patient_id: r.id,
      name: `${r.first_name} ${r.last_name}`,
      city: r.city,
    }));
  },

  async get_patient_summary(args) {
    const id = safe(String(args.patient_id));

    const [patient] = await q(
      `MATCH (p:Patient {patient_id: '${id}'})
       RETURN p.first_name AS first_name, p.last_name AS last_name,
              p.birth_date AS birth_date, p.death_date AS death_date,
              p.gender AS gender, p.race AS race, p.city AS city, p.state AS state`,
    );
    if (!patient) return { error: `Patient ${id} not found` };

    const conditions = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:DIAGNOSED_WITH]->(c:ConceptCondition)
       RETURN c.description AS description, r.start_date AS start_date, r.stop_date AS stop_date`,
    );

    const medications = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:PRESCRIBED]->(m:ConceptMedication)
       RETURN m.description AS description, r.start_date AS start_date, r.stop_date AS stop_date`,
    );

    const labs = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:HAS_RESULT]->(o:ConceptObservation)
       RETURN o.description AS description, r.value AS value, r.units AS units, r.date AS date
       ORDER BY r.date DESC LIMIT 30`,
    );

    return {
      patient: { patient_id: id, ...patient },
      conditions: conditions.map((r) => ({
        description: r.description,
        start_date: r.start_date,
        stop_date: r.stop_date,
        status: r.stop_date ? "resolved" : "active",
      })),
      medications: medications.map((r) => ({
        description: r.description,
        start_date: r.start_date,
        stop_date: r.stop_date,
        status: r.stop_date ? "stopped" : "active",
      })),
      recent_labs: labs.map((r) => ({
        description: r.description,
        value: r.value,
        units: r.units,
        date: r.date,
      })),
    };
  },

  async get_medications(args) {
    const id = safe(String(args.patient_id));
    let where = "";
    if (args.active) where += " AND (r.stop_date IS NULL OR r.stop_date = '')";
    if (args.name) where += ` AND m.description CONTAINS '${safe(String(args.name))}'`;

    const rows = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:PRESCRIBED]->(m:ConceptMedication)
       WHERE true${where}
       RETURN m.description AS description, m.code AS code,
              r.start_date AS start_date, r.stop_date AS stop_date`,
    );
    return rows;
  },

  async get_diagnoses(args) {
    const id = safe(String(args.patient_id));
    let where = "";
    if (args.status === "active") where += " AND (r.stop_date IS NULL OR r.stop_date = '')";
    if (args.status === "resolved") where += " AND r.stop_date IS NOT NULL AND r.stop_date <> ''";

    const rows = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:DIAGNOSED_WITH]->(c:ConceptCondition)
       WHERE true${where}
       RETURN c.description AS description, c.code AS code,
              r.start_date AS start_date, r.stop_date AS stop_date`,
    );
    return rows;
  },

  async get_labs(args) {
    const id = safe(String(args.patient_id));
    let where = "";
    if (args.code) where += ` AND o.code = '${safe(String(args.code))}'`;
    if (args.start_date) where += ` AND r.date >= '${safe(String(args.start_date))}'`;
    if (args.end_date) where += ` AND r.date <= '${safe(String(args.end_date))}'`;

    const rows = await q(
      `MATCH (p:Patient {patient_id: '${id}'})-[r:HAS_RESULT]->(o:ConceptObservation)
       WHERE true${where}
       RETURN o.description AS description, o.code AS code,
              r.value AS value, r.units AS units, r.date AS date
       ORDER BY r.date DESC LIMIT 50`,
    );
    return rows;
  },

  async find_cohort(args) {
    const matchClauses = ["MATCH (p:Patient)"];
    const whereClauses: string[] = [];

    const conditions = (args.conditions as string[]) ?? [];
    conditions.forEach((cond, i) => {
      matchClauses.push(`MATCH (p)-[:DIAGNOSED_WITH]->(c${i}:ConceptCondition)`);
      whereClauses.push(`c${i}.description CONTAINS '${safe(cond)}'`);
    });

    const medications = (args.medications as string[]) ?? [];
    medications.forEach((med, i) => {
      matchClauses.push(`MATCH (p)-[:PRESCRIBED]->(m${i}:ConceptMedication)`);
      whereClauses.push(`m${i}.description CONTAINS '${safe(med)}'`);
    });

    if (args.gender) whereClauses.push(`p.gender = '${safe(String(args.gender))}'`);
    if (args.age_min != null) {
      const maxBirth = new Date();
      maxBirth.setFullYear(maxBirth.getFullYear() - Number(args.age_min));
      whereClauses.push(`p.birth_date <= '${maxBirth.toISOString().slice(0, 10)}'`);
    }
    if (args.age_max != null) {
      const minBirth = new Date();
      minBirth.setFullYear(minBirth.getFullYear() - Number(args.age_max));
      whereClauses.push(`p.birth_date >= '${minBirth.toISOString().slice(0, 10)}'`);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const cypher = `${matchClauses.join("\n")}
      ${whereStr}
      RETURN DISTINCT p.patient_id AS patient_id, p.first_name AS first_name,
             p.last_name AS last_name, p.birth_date AS birth_date, p.gender AS gender
      LIMIT 100`;

    const rows = await q(cypher);
    return {
      count: rows.length,
      patients: rows.map((r) => ({
        patient_id: r.patient_id,
        name: `${r.first_name} ${r.last_name}`,
        birth_date: r.birth_date,
        gender: r.gender,
      })),
    };
  },
};

export async function executeTool(name: string, args: ToolArgs): Promise<unknown> {
  const fn = executors[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return await fn(args);
  } catch (err) {
    return { error: `Tool ${name} failed: ${(err as Error).message}` };
  }
}
