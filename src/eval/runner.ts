/**
 * Evaluation runners — call LLMs via @anagnole/claude-cli-wrapper providers
 * for each question under 4 retrieval modes.
 *
 * Supports both Claude (via CLI) and Ollama models (via HTTP).
 * Pass model name to each runner to control which model is used.
 *
 * - graph: Claude uses MCP tools, Ollama uses native tool calling against Kuzu
 * - sql / sql-fts: pre-retrieves context via adapter, injects into prompt
 * - llm-only: injects serialized patient record into prompt
 */

import pg from 'pg';
import {
  spawnClaude,
  buildResponse,
  ProviderRegistry,
  ClaudeCliProvider,
  OllamaProvider,
  type Provider,
} from '@anagnole/claude-cli-wrapper';
import type { EvalQuestion, RunResult } from './types.js';
import { SqlAdapter } from '../sql/adapter.js';
import { SqlFtsAdapter } from '../sql/fts-adapter.js';
import {
  buildPatientPrompt,
  buildCohortPrompt,
  loadPatientEntry,
  loadAllPatientEntries,
} from '../prompt/builder.js';
import { TOOL_DEFS, executeTool } from '../api/tools.js';

const SYSTEM_INSTRUCTION = `You are a clinical EHR assistant. Answer the question precisely and concisely based on the available patient data. Give only the answer, no explanations or caveats.`;

const PROJECT_DIR = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// Build provider registry
const registry = new ProviderRegistry();
registry.register(new ClaudeCliProvider({
  claudePath: process.env.CLAUDE_PATH,
}));
registry.register(new OllamaProvider({
  baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
}));

export { registry };

// ─── Unified LLM caller ─────────────────────────────────────────────────────

async function callLlm(
  prompt: string,
  model: string,
  opts?: {
    system?: string;
    useMcp?: boolean;
    maxTurns?: number;
  },
): Promise<{ answer: string; latencyMs: number }> {
  const provider = registry.resolve(model);
  if (!provider) {
    throw new Error(`No provider found for model: ${model}`);
  }

  // Claude CLI path — supports MCP tools and multi-turn
  if (provider.name === 'claude-cli') {
    return callClaude(prompt, model, opts);
  }

  // Ollama/other provider path — text completion only
  return callProvider(prompt, model, provider, opts);
}

async function callClaude(
  prompt: string,
  model: string,
  opts?: {
    system?: string;
    useMcp?: boolean;
    maxTurns?: number;
  },
): Promise<{ answer: string; latencyMs: number }> {
  const start = Date.now();

  const child = spawnClaude({
    prompt,
    model,
    systemPrompt: opts?.system,
    streaming: false,
    maxTurns: opts?.maxTurns ?? 1,
    workingDirectory: opts?.useMcp ? PROJECT_DIR : undefined,
    strictMcpConfig: !opts?.useMcp,
    mcpConfig: opts?.useMcp ? undefined : '{"mcpServers":{}}',
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
        const response = buildResponse(cli, model);
        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        resolve({ answer: text.trim(), latencyMs: cli.duration_ms ?? latencyMs });
      } catch {
        resolve({ answer: stdout.trim(), latencyMs });
      }
    });

    child.on('error', () => {
      resolve({ answer: '', latencyMs: Date.now() - start });
    });
  });
}

async function callProvider(
  prompt: string,
  model: string,
  provider: Provider,
  opts?: {
    system?: string;
    useMcp?: boolean;
    maxTurns?: number;
  },
): Promise<{ answer: string; latencyMs: number }> {
  const start = Date.now();

  try {
    const response = await provider.complete({
      model,
      messages: [{ role: 'user', content: prompt }],
      system: opts?.system,
      max_tokens: 4096,
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');

    return { answer: text.trim(), latencyMs: Date.now() - start };
  } catch (err) {
    console.error(`[eval] ${model} error:`, (err as Error).message);
    return { answer: '', latencyMs: Date.now() - start };
  }
}

// ─── Graph runner ────────────────────────────────────────────────────────────

export async function runGraph(q: EvalQuestion, model: string): Promise<RunResult> {
  const provider = registry.resolve(model);

  // Claude: use MCP tools via CLI
  if (provider?.name === 'claude-cli') {
    const { answer, latencyMs } = await callLlm(q.question, model, {
      system: SYSTEM_INSTRUCTION,
      useMcp: true,
      maxTurns: 5,
    });
    return { questionId: q.id, system: 'graph', model, answer, latencyMs };
  }

  // Ollama: use native tool calling against Kuzu
  const { answer, latencyMs } = await callOllamaWithTools(q.question, model, {
    system: SYSTEM_INSTRUCTION,
    maxRounds: 5,
  });
  return { questionId: q.id, system: 'graph', model, answer, latencyMs };
}

// ─── Ollama tool-calling agent loop ──────────────────────────────────────────

async function callOllamaWithTools(
  prompt: string,
  model: string,
  opts: { system?: string; maxRounds?: number },
): Promise<{ answer: string; latencyMs: number }> {
  const ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const maxRounds = opts.maxRounds ?? 5;
  const start = Date.now();

  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) {
    messages.push({ role: 'system', content: opts.system });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    for (let round = 0; round < maxRounds; round++) {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOL_DEFS,
          stream: false,
          options: { num_predict: 4096 },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error (${res.status}): ${text}`);
      }

      const data = await res.json() as {
        message: {
          role: string;
          content: string;
          tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
        };
      };

      const toolCalls = data.message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return { answer: (data.message.content ?? '').trim(), latencyMs: Date.now() - start };
      }

      // Add assistant message with tool calls
      messages.push(data.message);

      // Execute tools and add results
      for (const tc of toolCalls) {
        const result = await executeTool(tc.function.name, tc.function.arguments);
        messages.push({ role: 'tool', content: JSON.stringify(result) });
      }
    }

    // If we exhaust rounds, return whatever we have
    return { answer: '', latencyMs: Date.now() - start };
  } catch (err) {
    console.error(`[eval] ${model} tool-calling error:`, (err as Error).message);
    return { answer: '', latencyMs: Date.now() - start };
  }
}

// ─── SQL runner ──────────────────────────────────────────────────────────────

export async function runSql(q: EvalQuestion, pool: pg.Pool, model: string): Promise<RunResult> {
  const adapter = new SqlAdapter(pool);
  const context = await buildSqlContext(q, adapter);
  const prompt = `Here is the relevant patient data retrieved via SQL:\n\n${context}\n\nQuestion: ${q.question}`;
  const { answer, latencyMs } = await callLlm(prompt, model, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'sql', model, answer, latencyMs };
}

// ─── SQL+FTS runner ──────────────────────────────────────────────────────────

export async function runSqlFts(q: EvalQuestion, pool: pg.Pool, model: string): Promise<RunResult> {
  const adapter = new SqlFtsAdapter(pool);
  const context = await buildSqlContext(q, adapter);
  const prompt = `Here is the relevant patient data retrieved via SQL+FTS:\n\n${context}\n\nQuestion: ${q.question}`;
  const { answer, latencyMs } = await callLlm(prompt, model, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'sql-fts', model, answer, latencyMs };
}

// ─── LLM-only runner ────────────────────────────────────────────────────────

export async function runLlmOnly(q: EvalQuestion, model: string): Promise<RunResult> {
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
  const { answer, latencyMs } = await callLlm(prompt, model, { system: SYSTEM_INSTRUCTION });
  return { questionId: q.id, system: 'llm-only', model, answer, latencyMs };
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
