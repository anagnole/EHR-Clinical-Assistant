# Phase 2: Synthetic Data Generation (Synthea-Based)

## Goal
Parse Synthea-generated CSV data (2000+ patients, seed 42) and produce ground truth Q&A for evaluation.

## Dependencies
- Phase 1 (EHR instance with schema) — for Kuzu ingestion and verification only; generation runs standalone

## Approach
Synthea produces clinically validated synthetic patient data with real SNOMED/LOINC/RxNorm codes. CSVs are pre-generated and committed. Ground truth questions are derived programmatically from the parsed data across 5 question types.

## Data Pipeline
1. Parse 8 Synthea CSVs (patients, encounters, conditions, medications, observations, procedures, providers, organizations)
2. Build per-patient and per-encounter lookup indexes
3. Profile dataset (condition prevalence, observation coverage, co-occurrences)
4. Generate ~240 candidate questions across 5 types
5. Curate 80 evaluation questions (16 per type, balanced by domain, max 4 per patient)
6. Write JSON snapshots for downstream use

## Question Types
- **Simple lookup** (16) — lab values, active medications, conditions, demographics, providers
- **Multi-hop** (16) — medications at diagnosis encounter, procedures at ER visit, lab at first prescription, diagnosing provider
- **Temporal** (16) — lab trends, first diagnosis dates, medication duration, chronological ordering
- **Cohort** (16) — condition co-occurrences, average lab values, medication prevalence, age-group analysis
- **Reasoning** (16) — diabetes control assessment, CKD risk, drug interactions, guideline consistency

## Implementation
- `src/parser/` — CSV reader, type mapping, index building
- `src/questions/` — 5 generators + profiler + orchestrator
- `src/curate.ts` — Stratified selection with domain and patient constraints
- `src/snapshot.ts` — JSON export (streaming for large files)
- `src/generate.ts` — CLI entry point (`npm run generate`)
- `src/ingest.ts` — Kuzu ingestion (deferred, needs Phase 1)
- `src/verify.ts` — Integrity check (deferred, needs Phase 1)

## Status
**Implemented** — `npm run generate` produces 80 curated questions from 244 candidates across 2264 patients.
