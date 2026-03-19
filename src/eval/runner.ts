/**
 * Evaluation runners — call Claude via @anagnole/claude-cli-wrapper
 * for each question under 4 retrieval modes.
 *
 * Uses spawnClaude() which spawns the CLI as a child process with
 * proper flags, JSON output, and environment isolation.
 *
 * - graph: MCP tools enabled (uses project .mcp.json)
 * - sql / sql-fts: pre-retrieves context via adapter, injects into prompt
 * - llm-only: injects serialized patient record into prompt
 */

import pg from 'pg';
import { spawnClaude, buildResponse } from '@anagnole/claude-cli-wrapper';
import type { EvalQuestion, RunResult } from './types.js';
import { SqlAdapter } from '../sql/adapter.js';
import { SqlFtsAdapter } from '../sql/fts-adapter.js';
import {
  buildPatientPrompt,
  buildCohortPrompt,
  loadPatientEntry,
  loadAllPatientEntries,
} from '../prompt/builder.js';

const SYSTEM_INSTRUCTION = `You are a clinical EHR assistant. Answer the question precisely and concisely based on the available patient data. Give only the answer, no explanations or caveats.`;

const PROJECT_DIR = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// ─── Claude wrapper ──────────────────────────────────────────────────────────

async function callClaude(
  prompt: string,
  opts?: {
    system?: string;
    useMcp?: boolean;
    maxTurns?: number;
  },
): Promise<{ answer: string; latencyMs: number }> {
  const start = Date.now();

  const child = spawnClaude({
    prompt,
    model: 'claude-sonnet-4-6',
    systemPrompt: opts?.system,
    streaming: false,
    maxTurns: opts?.maxTurns ?? 1,
    workingDirectory: opts?.useMcp ? PROJECT_DIR : undefined,
    // For non-MCP runs, use strict config with empty servers
    strictMcpConfig: !opts?.useMcp,
    mcpConfig: opts?.useMcp ? undefined : '{"mcpServers":{}}',
    // Allow all tools so MCP calls don't need manual approval
    dangerouslySkipPermissions: true,
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      const latencyMs = Date.now() - start;

      if (code !== 0 || !stdout.trim()) {
        resolve({ answer: '', latencyMs });
        return;
      }

      try {
        const cli = JSON.parse(stdout.trim());
        const response = buildResponse(cli, 'claude-sonnet-4-6');
        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        resolve({ answer: text.trim(), latencyMs: cli.duration_ms ?? latencyMs });
      } catch {
        // If JSON parse fails, try using raw stdout as answer
        resolve({ answer: stdout.trim(), latencyMs });
      }
    });

    child.on('error', () => {
      resolve({ answer: '', latencyMs: Date.now() - start });
    });
  });
}

// ─── Graph runner ────────────────────────────────────────────────────────────

export async function runGraph(q: EvalQuestion): Promise<RunResult> {
  const { answer, latencyMs } = await callClaude(q.question, {
    system: SYSTEM_INSTRUCTION,
    useMcp: true,
    maxTurns: 5,
  });
  return { questionId: q.id, system: 'graph', answer, latencyMs };
}

// ─── SQL runner ──────────────────────────────────────────────────────────────

export async function runSql(q: EvalQuestion, pool: pg.Pool): Promise<RunResult> {
  const adapter = new SqlAdapter(pool);
  const context = await buildSqlContext(q, adapter);
  const prompt = `Here is the relevant patient data retrieved via SQL:\n\n${context}\n\nQuestion: ${q.question}`;
  const { answer, latencyMs } = await callClaude(prompt, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'sql', answer, latencyMs };
}

// ─── SQL+FTS runner ──────────────────────────────────────────────────────────

export async function runSqlFts(q: EvalQuestion, pool: pg.Pool): Promise<RunResult> {
  const adapter = new SqlFtsAdapter(pool);
  const context = await buildSqlContext(q, adapter);
  const prompt = `Here is the relevant patient data retrieved via SQL+FTS:\n\n${context}\n\nQuestion: ${q.question}`;
  const { answer, latencyMs } = await callClaude(prompt, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'sql-fts', answer, latencyMs };
}

// ─── LLM-only runner ────────────────────────────────────────────────────────

export async function runLlmOnly(q: EvalQuestion): Promise<RunResult> {
  let context: string;

  if (q.type === 'cohort') {
    const all = await loadAllPatientEntries();
    context = buildCohortPrompt(all);
  } else if (q.patientIds.length > 0) {
    const entry = await loadPatientEntry(q.patientIds[0]);
    context = entry ? buildPatientPrompt(entry) : 'Patient not found.';
  } else {
    context = 'No patient data available.';
  }

  const prompt = `Here is the patient record:\n\n${context}\n\nQuestion: ${q.question}`;
  const { answer, latencyMs } = await callClaude(prompt, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'llm-only', answer, latencyMs };
}

// ─── SQL context builder ─────────────────────────────────────────────────────

async function buildSqlContext(q: EvalQuestion, adapter: SqlAdapter): Promise<string> {
  if (q.type === 'cohort') {
    const cohort = await adapter.findCohort({});
    const lines = cohort.map(p =>
      `${p.patient_id} | ${p.first_name} ${p.last_name} | ${p.birth_date} | ${p.gender} | ${p.city}`
    );
    return `Patient cohort (${cohort.length} patients):\n${lines.join('\n')}`;
  }

  if (q.patientIds.length === 0) return 'No specific patient referenced.';

  const patientId = q.patientIds[0];
  const summary = await adapter.getPatientSummary(patientId);
  if (!summary) return `Patient ${patientId} not found.`;

  const sections: string[] = [];
  const p = summary.patient;

  sections.push(`Patient: ${p.first_name} ${p.last_name} (${p.patient_id})
Born: ${p.birth_date}, Gender: ${p.gender}, Race: ${p.race}
Location: ${p.city}, ${p.state}`);

  sections.push(`Active Conditions (${summary.conditions.filter(c => !c.stop_date).length}):
${summary.conditions.filter(c => !c.stop_date).map(c => `- ${c.description} (since ${c.start_date})`).join('\n') || 'None'}`);

  sections.push(`Medications (${summary.medications.length}):
${summary.medications.map(m => `- ${m.description} (${m.start_date}${m.stop_date ? ' to ' + m.stop_date : ' - active'})`).join('\n') || 'None'}`);

  const labsByCode = new Map<string, typeof summary.observations[0][]>();
  for (const o of summary.observations) {
    const arr = labsByCode.get(o.code) || [];
    arr.push(o);
    labsByCode.set(o.code, arr);
  }
  const labLines: string[] = [];
  for (const [, obs] of labsByCode) {
    const sorted = obs.sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    labLines.push(`- ${latest.description}: ${latest.value} ${latest.units} (${latest.date})`);
  }
  sections.push(`Lab Results (${labsByCode.size} types):\n${labLines.join('\n') || 'None'}`);

  sections.push(`Encounters (${summary.encounters.length}):
${summary.encounters.slice(0, 20).map(e => `- ${e.start_date}: ${e.description} (${e.encounter_class})`).join('\n')}`);

  return sections.join('\n\n');
}
