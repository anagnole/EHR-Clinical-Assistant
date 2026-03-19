/**
 * Prompt verification — checks that prompts are readable, contain necessary
 * information, and stay within token limits.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientPrompt,
  buildCohortPrompt,
  loadPatientEntry,
  loadAllPatientEntries,
} from './builder.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const GEN_DIR = join(PROJECT_ROOT, 'data', 'generated');

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function verify() {
  console.log('Starting prompt verification...\n');
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

  const questions = JSON.parse(
    readFileSync(join(GEN_DIR, 'evaluation-questions.json'), 'utf-8'),
  ) as Array<{
    id: string; type: string; question: string; answer: string;
    patientIds: string[];
  }>;

  // ── 1. Single-patient prompts ────────────────────────────────────────
  console.log('1. Single-patient prompt checks');

  // Pick a few diverse questions
  const singlePatientQs = questions.filter(q => q.patientIds.length === 1).slice(0, 5);

  for (const q of singlePatientQs) {
    const entry = await loadPatientEntry(q.patientIds[0]);
    check(`loadPatientEntry finds ${q.patientIds[0]}`, entry !== null);

    if (entry) {
      const prompt = buildPatientPrompt(entry);
      const tokens = estimateTokens(prompt);

      check(`prompt for ${q.id} (${q.type}) is within 8000 tokens (${tokens})`, tokens <= 8000);
      check(`prompt contains patient name`, prompt.includes(entry.patient.firstName));
      check(`prompt contains "Active Conditions"`, prompt.includes('Active Conditions'));
      check(`prompt contains "Active Medications"`, prompt.includes('Active Medications'));
      check(`prompt contains "Lab Results"`, prompt.includes('Lab Results'));
    }
  }

  // ── 2. Cohort prompt ─────────────────────────────────────────────────
  console.log('\n2. Cohort prompt checks');

  const cohortQs = questions.filter(q => q.type === 'cohort');
  check(`found ${cohortQs.length} cohort questions`, cohortQs.length > 0);

  // Load a subset for testing (loading all 2264 patients takes a moment)
  console.log('  Loading all patients for cohort prompt...');
  const allEntries = await loadAllPatientEntries();
  check(`loaded ${allEntries.length} patient entries`, allEntries.length > 0);

  const cohortPrompt = buildCohortPrompt(allEntries);
  const cohortTokens = estimateTokens(cohortPrompt);
  console.log(`  Cohort prompt: ${cohortTokens} tokens, ${cohortPrompt.split('\n').length} lines`);

  check('cohort prompt within 12000 tokens', cohortTokens <= 12000);
  check('cohort prompt has table header', cohortPrompt.includes('Active Conditions'));
  check('cohort prompt includes patient IDs', cohortPrompt.includes(allEntries[0].patient.id));

  // ── 3. Token budget analysis ────────────────────────────────────────
  console.log('\n3. Token budget analysis');

  const sampleIds = questions
    .filter(q => q.patientIds.length === 1)
    .map(q => q.patientIds[0])
    .filter((id, i, arr) => arr.indexOf(id) === i) // unique
    .slice(0, 10);

  const tokenCounts: number[] = [];
  for (const id of sampleIds) {
    const entry = await loadPatientEntry(id);
    if (entry) {
      const prompt = buildPatientPrompt(entry);
      tokenCounts.push(estimateTokens(prompt));
    }
  }

  const avg = Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length);
  const max = Math.max(...tokenCounts);
  const min = Math.min(...tokenCounts);
  console.log(`  Across ${tokenCounts.length} patients: min=${min}, avg=${avg}, max=${max} tokens`);
  check('all sample prompts within budget', max <= 8000);

  // ── Done ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Verification complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
