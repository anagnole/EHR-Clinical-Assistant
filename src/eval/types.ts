/**
 * Evaluation types — shared across runners, scorers, and report generator.
 */

export interface EvalQuestion {
  id: string;
  type: 'simple-lookup' | 'multi-hop' | 'temporal' | 'cohort' | 'reasoning';
  question: string;
  answer: string;
  patientIds: string[];
  domain: string;
  supportingRecordIds: string[];
}

export interface RunResult {
  questionId: string;
  system: 'graph' | 'sql' | 'sql-fts' | 'llm-only';
  model: string;
  answer: string;
  latencyMs: number;
  error?: string;
}

export interface ScoredResult extends RunResult {
  score: number;          // 0-1 primary score
  scoreMethod: string;    // how it was scored
  groundTruth: string;
}

export interface SystemSummary {
  system: string;
  overall: number;
  byType: Record<string, number>;
  byDomain: Record<string, number>;
  avgLatencyMs: number;
  errorCount: number;
}
