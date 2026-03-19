/**
 * SQL adapter — 7 retrieval functions equivalent to the graph MCP tools.
 * Uses standard SQL JOINs and WHERE clauses. No full-text search.
 */

import pg from 'pg';

// Re-export the record types from the graph adapter for consistency
export interface PatientRecord {
  patient_id: string; first_name: string; last_name: string;
  birth_date: string; death_date: string | null; gender: string;
  race: string; ethnicity: string; marital_status: string;
  city: string; state: string; zip: string;
}

export interface ConditionRecord {
  condition_id: string; code: string; system: string;
  description: string; start_date: string; stop_date: string | null;
  encounter_id: string;
}

export interface MedicationRecord {
  medication_id: string; code: string; description: string;
  start_date: string; stop_date: string | null;
  reason_code: string; reason_description: string; encounter_id: string;
}

export interface ObservationRecord {
  observation_id: string; category: string; code: string;
  description: string; value: string; units: string;
  type: string; date: string; encounter_id: string;
}

export interface ProcedureRecord {
  procedure_id: string; code: string; system: string;
  description: string; start_date: string; stop_date: string;
  reason_code: string; reason_description: string; encounter_id: string;
}

export interface EncounterRecord {
  encounter_id: string; encounter_class: string; code: string;
  description: string; start_date: string; stop_date: string;
  reason_code: string; reason_description: string;
  provider_id: string; organization_id: string;
}

export interface PatientSummary {
  patient: PatientRecord;
  conditions: ConditionRecord[];
  medications: MedicationRecord[];
  observations: ObservationRecord[];
  procedures: ProcedureRecord[];
  encounters: EncounterRecord[];
}

export interface TemporalRelationResult {
  from_date: string; to_date: string;
  relation: 'before' | 'after' | 'same_day';
}

export class SqlAdapter {
  constructor(private pool: pg.Pool) {}

  // ─── 1. Search Patients (ILIKE — no FTS) ─────────────────────────────────

  async searchPatients(query: string, limit = 20): Promise<PatientRecord[]> {
    const pattern = `%${query}%`;
    const { rows } = await this.pool.query(
      `SELECT patient_id, first_name, last_name, birth_date, death_date,
              gender, race, ethnicity, marital_status, city, state, zip
       FROM patient
       WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR city ILIKE $1
       LIMIT $2`,
      [pattern, limit],
    );
    return rows;
  }

  // ─── 2. Patient Summary ──────────────────────────────────────────────────

  async getPatientSummary(patientId: string): Promise<PatientSummary | null> {
    const { rows: patients } = await this.pool.query(
      `SELECT * FROM patient WHERE patient_id = $1`, [patientId],
    );
    if (patients.length === 0) return null;

    const [conditions, medications, observations, procedures, encounters] = await Promise.all([
      this.pool.query(
        `SELECT condition_id, code, system, description, start_date, stop_date, encounter_id
         FROM condition WHERE patient_id = $1`, [patientId]),
      this.pool.query(
        `SELECT medication_id, code, description, start_date, stop_date, reason_code, reason_description, encounter_id
         FROM medication WHERE patient_id = $1`, [patientId]),
      this.pool.query(
        `SELECT observation_id, category, code, description, value, units, type, date, encounter_id
         FROM observation WHERE patient_id = $1`, [patientId]),
      this.pool.query(
        `SELECT procedure_id, code, system, description, start_date, stop_date, reason_code, reason_description, encounter_id
         FROM procedure_ WHERE patient_id = $1`, [patientId]),
      this.pool.query(
        `SELECT encounter_id, encounter_class, code, description, start_date, stop_date,
                reason_code, reason_description, provider_id, organization_id
         FROM encounter WHERE patient_id = $1`, [patientId]),
    ]);

    return {
      patient: patients[0],
      conditions: conditions.rows,
      medications: medications.rows,
      observations: observations.rows,
      procedures: procedures.rows,
      encounters: encounters.rows,
    };
  }

  // ─── 3. Medications ──────────────────────────────────────────────────────

  async getPatientMedications(
    patientId: string,
    opts?: { active?: boolean; name?: string },
  ): Promise<MedicationRecord[]> {
    const params: unknown[] = [patientId];
    const filters = ['patient_id = $1'];

    if (opts?.active) {
      filters.push('(stop_date IS NULL OR stop_date = \'\')');
    }
    if (opts?.name) {
      params.push(`%${opts.name}%`);
      filters.push(`description ILIKE $${params.length}`);
    }

    const { rows } = await this.pool.query(
      `SELECT medication_id, code, description, start_date, stop_date,
              reason_code, reason_description, encounter_id
       FROM medication WHERE ${filters.join(' AND ')}
       ORDER BY start_date DESC`,
      params,
    );
    return rows;
  }

  // ─── 4. Diagnoses / Conditions ───────────────────────────────────────────

  async getPatientConditions(
    patientId: string,
    opts?: { status?: 'active' | 'resolved' },
  ): Promise<ConditionRecord[]> {
    const params: unknown[] = [patientId];
    const filters = ['patient_id = $1'];

    if (opts?.status === 'active') {
      filters.push('(stop_date IS NULL OR stop_date = \'\')');
    } else if (opts?.status === 'resolved') {
      filters.push('stop_date IS NOT NULL AND stop_date <> \'\'');
    }

    const { rows } = await this.pool.query(
      `SELECT condition_id, code, system, description, start_date, stop_date, encounter_id
       FROM condition WHERE ${filters.join(' AND ')}
       ORDER BY start_date DESC`,
      params,
    );
    return rows;
  }

  // ─── 5. Labs (Observations) ──────────────────────────────────────────────

  async getPatientLabs(
    patientId: string,
    opts?: { code?: string; startDate?: string; endDate?: string },
  ): Promise<ObservationRecord[]> {
    const params: unknown[] = [patientId];
    const filters = ['patient_id = $1'];

    if (opts?.code) {
      params.push(opts.code);
      filters.push(`code = $${params.length}`);
    }
    if (opts?.startDate) {
      params.push(opts.startDate);
      filters.push(`date >= $${params.length}`);
    }
    if (opts?.endDate) {
      params.push(opts.endDate);
      filters.push(`date <= $${params.length}`);
    }

    const { rows } = await this.pool.query(
      `SELECT observation_id, category, code, description, value, units, type, date, encounter_id
       FROM observation WHERE ${filters.join(' AND ')}
       ORDER BY date DESC`,
      params,
    );
    return rows;
  }

  // ─── 6. Temporal Relation ────────────────────────────────────────────────

  async getTemporalRelation(
    patientId: string,
    opts: { fromType: string; fromId: string; toType: string; toId: string },
  ): Promise<TemporalRelationResult | null> {
    const fromDate = await this.getEntityDate(opts.fromType, opts.fromId, patientId);
    const toDate = await this.getEntityDate(opts.toType, opts.toId, patientId);

    if (!fromDate || !toDate) return null;

    let relation: 'before' | 'after' | 'same_day';
    if (fromDate < toDate) relation = 'before';
    else if (fromDate > toDate) relation = 'after';
    else relation = 'same_day';

    return { from_date: fromDate, to_date: toDate, relation };
  }

  private async getEntityDate(type: string, id: string, patientId: string): Promise<string | null> {
    let sql: string;
    switch (type.toLowerCase()) {
      case 'condition':
        sql = 'SELECT start_date AS date FROM condition WHERE condition_id = $1 AND patient_id = $2';
        break;
      case 'medication':
        sql = 'SELECT start_date AS date FROM medication WHERE medication_id = $1 AND patient_id = $2';
        break;
      case 'observation':
        sql = 'SELECT date FROM observation WHERE observation_id = $1 AND patient_id = $2';
        break;
      case 'procedure':
        sql = 'SELECT start_date AS date FROM procedure_ WHERE procedure_id = $1 AND patient_id = $2';
        break;
      case 'encounter':
        sql = 'SELECT start_date AS date FROM encounter WHERE encounter_id = $1 AND patient_id = $2';
        break;
      default:
        return null;
    }
    const { rows } = await this.pool.query(sql, [id, patientId]);
    return rows.length > 0 ? rows[0].date : null;
  }

  // ─── 7. Cohort Discovery ────────────────────────────────────────────────

  async findCohort(opts: {
    conditions?: string[];
    medications?: string[];
    ageRange?: [number, number];
    gender?: string;
  }): Promise<PatientRecord[]> {
    const params: unknown[] = [];
    const joins: string[] = [];
    const filters: string[] = [];

    if (opts.conditions) {
      for (let i = 0; i < opts.conditions.length; i++) {
        const alias = `c${i}`;
        joins.push(`JOIN condition ${alias} ON ${alias}.patient_id = p.patient_id`);
        params.push(`%${opts.conditions[i]}%`);
        filters.push(`${alias}.description ILIKE $${params.length}`);
      }
    }

    if (opts.medications) {
      for (let i = 0; i < opts.medications.length; i++) {
        const alias = `m${i}`;
        joins.push(`JOIN medication ${alias} ON ${alias}.patient_id = p.patient_id`);
        params.push(`%${opts.medications[i]}%`);
        filters.push(`${alias}.description ILIKE $${params.length}`);
      }
    }

    if (opts.gender) {
      params.push(opts.gender);
      filters.push(`p.gender = $${params.length}`);
    }

    const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

    const { rows } = await this.pool.query(
      `SELECT DISTINCT p.patient_id, p.first_name, p.last_name, p.birth_date,
              p.death_date, p.gender, p.race, p.ethnicity,
              p.marital_status, p.city, p.state, p.zip
       FROM patient p
       ${joins.join('\n')}
       ${whereClause}
       LIMIT 100`,
      params,
    );

    let results: PatientRecord[] = rows;

    // Age filter (post-query)
    if (opts.ageRange) {
      const now = new Date();
      results = results.filter((p) => {
        const birth = new Date(p.birth_date);
        const age = (now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        return age >= opts.ageRange![0] && age <= opts.ageRange![1];
      });
    }

    return results;
  }
}
