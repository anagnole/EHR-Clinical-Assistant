/**
 * Full evaluation run — orchestrates all 4 runners across 80 questions,
 * scores results, and generates reports.
 *
 * Usage:
 *   npm run eval                                  # run all systems with Claude
 *   npm run eval -- --model gemma3:27b            # run with Ollama model
 *   npm run eval -- --model gemma3:27b --system llm-only  # specific system + model
 *   npm run eval -- --system graph                # run only graph (Claude only)
 *   npm run eval -- --limit 5                     # first 5 questions only
 *   npm run eval -- --skip-type cohort            # skip cohort questions
 *   npm run eval -- --timeout 60000               # 60s per question timeout
 *   npm run eval -- --resume                      # load previous results, skip completed
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { EvalQuestion, RunResult, ScoredResult } from './types.js';
import { runGraph, runSql, runSqlFts, runLlmOnly } from './runner.js';
import { score } from './scorer.js';
import { generateReport } from './report.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const RESULTS_DIR = join(PROJECT_ROOT, 'results');
const PG_DSN = process.env.PG_DSN ?? 'postgresql://user@localhost:5432/ehrdb';

type System = 'graph' | 'sql' | 'sql-fts' | 'llm-only';

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const systemArg = getArg(args, '--system') as System | undefined;
  const limitArg = getArg(args, '--limit');
  const skipType = getArg(args, '--skip-type');
  const timeoutArg = getArg(args, '--timeout');
  const modelArg = getArg(args, '--model');
  const resume = args.includes('--resume');

  const model = modelArg ?? 'claude-sonnet-4-6';
  const limit = limitArg ? parseInt(limitArg) : undefined;
  const timeout = timeoutArg ? parseInt(timeoutArg) : 120_000;

  const isClaude = model.startsWith('claude-');
  const systems: System[] = systemArg ? [systemArg] : ['graph', 'sql', 'sql-fts', 'llm-only'];

  // Per-model results file so runs don't overwrite each other
  const modelSlug = model.replace(/[:/]/g, '-');
  const INCREMENTAL_FILE = join(RESULTS_DIR, `incremental-${modelSlug}.json`);

  console.log(`Model: ${model} (${isClaude ? 'Claude CLI + MCP' : 'Ollama + native tools'})\n`);

  // Load questions
  let questions: EvalQuestion[] = JSON.parse(
    readFileSync(join(PROJECT_ROOT, 'data', 'generated', 'evaluation-questions.json'), 'utf-8'),
  );

  if (skipType) {
    questions = questions.filter(q => q.type !== skipType);
  }

  // --sample N: pick N questions evenly across types (e.g. --sample 10 = 2 per type)
  const sampleArg = getArg(args, '--sample');
  let subset: EvalQuestion[];
  if (sampleArg) {
    const n = parseInt(sampleArg);
    const types = [...new Set(questions.map(q => q.type))];
    const perType = Math.max(1, Math.floor(n / types.length));
    subset = [];
    for (const type of types) {
      subset.push(...questions.filter(q => q.type === type).slice(0, perType));
    }
  } else {
    subset = limit ? questions.slice(0, limit) : questions;
  }

  // Load previous results if resuming
  mkdirSync(RESULTS_DIR, { recursive: true });
  let allResults: ScoredResult[] = [];
  const completed = new Set<string>();

  if (resume && existsSync(INCREMENTAL_FILE)) {
    allResults = JSON.parse(readFileSync(INCREMENTAL_FILE, 'utf-8'));
    for (const r of allResults) {
      completed.add(`${r.system}:${r.questionId}`);
    }
    console.log(`Resuming: ${allResults.length} previous results loaded\n`);
  }

  const totalRuns = subset.length * systems.length - completed.size;
  console.log(`Running evaluation: ${subset.length} questions × ${systems.length} systems = ${totalRuns} runs\n`);

  // Setup
  let pool: pg.Pool | null = null;
  if (systems.includes('sql') || systems.includes('sql-fts')) {
    pool = new pg.Pool({ connectionString: PG_DSN });
  }

  // Handle graceful shutdown — save what we have
  let shuttingDown = false;
  const saveAndExit = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n\nSaving results before exit...');
    writeFileSync(INCREMENTAL_FILE, JSON.stringify(allResults, null, 2));
    generateReport(questions, allResults);
    console.log(`Saved ${allResults.length} results. Resume with --resume`);
    process.exit(0);
  };
  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);

  try {
    for (const system of systems) {
      console.log(`\n── ${system} ${'─'.repeat(50 - system.length)}`);

      for (let i = 0; i < subset.length; i++) {
        const q = subset[i];
        const key = `${system}:${q.id}`;

        if (completed.has(key)) {
          const prev = allResults.find(r => r.system === system && r.questionId === q.id);
          console.log(`  [${i + 1}/${subset.length}] ${q.id} (${q.type})... skip (${(prev?.score ?? 0) * 100}% cached)`);
          continue;
        }

        process.stdout.write(`  [${i + 1}/${subset.length}] ${q.id} (${q.type})... `);

        let result: RunResult;
        try {
          const runPromise = (async () => {
            switch (system) {
              case 'graph': return runGraph(q, model);
              case 'sql': return runSql(q, pool!, model);
              case 'sql-fts': return runSqlFts(q, pool!, model);
              case 'llm-only': return runLlmOnly(q, model);
            }
          })();

          const timeoutPromise = new Promise<RunResult>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout),
          );

          result = await Promise.race([runPromise, timeoutPromise]);
        } catch (err) {
          result = {
            questionId: q.id,
            system,
            model,
            answer: '',
            latencyMs: 0,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        const scored = score(q, result);
        allResults.push(scored);
        completed.add(key);

        const status = scored.error ? `✗ ${scored.error.slice(0, 40)}` : `${(scored.score * 100).toFixed(0)}%`;
        console.log(`${status} (${scored.latencyMs}ms)`);

        // Save incrementally every 5 results
        if (allResults.length % 5 === 0) {
          writeFileSync(INCREMENTAL_FILE, JSON.stringify(allResults, null, 2));
        }
      }
    }

    // Final save
    writeFileSync(INCREMENTAL_FILE, JSON.stringify(allResults, null, 2));
    console.log('\n── Generating reports ──────────────────────────────');
    generateReport(questions, allResults);

    // Print summary
    console.log('\n── Summary ─────────────────────────────────────────');
    for (const system of systems) {
      const sysResults = allResults.filter(r => r.system === system);
      const scores = sysResults.filter(r => !r.error).map(r => r.score);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      console.log(`  ${system.padEnd(10)} ${(avg * 100).toFixed(1)}% avg score (${sysResults.length} runs)`);
    }

  } finally {
    if (pool) await pool.end();
  }
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
