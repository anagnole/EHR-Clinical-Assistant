/**
 * Kuzu ingestion pipeline — loads Phase 2 generated data into the EHR graph.
 *
 * Strategy: Streams patients.json (719MB) entry-by-entry via stream-json,
 * writes intermediate CSVs, then bulk loads via COPY FROM.
 *
 * Dependency order:
 * 1. Organizations, Providers (from providers.json — small, fits in memory)
 * 2. Stream patients.json → write CSV files for all 6 patient-related tables
 * 3. COPY FROM all CSVs into Kuzu
 * 4. Create relationships via Cypher joins
 * 5. Rebuild FTS indexes
 */

import kuzu from 'kuzu';
import { createReadStream, readFileSync, writeFileSync, createWriteStream, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parser } = require('stream-json');
const { streamObject } = require('stream-json/streamers/StreamObject');

import type {
  Patient, Encounter, Condition, Medication,
  Observation, Procedure, Provider, Organization,
} from './parser/types.js';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const DB_PATH = join(PROJECT_ROOT, '.brainifai', 'data', 'kuzu');
const GEN_DIR = join(PROJECT_ROOT, 'data', 'generated');
const TMP_DIR = join(PROJECT_ROOT, '.tmp-csv');

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsvLine(headers: string[], row: Record<string, unknown>): string {
  return headers.map((h) => escapeCsv(row[h])).join(',');
}

function mapOne(item: Record<string, unknown>, fieldMap: Record<string, string>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(fieldMap)) {
    row[snake] = item[camel] ?? '';
  }
  return row;
}

function writeCsvFromArray(filePath: string, headers: string[], items: object[], fieldMap: Record<string, string>): void {
  const lines = [headers.join(',')];
  for (const item of items) {
    lines.push(toCsvLine(headers, mapOne(item as Record<string, unknown>, fieldMap)));
  }
  writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

// ─── Field maps (camelCase key → snake_case column) ───────────────────────────

const PATIENT_FIELDS: Record<string, string> = {
  id: 'patient_id', firstName: 'first_name', lastName: 'last_name',
  birthDate: 'birth_date', deathDate: 'death_date', gender: 'gender',
  race: 'race', ethnicity: 'ethnicity', maritalStatus: 'marital_status',
  city: 'city', state: 'state', zip: 'zip',
};

const ENCOUNTER_FIELDS: Record<string, string> = {
  id: 'encounter_id', patientId: 'patient_id', providerId: 'provider_id',
  organizationId: 'organization_id', encounterClass: 'encounter_class',
  code: 'code', description: 'description', startDate: 'start_date',
  stopDate: 'stop_date', reasonCode: 'reason_code', reasonDescription: 'reason_description',
};

const CONDITION_FIELDS: Record<string, string> = {
  id: 'condition_id', patientId: 'patient_id', encounterId: 'encounter_id',
  code: 'code', system: 'system', description: 'description',
  startDate: 'start_date', stopDate: 'stop_date',
};

const MEDICATION_FIELDS: Record<string, string> = {
  id: 'medication_id', patientId: 'patient_id', encounterId: 'encounter_id',
  code: 'code', description: 'description', startDate: 'start_date',
  stopDate: 'stop_date', reasonCode: 'reason_code', reasonDescription: 'reason_description',
};

const OBSERVATION_FIELDS: Record<string, string> = {
  id: 'observation_id', patientId: 'patient_id', encounterId: 'encounter_id',
  category: 'category', code: 'code', description: 'description',
  value: 'value', units: 'units', type: 'type', date: 'date',
};

const PROCEDURE_FIELDS: Record<string, string> = {
  id: 'procedure_id', patientId: 'patient_id', encounterId: 'encounter_id',
  code: 'code', system: 'system', description: 'description',
  startDate: 'start_date', stopDate: 'stop_date',
  reasonCode: 'reason_code', reasonDescription: 'reason_description',
};

const PROVIDER_FIELDS: Record<string, string> = {
  id: 'provider_id', organizationId: 'organization_id',
  name: 'name', gender: 'gender', specialty: 'specialty',
};

const ORGANIZATION_FIELDS: Record<string, string> = {
  id: 'organization_id', name: 'name', city: 'city',
  state: 'state', zip: 'zip', phone: 'phone',
};

// ─── CSV writers (streaming) ──────────────────────────────────────────────────

interface CsvWriter {
  write(row: Record<string, unknown>): void;
  close(): void;
  count: number;
}

function createCsvWriter(filePath: string, headers: string[], fieldMap: Record<string, string>): CsvWriter {
  const fd = createWriteStream(filePath, 'utf-8');
  fd.write(headers.join(',') + '\n');
  let count = 0;
  return {
    write(item: Record<string, unknown>) {
      const row = mapOne(item, fieldMap);
      fd.write(toCsvLine(headers, row) + '\n');
      count++;
    },
    close() { fd.end(); },
    get count() { return count; },
  };
}

// ─── Main ingestion ───────────────────────────────────────────────────────────

async function ingest() {
  console.log('Starting EHR data ingestion...');
  const startTime = Date.now();

  if (!existsSync(DB_PATH)) {
    console.error(`Kuzu DB not found at ${DB_PATH}. Run 'brainifai init --type ehr' first.`);
    process.exit(1);
  }

  mkdirSync(TMP_DIR, { recursive: true });

  const db = new kuzu.Database(DB_PATH);
  const conn = new kuzu.Connection(db);

  try {
    // ── 1. Providers & Organizations (small — fits in memory) ───────────

    console.log('Loading providers.json...');
    // providers.json is { providerId: { provider, organization }, ... }
    const providersRaw: Record<string, { provider: Provider; organization: Organization }> =
      JSON.parse(readFileSync(join(GEN_DIR, 'providers.json'), 'utf-8'));

    const providers: Provider[] = [];
    const orgMap = new Map<string, Organization>();
    for (const entry of Object.values(providersRaw)) {
      providers.push(entry.provider);
      if (!orgMap.has(entry.organization.id)) {
        orgMap.set(entry.organization.id, entry.organization);
      }
    }
    const organizations = [...orgMap.values()];

    const orgFile = join(TMP_DIR, 'organizations.csv');
    writeCsvFromArray(orgFile, Object.values(ORGANIZATION_FIELDS), organizations, ORGANIZATION_FIELDS);
    console.log(`  Organizations: ${organizations.length}`);

    const provFile = join(TMP_DIR, 'providers.csv');
    writeCsvFromArray(provFile, Object.values(PROVIDER_FIELDS), providers, PROVIDER_FIELDS);
    console.log(`  Providers: ${providers.length}`);

    // ── 2. Stream patients.json → CSVs ──────────────────────────────────

    console.log('Streaming patients.json to CSVs...');

    const patWriter = createCsvWriter(join(TMP_DIR, 'patients.csv'), Object.values(PATIENT_FIELDS), PATIENT_FIELDS);
    const encWriter = createCsvWriter(join(TMP_DIR, 'encounters.csv'), Object.values(ENCOUNTER_FIELDS), ENCOUNTER_FIELDS);
    const condWriter = createCsvWriter(join(TMP_DIR, 'conditions.csv'), Object.values(CONDITION_FIELDS), CONDITION_FIELDS);
    const medWriter = createCsvWriter(join(TMP_DIR, 'medications.csv'), Object.values(MEDICATION_FIELDS), MEDICATION_FIELDS);
    const obsWriter = createCsvWriter(join(TMP_DIR, 'observations.csv'), Object.values(OBSERVATION_FIELDS), OBSERVATION_FIELDS);
    const procWriter = createCsvWriter(join(TMP_DIR, 'procedures.csv'), Object.values(PROCEDURE_FIELDS), PROCEDURE_FIELDS);

    // patients.json is { patientId: { patient, encounters, conditions, ... }, ... }
    // streamObject() emits { key: patientId, value: { patient, encounters, ... } }
    let patientCount = 0;
    await pipeline(
      createReadStream(join(GEN_DIR, 'patients.json')),
      parser(),
      streamObject(),
      new Transform({
        objectMode: true,
        transform(chunk: { key: string; value: unknown }, _encoding, callback) {
          const entry = chunk.value as {
            patient: Patient;
            encounters: Encounter[];
            conditions: Condition[];
            medications: Medication[];
            observations: Observation[];
            procedures: Procedure[];
          };

          patWriter.write(entry.patient as unknown as Record<string, unknown>);
          for (const e of entry.encounters) encWriter.write(e as unknown as Record<string, unknown>);
          for (const c of entry.conditions) condWriter.write(c as unknown as Record<string, unknown>);
          for (const m of entry.medications) medWriter.write(m as unknown as Record<string, unknown>);
          for (const o of entry.observations) obsWriter.write(o as unknown as Record<string, unknown>);
          for (const p of entry.procedures) procWriter.write(p as unknown as Record<string, unknown>);

          patientCount++;
          if (patientCount % 500 === 0) {
            process.stdout.write(`\r  Streamed ${patientCount} patients...`);
          }
          callback();
        },
      }),
    );

    console.log(`\r  Streamed ${patientCount} patients total.`);
    console.log(`  Encounters: ${encWriter.count}`);
    console.log(`  Conditions: ${condWriter.count}`);
    console.log(`  Medications: ${medWriter.count}`);
    console.log(`  Observations: ${obsWriter.count}`);
    console.log(`  Procedures: ${procWriter.count}`);

    // Close all CSV writers
    patWriter.close();
    encWriter.close();
    condWriter.close();
    medWriter.close();
    obsWriter.close();
    procWriter.close();

    // Small delay to let file streams flush
    await new Promise((r) => setTimeout(r, 500));

    // ── 3. Bulk load nodes via COPY FROM ────────────────────────────────

    console.log('\nBulk loading nodes via COPY FROM...');
    const csvFiles = [
      { table: 'Organization', file: orgFile },
      { table: 'Provider', file: provFile },
      { table: 'Patient', file: join(TMP_DIR, 'patients.csv') },
      { table: 'Encounter', file: join(TMP_DIR, 'encounters.csv') },
      { table: 'Condition', file: join(TMP_DIR, 'conditions.csv') },
      { table: 'Medication', file: join(TMP_DIR, 'medications.csv') },
      { table: 'Observation', file: join(TMP_DIR, 'observations.csv') },
      { table: 'Procedure', file: join(TMP_DIR, 'procedures.csv') },
    ];

    for (const { table, file } of csvFiles) {
      const t0 = Date.now();
      await conn.query(`COPY ${table} FROM '${file}' (header=true)`);
      console.log(`  ${table}: ${Date.now() - t0}ms`);
    }

    // ── 4. Create relationships ─────────────────────────────────────────

    console.log('\nCreating relationships...');
    const relStart = Date.now();

    const rels: Array<{ name: string; cypher: string }> = [
      { name: 'HAS_ENCOUNTER', cypher: `MATCH (p:Patient), (e:Encounter) WHERE p.patient_id = e.patient_id CREATE (p)-[:HAS_ENCOUNTER]->(e)` },
      { name: 'HAS_CONDITION', cypher: `MATCH (p:Patient), (c:Condition) WHERE p.patient_id = c.patient_id CREATE (p)-[:HAS_CONDITION]->(c)` },
      { name: 'HAS_MEDICATION', cypher: `MATCH (p:Patient), (m:Medication) WHERE p.patient_id = m.patient_id CREATE (p)-[:HAS_MEDICATION]->(m)` },
      { name: 'HAS_OBSERVATION', cypher: `MATCH (p:Patient), (o:Observation) WHERE p.patient_id = o.patient_id CREATE (p)-[:HAS_OBSERVATION]->(o)` },
      { name: 'HAS_PROCEDURE', cypher: `MATCH (p:Patient), (pr:Procedure) WHERE pr.patient_id = p.patient_id CREATE (p)-[:HAS_PROCEDURE]->(pr)` },
      { name: 'ENCOUNTER_DIAGNOSIS', cypher: `MATCH (e:Encounter), (c:Condition) WHERE e.encounter_id = c.encounter_id CREATE (e)-[:ENCOUNTER_DIAGNOSIS]->(c)` },
      { name: 'ENCOUNTER_MEDICATION', cypher: `MATCH (e:Encounter), (m:Medication) WHERE e.encounter_id = m.encounter_id CREATE (e)-[:ENCOUNTER_MEDICATION]->(m)` },
      { name: 'ENCOUNTER_OBSERVATION', cypher: `MATCH (e:Encounter), (o:Observation) WHERE e.encounter_id = o.encounter_id CREATE (e)-[:ENCOUNTER_OBSERVATION]->(o)` },
      { name: 'ENCOUNTER_PROCEDURE', cypher: `MATCH (e:Encounter), (pr:Procedure) WHERE e.encounter_id = pr.encounter_id CREATE (e)-[:ENCOUNTER_PROCEDURE]->(pr)` },
      { name: 'TREATED_BY', cypher: `MATCH (e:Encounter), (prov:Provider) WHERE e.provider_id = prov.provider_id CREATE (e)-[:TREATED_BY]->(prov)` },
      { name: 'PRESCRIBED_BY', cypher: `MATCH (m:Medication)-[:ENCOUNTER_MEDICATION]-(e:Encounter), (prov:Provider) WHERE e.provider_id = prov.provider_id CREATE (m)-[:PRESCRIBED_BY]->(prov)` },
      { name: 'ORDERED_BY', cypher: `MATCH (o:Observation)-[:ENCOUNTER_OBSERVATION]-(e:Encounter), (prov:Provider) WHERE e.provider_id = prov.provider_id CREATE (o)-[:ORDERED_BY]->(prov)` },
      { name: 'AFFILIATED_WITH', cypher: `MATCH (prov:Provider), (org:Organization) WHERE prov.organization_id = org.organization_id CREATE (prov)-[:AFFILIATED_WITH]->(org)` },
      { name: 'AT_ORGANIZATION', cypher: `MATCH (e:Encounter), (org:Organization) WHERE e.organization_id = org.organization_id CREATE (e)-[:AT_ORGANIZATION]->(org)` },
    ];

    for (const { name, cypher } of rels) {
      const t0 = Date.now();
      console.log(`  ${name}...`);
      await conn.query(cypher);
      console.log(`    done in ${Date.now() - t0}ms`);
    }

    console.log(`  All relationships created in ${Date.now() - relStart}ms`);

    // ── 5. Rebuild FTS indexes ──────────────────────────────────────────

    console.log('\nRebuilding FTS indexes...');
    await conn.query('LOAD EXTENSION fts');

    const ftsIndexes = [
      `CALL CREATE_FTS_INDEX('Patient', 'patient_fts', ['first_name', 'last_name', 'city'])`,
      `CALL CREATE_FTS_INDEX('Condition', 'condition_fts', ['description', 'code'])`,
      `CALL CREATE_FTS_INDEX('Medication', 'medication_fts', ['description', 'code'])`,
      `CALL CREATE_FTS_INDEX('Observation', 'observation_fts', ['description', 'code'])`,
      `CALL CREATE_FTS_INDEX('Procedure', 'procedure_fts', ['description', 'code'])`,
      `CALL CREATE_FTS_INDEX('Provider', 'provider_fts', ['name', 'specialty'])`,
      `CALL CREATE_FTS_INDEX('Organization', 'organization_fts', ['name', 'city'])`,
    ];

    for (const stmt of ftsIndexes) {
      try { await conn.query(stmt); } catch { /* may already exist */ }
    }
    console.log('FTS indexes created.');

    // ── Done ────────────────────────────────────────────────────────────

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nIngestion complete in ${elapsed}s.`);

  } finally {
    await conn.close();
    await db.close();

    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true });
      console.log('Cleaned up temporary CSV files.');
    }
  }
}

ingest().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
