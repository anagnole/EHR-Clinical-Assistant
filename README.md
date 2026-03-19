# ThesisBrainifai

Thesis experiment testing whether **graph-based retrieval improves LLM clinical question answering** compared to SQL and LLM-only baselines.

ThesisBrainifai is a [Brainifai](https://github.com/anagnole/brainifai) child instance — a specialized node with a custom EHR template, its own graph schema, custom context-building MCP tools, and an evaluation harness.

## Architecture

```
Synthea (2000+ patients, seed 42)
        │
        ▼
┌───────────────┐     ┌────────────────┐
│  CSV Parser    │────▶│  JSON Snapshot  │
│  src/generate  │     │  data/generated │
└───────────────┘     └────────┬───────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
     ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
     │  Kuzu Graph   │  │ PostgreSQL  │  │  LLM-Only    │
     │  .brainifai/  │  │  Docker     │  │  (no retrieval)│
     │  data/kuzu    │  │  port 5432  │  │              │
     └──────┬───────┘  └──────┬──────┘  └──────┬───────┘
            │                 │                 │
            ▼                 ▼                 ▼
     ┌──────────────────────────────────────────────┐
     │           Evaluation Harness (80 questions)   │
     │   4 runners × 5 question types × scoring      │
     └──────────────────────────────────────────────┘
```

## Graph Schema

**7 node tables:** Patient, Encounter, Condition, Medication, Observation, Procedure, Provider

**12 relationships:** Patient→Encounter, Encounter→Condition, Encounter→Medication, Encounter→Observation, Encounter→Procedure, Encounter→Provider, and more

FTS indexes on patient names, condition descriptions, medication names, and observation descriptions.

## Question Types

| Type | Description | Count |
|------|-------------|-------|
| **simple-lookup** | Direct fact retrieval (e.g., "What medications is patient X on?") | 16 |
| **multi-hop** | Requires traversing multiple relationships | 16 |
| **temporal** | Time-based reasoning (e.g., "Was drug X started before condition Y?") | 16 |
| **cohort** | Population-level queries (e.g., "How many diabetic patients are on metformin?") | 16 |
| **reasoning** | Clinical inference from retrieved data | 16 |

80 questions curated from 244 candidates, stratified across clinical domains with deterministic selection.

## Prerequisites

- **Node.js** >= 18
- **Docker** (for PostgreSQL baseline)
- **Synthea** CSV output in `data/synthea/` (seed 42, 2000+ alive patients)
- **Anthropic API key** (for evaluation runners)

## Setup

```bash
# Install dependencies
npm install

# Start PostgreSQL (baseline)
npm run pg:up
```

## Pipeline

The pipeline runs in order: generate → ingest → verify → evaluate.

### 1. Generate synthetic data & questions

Parses Synthea CSVs, profiles the dataset, generates 244 candidate questions, curates 80 for evaluation, and writes JSON snapshots to `data/generated/`.

```bash
npm run generate
```

**Outputs:** `patients.json`, `providers.json`, `ground-truth.json`, `evaluation-questions.json`, `stats.json`

### 2. Ingest into databases

```bash
# Ingest into Kuzu graph
npm run ingest

# Ingest into PostgreSQL
npm run pg:ingest
```

### 3. Verify data integrity

```bash
# Verify Kuzu graph (node counts, relationships, FTS, sample patients)
npm run verify

# Verify PostgreSQL tables
npm run pg:verify

# Verify prompt builder output
npm run prompt:verify
```

### 4. Run evaluation

Runs all 80 questions against 4 systems (graph, sql, sql-fts, llm-only), scores answers, and generates reports.

```bash
npm run eval
```

**Outputs in `results/`:**
- `summary.md` — Overall and per-type/domain score tables
- `summary.json` — Structured results with per-question detail
- `per-question.csv` — Flat export for analysis

## MCP Server

ThesisBrainifai exposes 7 clinical retrieval tools via MCP:

| Tool | Description |
|------|-------------|
| `search_patients` | Find patients by name or demographics |
| `get_patient_summary` | Full patient overview (conditions, meds, labs) |
| `get_diagnoses` | Active and historical diagnoses |
| `get_medications` | Current and past medications |
| `get_labs` | Lab results and observations |
| `get_temporal_relation` | Temporal relationships between clinical events |
| `find_cohort` | Find patient groups matching clinical criteria |

```bash
# Start the MCP server
./start-mcp.sh
```

## Preliminary Results

| System | Score | Avg Latency | Errors |
|--------|-------|-------------|--------|
| **graph** | **80.7%** | 12,213ms | 0 |
| sql | 76.0% | 4,766ms | 0 |
| sql-fts | 76.0% | 4,843ms | 0 |
| llm-only | 76.0% | 4,950ms | 0 |

> Only simple-lookup questions evaluated so far. Multi-hop, temporal, cohort, and reasoning types pending.

## Project Structure

```
├── data/
│   ├── synthea/          # Raw Synthea CSV output (gitignored)
│   └── generated/        # JSON snapshots (gitignored)
├── docs/
│   ├── plan.md           # Implementation plan
│   ├── phases/           # Phase specs (1-6)
│   └── tickets/          # 41 implementation tickets
├── results/              # Evaluation output
├── src/
│   ├── generate.ts       # Entry: parse CSVs → generate questions
│   ├── ingest.ts         # Entry: load JSON → Kuzu graph
│   ├── verify.ts         # Entry: round-trip data verification
│   ├── snapshot.ts       # Write generated data to JSON
│   ├── curate.ts         # Select 80 questions from candidates
│   ├── parser/           # Synthea CSV reader
│   ├── questions/        # Question generators (5 types)
│   ├── prompt/           # LLM-only prompt builder
│   ├── sql/              # PostgreSQL schema, ingestion, adapters
│   └── eval/             # Evaluation runner, scorer, report
├── docker-compose.yml    # PostgreSQL 16
├── start-mcp.sh          # MCP server launcher
└── package.json
```

## Tech Stack

- **TypeScript** with tsx for execution
- **Kuzu** — Embedded graph database for EHR data
- **PostgreSQL 16** — Relational baseline (standard + FTS)
- **Anthropic API** — LLM runners and LLM-as-judge scoring
- **MCP** — Model Context Protocol for tool-based retrieval
- **Synthea** — Synthetic patient data generation
