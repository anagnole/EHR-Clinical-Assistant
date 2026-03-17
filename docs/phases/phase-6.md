# Phase 6: Evaluation Harness

## Goal
Run ~80 clinical questions across 4 systems (graph, SQL, SQL+FTS, LLM-only), score answers against ground truth, and produce comparison reports.

## Dependencies
- Phases 2-5 (all data and retrieval systems ready)

## Steps
1. Define evaluation types — EvalQuestion, RunResult, EvalResult with answer types (set, exact, numeric, boolean, free_text)
2. Organize ~80 questions across 5 types: simple lookup (16), multi-hop (16), temporal (16), cohort (16), reasoning (16)
3. Build 4 runners — graph-runner (Kuzu MCP tools), sql-runner (SQL adapter), sql-fts-runner (SQL+FTS adapter), llm-only-runner (prompt builder, no tools)
4. Each runner calls Claude via Anthropic API, captures answer, record_ids, latency, tool calls, token usage
5. Build scorers — F1 for set answers, exact match, MAE for numeric, accuracy for boolean, LLM-as-judge for hallucination detection
6. Build report generator — summary.md (comparison table), summary.json (structured), per-question.csv (for statistical analysis)
7. Run full evaluation and validate results

## Tickets
- [033-eval-types](../tickets/033-eval-types.md)
- [034-question-bank](../tickets/034-question-bank.md)
- [035-graph-runner](../tickets/035-graph-runner.md)
- [036-sql-runner](../tickets/036-sql-runner.md)
- [037-sql-fts-runner](../tickets/037-sql-fts-runner.md)
- [038-llm-only-runner](../tickets/038-llm-only-runner.md)
- [039-scorers](../tickets/039-scorers.md)
- [040-report-generator](../tickets/040-report-generator.md)
- [041-full-evaluation-run](../tickets/041-full-evaluation-run.md)
