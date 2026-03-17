# ThesisBrainifai — Implementation Plan

## Status
**Pending implementation** — blocked on Brainifai Phases 1-3 (cleanup, CLI & instance model, multi-instance Kuzu).

## Summary
Thesis experiment testing whether **graph-based retrieval improves LLM clinical question answering** compared to SQL and LLM-only baselines. ThesisBrainifai is a **Brainifai instance** — a specialized child node with a custom "ehr" template, its own EHR graph schema, custom context-building tools, and an evaluation harness. It is not a standalone project.

## Problem
LLMs lack structured clinical context when answering medical questions. Graph-based retrieval (Kuzu) may outperform flat SQL queries and raw prompt-stuffing by leveraging relationships between patients, conditions, medications, labs, and temporal patterns.

## Prior Art
- **Synthea** — Synthetic patient data generator (seed 42, CSV export). Produces clinically validated data with real SNOMED/LOINC/RxNorm codes. Ground truth Q&A derived programmatically from parsed data.
- **MedQA / PubMedQA** — Medical QA benchmarks. Different scope — they test general medical knowledge, not structured patient data retrieval.
- **GraphRAG (Microsoft)** — Graph-based retrieval for LLMs. Similar concept but designed for unstructured text, not structured clinical data.

## Relationship to Brainifai
ThesisBrainifai is a Brainifai child instance created via `brainifai init --template ehr`. It inherits:
- **Kuzu database** — its own instance at `.brainifai/data/kuzu`
- **GraphStore interface** — base adapter from Brainifai, extended with EHR-specific queries
- **MCP server** — base MCP infrastructure from Brainifai, with 7 custom EHR retrieval tools
- **Instance registration** — self-describes to the global Brainifai instance

What ThesisBrainifai provides on its own:
- Custom EHR schema (7 node tables, 12 relationships)
- Synthetic data generator (2000+ patients via Synthea, 5 question types, ground truth)
- 7 custom MCP tools for clinical graph retrieval
- PostgreSQL and LLM-only baselines for comparison
- Evaluation harness (80 questions, 4 runners, scoring)

## Phases Overview
1. **EHR Instance Setup** — Create Brainifai instance with custom EHR schema and GraphStore extensions
2. **Synthetic Data Generation** — 2000+ patients via Synthea (seed 42), 5 question types, programmatic ground truth
3. **Custom MCP Tools** — 7 graph retrieval tools registered as the instance's context-building functions
4. **PostgreSQL Baseline** — Same data in relational tables, SQL-only and SQL+FTS variants
5. **LLM-Only Baseline** — No retrieval, flat patient record in prompt
6. **Evaluation Harness** — 80 questions, 4 runners, scoring, reports

Phases 3, 4, and 5 can be parallelized after Phase 2.

## Technical Stack
- **Instance platform:** Brainifai (Kuzu, MCP SDK, TypeScript)
- **Custom schema:** 7 node tables (Patient, Encounter, Condition, Medication, Observation, Procedure, Provider), 12 relationships
- **Data generation:** Synthea CSV output (seed 42, 2000 alive patients), programmatic Q&A derivation
- **SQL baseline:** PostgreSQL 16 (Docker), standard + FTS variants
- **Evaluation:** Anthropic API for runners, LLM-as-judge for hallucination scoring
- **Scoring:** F1, exact match, MAE, hallucination rate, latency, token cost

## Key Design Decisions
1. **Brainifai instance, not standalone** — inherits infrastructure, provides domain-specific schema and tools.
2. **Synthea over custom generator** — Synthea provides clinically validated data with real medical codes. Ground truth is derived programmatically from the parsed data rather than embedded in templates.
3. **record_ids for citation tracking** — Every tool return includes supporting record IDs. Enables hallucination detection.
4. **Same interface, different backends** — Graph and SQL expose equivalent retrieval. Fair comparison.
5. **LLM-as-judge for hallucination** — For free-text reasoning, an LLM judge checks claims against cited records.
