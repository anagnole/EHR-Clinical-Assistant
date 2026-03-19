/**
 * PostgreSQL ingestion — loads Phase 2 generated data into Postgres.
 *
 * Streams patients.json entry-by-entry, batches INSERTs for performance.
 * Providers/organizations loaded first (small, fits in memory).
 */

import pg from 'pg';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createRequire } from 'node:module';
import { createSchema } from './schema.js';
import type {
  Patient, Encounter, Condition, Medication,
  Observation, Procedure, Provider, Organization,
} from '../parser/types.js';

const require = createRequire(import.meta.url);
const { parser } = require('stream-json');
const { streamObject } = require('stream-json/streamers/StreamObject');

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const GEN_DIR = join(PROJECT_ROOT, 'data', 'generated');

const PG_DSN = process.env.PG_DSN ?? 'postgresql://user@localhost:5432/ehrdb';

// ─── Batch inserter ──────────────────────────────────────────────────────────

class BatchInserter {
  private batches = new Map<string, { cols: string[]; rows: unknown[][] }>();
  private pool: pg.Pool;
  private batchSize: number;

  constructor(pool: pg.Pool, batchSize = 1000) {
    this.pool = pool;
    this.batchSize = batchSize;
  }

  add(table: string, cols: string[], values: unknown[]): void {
    let batch = this.batches.get(table);
    if (!batch) {
      batch = { cols, rows: [] };
      this.batches.set(table, batch);
    }
    batch.rows.push(values);
  }

  async flushIfNeeded(table: string, parentTables?: string[]): Promise<number> {
    const batch = this.batches.get(table);
    if (!batch || batch.rows.length < this.batchSize) return 0;
    // Flush parent tables first to satisfy FK constraints
    if (parentTables) {
      for (const pt of parentTables) {
        await this.flush(pt);
      }
    }
    return this.flush(table);
  }

  async flush(table: string): Promise<number> {
    const batch = this.batches.get(table);
    if (!batch || batch.rows.length === 0) return 0;

    const { cols, rows } = batch;
    const placeholders = rows.map((_, i) =>
      `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`
    ).join(',');

    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    const flat = rows.flat();

    await this.pool.query(sql, flat);
    const count = rows.length;
    batch.rows = [];
    return count;
  }

  async flushAll(): Promise<void> {
    for (const table of this.batches.keys()) {
      await this.flush(table);
    }
  }
}

// ─── Main ingestion ──────────────────────────────────────────────────────────

async function ingest() {
  console.log('Starting PostgreSQL data ingestion...');
  const startTime = Date.now();

  const pool = new pg.Pool({ connectionString: PG_DSN });

  try {
    // Drop existing tables and recreate
    console.log('Creating schema (with FTS)...');
    await pool.query(`
      DROP TABLE IF EXISTS procedure_ CASCADE;
      DROP TABLE IF EXISTS observation CASCADE;
      DROP TABLE IF EXISTS medication CASCADE;
      DROP TABLE IF EXISTS condition CASCADE;
      DROP TABLE IF EXISTS encounter CASCADE;
      DROP TABLE IF EXISTS patient CASCADE;
      DROP TABLE IF EXISTS provider CASCADE;
      DROP TABLE IF EXISTS organization CASCADE;
    `);
    await createSchema(pool, true);

    const batch = new BatchInserter(pool, 500);

    // ── 1. Providers & Organizations ─────────────────────────────────────
    console.log('Loading providers.json...');
    const providersRaw: Record<string, { provider: Provider; organization: Organization }> =
      JSON.parse(readFileSync(join(GEN_DIR, 'providers.json'), 'utf-8'));

    const orgSet = new Set<string>();
    for (const entry of Object.values(providersRaw)) {
      const o = entry.organization;
      if (!orgSet.has(o.id)) {
        orgSet.add(o.id);
        batch.add('organization',
          ['organization_id', 'name', 'city', 'state', 'zip', 'phone'],
          [o.id, o.name, o.city, o.state, o.zip, o.phone],
        );
      }
    }
    await batch.flush('organization');
    console.log(`  Organizations: ${orgSet.size}`);

    for (const entry of Object.values(providersRaw)) {
      const p = entry.provider;
      batch.add('provider',
        ['provider_id', 'organization_id', 'name', 'gender', 'specialty'],
        [p.id, p.organizationId, p.name, p.gender, p.specialty],
      );
    }
    await batch.flush('provider');
    console.log(`  Providers: ${Object.keys(providersRaw).length}`);

    // ── 2. Stream patients.json ──────────────────────────────────────────
    console.log('Streaming patients.json...');

    const counts = { patients: 0, encounters: 0, conditions: 0, medications: 0, observations: 0, procedures: 0 };

    await pipeline(
      createReadStream(join(GEN_DIR, 'patients.json')),
      parser(),
      streamObject(),
      new Transform({
        objectMode: true,
        async transform(chunk: { key: string; value: unknown }, _encoding, callback) {
          const entry = chunk.value as {
            patient: Patient; encounters: Encounter[];
            conditions: Condition[]; medications: Medication[];
            observations: Observation[]; procedures: Procedure[];
          };

          const pat = entry.patient;
          batch.add('patient',
            ['patient_id', 'first_name', 'last_name', 'birth_date', 'death_date', 'gender', 'race', 'ethnicity', 'marital_status', 'city', 'state', 'zip'],
            [pat.id, pat.firstName, pat.lastName, pat.birthDate, pat.deathDate || null, pat.gender, pat.race, pat.ethnicity, pat.maritalStatus, pat.city, pat.state, pat.zip],
          );
          await batch.flushIfNeeded('patient');
          counts.patients++;

          for (const e of entry.encounters) {
            batch.add('encounter',
              ['encounter_id', 'patient_id', 'provider_id', 'organization_id', 'encounter_class', 'code', 'description', 'start_date', 'stop_date', 'reason_code', 'reason_description'],
              [e.id, e.patientId, e.providerId || null, e.organizationId || null, e.encounterClass, e.code, e.description, e.startDate, e.stopDate, e.reasonCode, e.reasonDescription],
            );
            await batch.flushIfNeeded('encounter', ['patient']);
            counts.encounters++;
          }

          for (const c of entry.conditions) {
            batch.add('condition',
              ['condition_id', 'patient_id', 'encounter_id', 'code', 'system', 'description', 'start_date', 'stop_date'],
              [c.id, c.patientId, c.encounterId || null, c.code, c.system, c.description, c.startDate, c.stopDate || null],
            );
            await batch.flushIfNeeded('condition', ['patient', 'encounter']);
            counts.conditions++;
          }

          for (const m of entry.medications) {
            batch.add('medication',
              ['medication_id', 'patient_id', 'encounter_id', 'code', 'description', 'start_date', 'stop_date', 'reason_code', 'reason_description'],
              [m.id, m.patientId, m.encounterId || null, m.code, m.description, m.startDate, m.stopDate || null, m.reasonCode, m.reasonDescription],
            );
            await batch.flushIfNeeded('medication', ['patient', 'encounter']);
            counts.medications++;
          }

          for (const o of entry.observations) {
            batch.add('observation',
              ['observation_id', 'patient_id', 'encounter_id', 'category', 'code', 'description', 'value', 'units', 'type', 'date'],
              [o.id, o.patientId, o.encounterId || null, o.category, o.code, o.description, o.value, o.units, o.type, o.date],
            );
            await batch.flushIfNeeded('observation', ['patient', 'encounter']);
            counts.observations++;
          }

          for (const p of entry.procedures) {
            batch.add('procedure_',
              ['procedure_id', 'patient_id', 'encounter_id', 'code', 'system', 'description', 'start_date', 'stop_date', 'reason_code', 'reason_description'],
              [p.id, p.patientId, p.encounterId || null, p.code, p.system, p.description, p.startDate, p.stopDate, p.reasonCode, p.reasonDescription],
            );
            await batch.flushIfNeeded('procedure_', ['patient', 'encounter']);
            counts.procedures++;
          }

          if (counts.patients % 500 === 0) {
            process.stdout.write(`\r  Streamed ${counts.patients} patients...`);
          }
          callback();
        },
      }),
    );

    // Flush in FK-safe order: parents before children
    await batch.flush('patient');
    await batch.flush('encounter');
    await batch.flush('condition');
    await batch.flush('medication');
    await batch.flush('observation');
    await batch.flush('procedure_');

    console.log(`\r  Patients:     ${counts.patients}`);
    console.log(`  Encounters:   ${counts.encounters}`);
    console.log(`  Conditions:   ${counts.conditions}`);
    console.log(`  Medications:  ${counts.medications}`);
    console.log(`  Observations: ${counts.observations}`);
    console.log(`  Procedures:   ${counts.procedures}`);

    // ── 3. Verify counts ─────────────────────────────────────────────────
    console.log('\nVerifying row counts...');
    const tables = ['patient', 'encounter', 'condition', 'medication', 'observation', 'procedure_', 'provider', 'organization'];
    for (const t of tables) {
      const res = await pool.query(`SELECT COUNT(*) AS cnt FROM ${t}`);
      console.log(`  ${t}: ${res.rows[0].cnt}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nPostgreSQL ingestion complete in ${elapsed}s.`);

  } finally {
    await pool.end();
  }
}

ingest().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
