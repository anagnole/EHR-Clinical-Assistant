/**
 * PostgreSQL schema for the EHR baseline.
 * 8 tables mirroring the Kuzu graph node tables, with foreign keys and indexes.
 */

import pg from 'pg';

const PG_DSN = process.env.PG_DSN ?? 'postgresql://user@localhost:5432/ehrdb';

export function getPool(): pg.Pool {
  return new pg.Pool({ connectionString: PG_DSN });
}

export const SCHEMA_DDL = `
-- Organizations
CREATE TABLE IF NOT EXISTS organization (
  organization_id TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  phone           TEXT
);

-- Providers
CREATE TABLE IF NOT EXISTS provider (
  provider_id     TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organization(organization_id),
  name            TEXT NOT NULL,
  gender          TEXT,
  specialty       TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_org ON provider(organization_id);

-- Patients
CREATE TABLE IF NOT EXISTS patient (
  patient_id     TEXT PRIMARY KEY,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  birth_date     TEXT NOT NULL,
  death_date     TEXT,
  gender         TEXT,
  race           TEXT,
  ethnicity      TEXT,
  marital_status TEXT,
  city           TEXT,
  state          TEXT,
  zip            TEXT
);

-- Encounters
CREATE TABLE IF NOT EXISTS encounter (
  encounter_id       TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL REFERENCES patient(patient_id),
  provider_id        TEXT REFERENCES provider(provider_id),
  organization_id    TEXT REFERENCES organization(organization_id),
  encounter_class    TEXT,
  code               TEXT,
  description        TEXT,
  start_date         TEXT,
  stop_date          TEXT,
  reason_code        TEXT,
  reason_description TEXT
);
CREATE INDEX IF NOT EXISTS idx_encounter_patient ON encounter(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounter_provider ON encounter(provider_id);

-- Conditions
CREATE TABLE IF NOT EXISTS condition (
  condition_id TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL REFERENCES patient(patient_id),
  encounter_id TEXT REFERENCES encounter(encounter_id),
  code         TEXT,
  system       TEXT,
  description  TEXT,
  start_date   TEXT,
  stop_date    TEXT
);
CREATE INDEX IF NOT EXISTS idx_condition_patient ON condition(patient_id);
CREATE INDEX IF NOT EXISTS idx_condition_encounter ON condition(encounter_id);

-- Medications
CREATE TABLE IF NOT EXISTS medication (
  medication_id      TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL REFERENCES patient(patient_id),
  encounter_id       TEXT REFERENCES encounter(encounter_id),
  code               TEXT,
  description        TEXT,
  start_date         TEXT,
  stop_date          TEXT,
  reason_code        TEXT,
  reason_description TEXT
);
CREATE INDEX IF NOT EXISTS idx_medication_patient ON medication(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_encounter ON medication(encounter_id);

-- Observations
CREATE TABLE IF NOT EXISTS observation (
  observation_id TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES patient(patient_id),
  encounter_id   TEXT REFERENCES encounter(encounter_id),
  category       TEXT,
  code           TEXT,
  description    TEXT,
  value          TEXT,
  units          TEXT,
  type           TEXT,
  date           TEXT
);
CREATE INDEX IF NOT EXISTS idx_observation_patient ON observation(patient_id);
CREATE INDEX IF NOT EXISTS idx_observation_encounter ON observation(encounter_id);
CREATE INDEX IF NOT EXISTS idx_observation_code ON observation(code);

-- Procedures
CREATE TABLE IF NOT EXISTS procedure_ (
  procedure_id       TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL REFERENCES patient(patient_id),
  encounter_id       TEXT REFERENCES encounter(encounter_id),
  code               TEXT,
  system             TEXT,
  description        TEXT,
  start_date         TEXT,
  stop_date          TEXT,
  reason_code        TEXT,
  reason_description TEXT
);
CREATE INDEX IF NOT EXISTS idx_procedure_patient ON procedure_(patient_id);
CREATE INDEX IF NOT EXISTS idx_procedure_encounter ON procedure_(encounter_id);
`;

export const FTS_DDL = `
-- Full-text search columns and indexes

-- Patient FTS
ALTER TABLE patient ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(city,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_patient_fts ON patient USING GIN(fts);

-- Condition FTS
ALTER TABLE condition ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(description,'') || ' ' || coalesce(code,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_condition_fts ON condition USING GIN(fts);

-- Medication FTS
ALTER TABLE medication ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(description,'') || ' ' || coalesce(code,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_medication_fts ON medication USING GIN(fts);

-- Observation FTS
ALTER TABLE observation ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(description,'') || ' ' || coalesce(code,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_observation_fts ON observation USING GIN(fts);

-- Provider FTS
ALTER TABLE provider ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name,'') || ' ' || coalesce(specialty,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_provider_fts ON provider USING GIN(fts);

-- Organization FTS
ALTER TABLE organization ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name,'') || ' ' || coalesce(city,''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_organization_fts ON organization USING GIN(fts);
`;

/** Create all tables + indexes. Optionally include FTS. */
export async function createSchema(pool: pg.Pool, includeFts = false): Promise<void> {
  await pool.query(SCHEMA_DDL);
  if (includeFts) {
    await pool.query(FTS_DDL);
  }
}
