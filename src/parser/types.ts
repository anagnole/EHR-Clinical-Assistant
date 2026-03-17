// ─── Raw Synthea CSV row types (match column names exactly) ───

export interface RawPatient {
  Id: string;
  BIRTHDATE: string;
  DEATHDATE: string;
  SSN: string;
  DRIVERS: string;
  PASSPORT: string;
  PREFIX: string;
  FIRST: string;
  MIDDLE: string;
  LAST: string;
  SUFFIX: string;
  MAIDEN: string;
  MARITAL: string;
  RACE: string;
  ETHNICITY: string;
  GENDER: string;
  BIRTHPLACE: string;
  ADDRESS: string;
  CITY: string;
  STATE: string;
  COUNTY: string;
  FIPS: string;
  ZIP: string;
  LAT: string;
  LON: string;
  HEALTHCARE_EXPENSES: string;
  HEALTHCARE_COVERAGE: string;
  INCOME: string;
}

export interface RawEncounter {
  Id: string;
  START: string;
  STOP: string;
  PATIENT: string;
  ORGANIZATION: string;
  PROVIDER: string;
  PAYER: string;
  ENCOUNTERCLASS: string;
  CODE: string;
  DESCRIPTION: string;
  BASE_ENCOUNTER_COST: string;
  TOTAL_CLAIM_COST: string;
  PAYER_COVERAGE: string;
  REASONCODE: string;
  REASONDESCRIPTION: string;
}

export interface RawCondition {
  START: string;
  STOP: string;
  PATIENT: string;
  ENCOUNTER: string;
  SYSTEM: string;
  CODE: string;
  DESCRIPTION: string;
}

export interface RawMedication {
  START: string;
  STOP: string;
  PATIENT: string;
  PAYER: string;
  ENCOUNTER: string;
  CODE: string;
  DESCRIPTION: string;
  BASE_COST: string;
  PAYER_COVERAGE: string;
  DISPENSES: string;
  TOTALCOST: string;
  REASONCODE: string;
  REASONDESCRIPTION: string;
}

export interface RawObservation {
  DATE: string;
  PATIENT: string;
  ENCOUNTER: string;
  CATEGORY: string;
  CODE: string;
  DESCRIPTION: string;
  VALUE: string;
  UNITS: string;
  TYPE: string;
}

export interface RawProcedure {
  START: string;
  STOP: string;
  PATIENT: string;
  ENCOUNTER: string;
  SYSTEM: string;
  CODE: string;
  DESCRIPTION: string;
  BASE_COST: string;
  REASONCODE: string;
  REASONDESCRIPTION: string;
}

export interface RawProvider {
  Id: string;
  ORGANIZATION: string;
  NAME: string;
  GENDER: string;
  SPECIALITY: string;
  ADDRESS: string;
  CITY: string;
  STATE: string;
  ZIP: string;
  LAT: string;
  LON: string;
  ENCOUNTERS: string;
  PROCEDURES: string;
}

export interface RawOrganization {
  Id: string;
  NAME: string;
  ADDRESS: string;
  CITY: string;
  STATE: string;
  ZIP: string;
  LAT: string;
  LON: string;
  PHONE: string;
  REVENUE: string;
  UTILIZATION: string;
}

// ─── Internal EHR types (match the graph schema) ───

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  deathDate: string | null;
  gender: string;
  race: string;
  ethnicity: string;
  maritalStatus: string;
  city: string;
  state: string;
  zip: string;
}

export interface Encounter {
  id: string;
  patientId: string;
  providerId: string;
  organizationId: string;
  encounterClass: string;
  code: string;
  description: string;
  startDate: string;
  stopDate: string;
  reasonCode: string;
  reasonDescription: string;
}

export interface Condition {
  id: string;
  patientId: string;
  encounterId: string;
  code: string;
  system: string;
  description: string;
  startDate: string;
  stopDate: string | null;
}

export interface Medication {
  id: string;
  patientId: string;
  encounterId: string;
  code: string;
  description: string;
  startDate: string;
  stopDate: string | null;
  reasonCode: string;
  reasonDescription: string;
}

export interface Observation {
  id: string;
  patientId: string;
  encounterId: string;
  category: string;
  code: string;
  description: string;
  value: string;
  units: string;
  type: string;
  date: string;
}

export interface Procedure {
  id: string;
  patientId: string;
  encounterId: string;
  code: string;
  system: string;
  description: string;
  startDate: string;
  stopDate: string;
  reasonCode: string;
  reasonDescription: string;
}

export interface Provider {
  id: string;
  organizationId: string;
  name: string;
  gender: string;
  specialty: string;
}

export interface Organization {
  id: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

// ─── Dataset container with per-patient indexes ───

export interface ParsedDataset {
  patients: Patient[];
  encounters: Encounter[];
  conditions: Condition[];
  medications: Medication[];
  observations: Observation[];
  procedures: Procedure[];
  providers: Provider[];
  organizations: Organization[];

  // Per-patient lookup indexes
  byPatient: {
    encounters: Map<string, Encounter[]>;
    conditions: Map<string, Condition[]>;
    medications: Map<string, Medication[]>;
    observations: Map<string, Observation[]>;
    procedures: Map<string, Procedure[]>;
  };

  // Per-encounter lookup
  byEncounter: {
    conditions: Map<string, Condition[]>;
    medications: Map<string, Medication[]>;
    observations: Map<string, Observation[]>;
    procedures: Map<string, Procedure[]>;
  };

  // Entity lookups
  encounterById: Map<string, Encounter>;
  providerById: Map<string, Provider>;
  organizationById: Map<string, Organization>;
  patientById: Map<string, Patient>;
}
