/**
 * Baseline verification — compares SQL adapter results against known data
 * and verifies row counts match the Kuzu graph.
 */

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlAdapter } from './adapter.js';
import { SqlFtsAdapter } from './fts-adapter.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const PG_DSN = process.env.PG_DSN ?? 'postgresql://user@localhost:5432/ehrdb';

interface Stats {
  patients: number;
  encounters: number;
  conditions: number;
  medications: number;
  observations: number;
  procedures: number;
  providers: number;
  organizations: number;
}

async function verify() {
  console.log('Starting SQL baseline verification...\n');
  let passed = 0;
  let failed = 0;

  function check(label: string, ok: boolean) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}`);
      failed++;
    }
  }

  const pool = new pg.Pool({ connectionString: PG_DSN });
  const sql = new SqlAdapter(pool);
  const fts = new SqlFtsAdapter(pool);

  try {
    // ── 1. Row counts ──────────────────────────────────────────────────
    console.log('1. Row count verification');
    const stats: Stats = JSON.parse(
      readFileSync(join(PROJECT_ROOT, 'data', 'generated', 'stats.json'), 'utf-8'),
    );

    const tableMap: [string, keyof Stats][] = [
      ['patient', 'patients'], ['encounter', 'encounters'],
      ['condition', 'conditions'], ['medication', 'medications'],
      ['observation', 'observations'], ['procedure_', 'procedures'],
      ['provider', 'providers'], ['organization', 'organizations'],
    ];

    for (const [table, key] of tableMap) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
      check(`${table}: ${rows[0].cnt}/${stats[key]}`, rows[0].cnt === stats[key]);
    }

    // ── 2. SQL adapter queries ────────────────────────────────────────
    console.log('\n2. SQL adapter queries');

    // Pick a sample patient
    const { rows: sampleRows } = await pool.query('SELECT patient_id FROM patient LIMIT 1');
    const sampleId = sampleRows[0].patient_id;

    const summary = await sql.getPatientSummary(sampleId);
    check(`getPatientSummary returns data for ${sampleId}`, summary !== null);
    check('summary has conditions', (summary?.conditions.length ?? 0) > 0);
    check('summary has encounters', (summary?.encounters.length ?? 0) > 0);

    const nullSummary = await sql.getPatientSummary('NONEXISTENT');
    check('getPatientSummary returns null for missing patient', nullSummary === null);

    const conditions = await sql.getPatientConditions(sampleId);
    check('getPatientConditions returns results', conditions.length > 0);

    const activeConditions = await sql.getPatientConditions(sampleId, { status: 'active' });
    const resolvedConditions = await sql.getPatientConditions(sampleId, { status: 'resolved' });
    check('active + resolved <= total conditions', activeConditions.length + resolvedConditions.length <= conditions.length + 1);

    const meds = await sql.getPatientMedications(sampleId);
    check('getPatientMedications returns results', meds.length > 0);

    const labs = await sql.getPatientLabs(sampleId);
    check('getPatientLabs returns results', labs.length > 0);

    const diabetesCohort = await sql.findCohort({ conditions: ['Diabetes'] });
    check('findCohort(Diabetes) returns patients', diabetesCohort.length > 0);

    const maleCohort = await sql.findCohort({ gender: 'M' });
    check('findCohort(gender=M) returns patients', maleCohort.length > 0);

    // ── 3. SQL+FTS adapter queries ────────────────────────────────────
    console.log('\n3. SQL+FTS adapter queries');

    const ftsResults = await fts.searchPatients(summary!.patient.first_name);
    check(`FTS searchPatients("${summary!.patient.first_name}") finds patient`, ftsResults.length > 0);

    const ftsCohort = await fts.findCohort({ conditions: ['Diabetes'] });
    check('FTS findCohort(Diabetes) returns patients', ftsCohort.length > 0);

    // ── 4. Temporal relation ──────────────────────────────────────────
    console.log('\n4. Temporal relation');
    if (conditions.length >= 2) {
      const rel = await sql.getTemporalRelation(sampleId, {
        fromType: 'condition', fromId: conditions[0].condition_id,
        toType: 'condition', toId: conditions[1].condition_id,
      });
      check('getTemporalRelation returns result', rel !== null);
      check('relation is valid', ['before', 'after', 'same_day'].includes(rel?.relation ?? ''));
    }

    const nullRel = await sql.getTemporalRelation(sampleId, {
      fromType: 'condition', fromId: 'NONEXISTENT',
      toType: 'medication', toId: 'NONEXISTENT',
    });
    check('temporal relation returns null for missing entities', nullRel === null);

    // ── Done ──────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Verification complete: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);

  } finally {
    await pool.end();
  }
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
