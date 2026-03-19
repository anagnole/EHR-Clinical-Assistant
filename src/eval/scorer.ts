/**
 * Scorers — compare LLM answers against ground truth.
 *
 * Strategies by question type:
 * - simple-lookup: F1 for set answers, fuzzy match for single values
 * - multi-hop: fuzzy match (extracts key value)
 * - temporal: fuzzy match on trend + values
 * - cohort: numeric extraction + tolerance
 * - reasoning: fuzzy keyword overlap
 */

import type { EvalQuestion, RunResult, ScoredResult } from './types.js';

// ─── Main scoring dispatch ───────────────────────────────────────────────────

export function score(q: EvalQuestion, r: RunResult): ScoredResult {
  if (r.error || !r.answer) {
    return { ...r, score: 0, scoreMethod: 'error', groundTruth: q.answer };
  }

  const answer = r.answer.toLowerCase().trim();
  const truth = q.answer.toLowerCase().trim();

  // Check if answer is a semicolon-separated list (set comparison)
  if (truth.includes(';')) {
    return { ...r, score: f1Score(truth, answer), scoreMethod: 'f1', groundTruth: q.answer };
  }

  // Check if answer is a numeric count (e.g., "367 patients")
  const numMatch = truth.match(/^(\d+(?:\.\d+)?)\s/);
  if (numMatch && q.type === 'cohort') {
    return { ...r, score: numericScore(truth, answer), scoreMethod: 'numeric', groundTruth: q.answer };
  }

  // Default: fuzzy token overlap
  return { ...r, score: fuzzyScore(truth, answer), scoreMethod: 'fuzzy', groundTruth: q.answer };
}

// ─── F1 scorer (set comparison) ──────────────────────────────────────────────

function f1Score(truth: string, answer: string): number {
  const truthSet = new Set(
    truth.split(';').map(s => normalize(s)).filter(Boolean),
  );
  const answerTokens = normalize(answer);

  // Check which truth items appear in the answer
  let found = 0;
  for (const item of truthSet) {
    // Fuzzy: check if the key words of the item appear in the answer
    const keywords = item.split(/\s+/).filter(w => w.length > 3);
    const matched = keywords.filter(k => answerTokens.includes(k)).length;
    if (keywords.length > 0 && matched / keywords.length >= 0.5) {
      found++;
    }
  }

  const precision = found / Math.max(truthSet.size, 1);
  const recall = found / truthSet.size;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

// ─── Numeric scorer ──────────────────────────────────────────────────────────

function numericScore(truth: string, answer: string): number {
  const truthNum = extractNumber(truth);
  const answerNum = extractNumber(answer);

  if (truthNum === null || answerNum === null) {
    return fuzzyScore(truth, answer);
  }

  if (truthNum === 0) return answerNum === 0 ? 1 : 0;

  const relError = Math.abs(truthNum - answerNum) / truthNum;
  // Within 10% = 1.0, within 25% = 0.5, worse = 0
  if (relError <= 0.1) return 1;
  if (relError <= 0.25) return 0.5;
  return 0;
}

// ─── Fuzzy token overlap scorer ──────────────────────────────────────────────

function fuzzyScore(truth: string, answer: string): number {
  const truthTokens = tokenize(truth);
  const answerTokens = new Set(tokenize(answer));

  if (truthTokens.length === 0) return answer.length === 0 ? 1 : 0;

  let matches = 0;
  for (const t of truthTokens) {
    if (answerTokens.has(t)) matches++;
  }

  return matches / truthTokens.length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s.%]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length > 2);
}

function extractNumber(s: string): number | null {
  const match = s.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}
