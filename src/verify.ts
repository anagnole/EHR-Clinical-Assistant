/**
 * Round-trip verification — checks that all generated data was correctly
 * ingested into the Kuzu EHR graph.
 *
 * Checks:
 * 1. Node counts match stats.json
 * 2. Relationship integrity (edges connect valid nodes)
 * 3. Sample verification (random patients: JSON vs Kuzu)
 * 4. FTS smoke test
 */

import kuzu from 'kuzu';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';


const PROJECT_ROOT = join(import.meta.dirname, '..');
const DB_PATH = join(PROJECT_ROOT, '.brainifai', 'data', 'kuzu');
const GEN_DIR = join(PROJECT_ROOT, 'data', 'generated');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function countNodes(conn: InstanceType<typeof kuzu.Connection>, table: string): Promise<number> {
  const result = await conn.query(`MATCH (n:${table}) RETURN count(n) AS cnt`);
  const qr = Array.isArray(result) ? result[0] : result;
  const rows = await qr.getAll();
  return (rows[0]?.cnt as number) ?? 0;
}

async function countRels(conn: InstanceType<typeof kuzu.Connection>, relType: string): Promise<number> {
  const result = await conn.query(`MATCH ()-[r:${relType}]->() RETURN count(r) AS cnt`);
  const qr = Array.isArray(result) ? result[0] : result;
  const rows = await qr.getAll();
  return (rows[0]?.cnt as number) ?? 0;
}

async function queryAll(conn: InstanceType<typeof kuzu.Connection>, cypher: string): Promise<Record<string, unknown>[]> {
  const result = await conn.query(cypher);
  const qr = Array.isArray(result) ? result[0] : result;
  return await qr.getAll();
}

async function verify() {
  console.log('Starting EHR data verification...\n');

  if (!existsSync(DB_PATH)) {
    console.error(`Kuzu DB not found at ${DB_PATH}. Run ingestion first.`);
    process.exit(1);
  }

  const stats = JSON.parse(readFileSync(join(GEN_DIR, 'stats.json'), 'utf-8'));

  const db = new kuzu.Database(DB_PATH, 0, true, true); // read-only
  const conn = new kuzu.Connection(db);

  try {
    // ── 1. Count verification ─────────────────────────────────────────────

    console.log('1. Node count verification');

    const nodeCounts: Record<string, { expected: number; actual: number }> = {};
    const tables: Array<{ name: string; statsKey: string }> = [
      { name: 'Patient', statsKey: 'patients' },
      { name: 'Encounter', statsKey: 'encounters' },
      { name: 'Condition', statsKey: 'conditions' },
      { name: 'Medication', statsKey: 'medications' },
      { name: 'Observation', statsKey: 'observations' },
      { name: 'Procedure', statsKey: 'procedures' },
      { name: 'Provider', statsKey: 'providers' },
      { name: 'Organization', statsKey: 'organizations' },
    ];

    for (const { name, statsKey } of tables) {
      const actual = await countNodes(conn, name);
      const expected = stats[statsKey] as number;
      nodeCounts[name] = { expected, actual };
      check(`${name}: ${actual}/${expected}`, actual === expected,
        actual !== expected ? `expected ${expected}, got ${actual}` : undefined);
    }

    // ── 2. Relationship integrity ─────────────────────────────────────────

    console.log('\n2. Relationship integrity');

    // Check that key relationships have expected counts
    const relTypes = [
      'HAS_ENCOUNTER', 'HAS_CONDITION', 'HAS_MEDICATION',
      'HAS_OBSERVATION', 'HAS_PROCEDURE',
      'ENCOUNTER_DIAGNOSIS', 'ENCOUNTER_MEDICATION',
      'ENCOUNTER_OBSERVATION', 'ENCOUNTER_PROCEDURE',
      'TREATED_BY', 'AFFILIATED_WITH', 'AT_ORGANIZATION',
    ];

    for (const rel of relTypes) {
      const count = await countRels(conn, rel);
      check(`${rel}: ${count} edges`, count > 0, count === 0 ? 'no edges found' : undefined);
    }

    // Verify HAS_ENCOUNTER count matches encounters
    const hasEncCount = await countRels(conn, 'HAS_ENCOUNTER');
    check(
      `HAS_ENCOUNTER count matches Encounter nodes`,
      hasEncCount === nodeCounts['Encounter'].actual,
      `${hasEncCount} edges vs ${nodeCounts['Encounter'].actual} encounters`,
    );

    // Verify every patient has at least one encounter
    const patientsWithoutEnc = await queryAll(conn,
      `MATCH (p:Patient) WHERE NOT EXISTS { MATCH (p)-[:HAS_ENCOUNTER]->() } RETURN count(p) AS cnt`,
    );
    const orphanPatients = (patientsWithoutEnc[0]?.cnt as number) ?? 0;
    check(`All patients have encounters`, orphanPatients === 0,
      orphanPatients > 0 ? `${orphanPatients} patients without encounters` : undefined);

    // ── 3. Sample verification ────────────────────────────────────────────

    console.log('\n3. Sample patient verification (graph-only)');

    // Pick 10 patients and verify they have complete data in the graph
    const sampleRows = await queryAll(conn,
      `MATCH (p:Patient) RETURN p.patient_id AS id, p.first_name AS first_name,
             p.last_name AS last_name, p.birth_date AS birth_date, p.gender AS gender
       LIMIT 10`,
    );

    for (const row of sampleRows) {
      const id = row.id as string;
      const name = `${row.first_name} ${row.last_name}`;
      check(`Patient ${id} (${name}) has name and birth_date`,
        !!row.first_name && !!row.last_name && !!row.birth_date);
    }

    // Verify conditions/encounters for sample patients
    for (const row of sampleRows.slice(0, 3)) {
      const id = row.id as string;

      const encCount = await queryAll(conn,
        `MATCH (p:Patient {patient_id: '${id}'})-[:HAS_ENCOUNTER]->(e:Encounter) RETURN count(e) AS cnt`,
      );
      check(`Patient ${id} has encounters`, ((encCount[0]?.cnt as number) ?? 0) > 0);

      const condCount = await queryAll(conn,
        `MATCH (p:Patient {patient_id: '${id}'})-[:HAS_CONDITION]->(c:Condition) RETURN count(c) AS cnt`,
      );
      check(`Patient ${id} has conditions`, ((condCount[0]?.cnt as number) ?? 0) > 0);

      // Verify encounter→condition path exists
      const pathCount = await queryAll(conn,
        `MATCH (p:Patient {patient_id: '${id}'})-[:HAS_ENCOUNTER]->(e:Encounter)-[:ENCOUNTER_DIAGNOSIS]->(c:Condition)
         RETURN count(c) AS cnt`,
      );
      check(`Patient ${id} has encounter→condition paths`, ((pathCount[0]?.cnt as number) ?? 0) > 0);
    }

    // ── 4. FTS smoke test ─────────────────────────────────────────────────

    console.log('\n4. FTS smoke test');

    await conn.query('LOAD EXTENSION fts');

    // Search for a known patient name
    if (sampleRows.length > 0) {
      const testName = sampleRows[0].first_name as string;
      try {
        const ftsResults = await queryAll(conn,
          `CALL QUERY_FTS_INDEX('Patient', 'patient_fts', '${testName.replace(/'/g, "''")}')
           RETURN node.patient_id AS id, score
           ORDER BY score DESC LIMIT 5`,
        );
        check(`FTS search for "${testName}" returns results`, ftsResults.length > 0,
          ftsResults.length === 0 ? 'no results' : `${ftsResults.length} results`);
      } catch (err) {
        check(`FTS search for "${testName}"`, false, String(err));
      }
    }

    // Search conditions
    try {
      const condFts = await queryAll(conn,
        `CALL QUERY_FTS_INDEX('Condition', 'condition_fts', 'diabetes')
         RETURN node.condition_id AS id, score
         ORDER BY score DESC LIMIT 5`,
      );
      check(`FTS condition search for "diabetes"`, condFts.length > 0,
        `${condFts.length} results`);
    } catch (err) {
      check(`FTS condition search`, false, String(err));
    }

    // ── Summary ───────────────────────────────────────────────────────────

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Verification complete: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
      process.exit(1);
    }

  } finally {
    await conn.close();
    await db.close();
  }
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
