export type QuestionType =
  | "simple-lookup"
  | "multi-hop"
  | "temporal"
  | "cohort"
  | "reasoning";

export interface GroundTruthQuestion {
  id: string;
  type: QuestionType;
  question: string;
  answer: string;
  /** Patient IDs involved (empty for cohort questions spanning all patients) */
  patientIds: string[];
  /** Clinical domain tag for stratification */
  domain: string;
  /** Supporting record IDs for citation/hallucination checking */
  supportingRecordIds: string[];
}

export interface DataProfile {
  totalPatients: number;
  totalEncounters: number;
  /** condition description -> patient count */
  conditionCounts: Map<string, number>;
  /** observation code -> { description, patientCount } */
  observationCoverage: Map<string, { description: string; patientCount: number }>;
  /** medication description -> patient count */
  medicationCounts: Map<string, number>;
  /** [condA, condB] -> co-occurrence count */
  conditionCoOccurrences: Map<string, number>;
  /** encounter class -> count */
  encounterClassCounts: Map<string, number>;
}
