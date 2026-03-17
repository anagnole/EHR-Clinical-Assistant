# Phase 5: LLM-Only Baseline

## Goal
No retrieval at all. Tests whether the LLM can answer clinical questions from a flat context dump of the patient record.

## Dependencies
- Phase 2 (synthetic data generated)

## Steps
1. Build prompt builder — serializes a patient's full record (demographics, conditions, medications, labs, encounters, procedures) into structured text
2. Cap context at ~8000 tokens to stay within reasonable limits
3. For cohort questions, build a summary table of all patients instead of a single record
4. Verify prompt output is readable and contains all necessary information

## Tickets
- [030-prompt-builder](../tickets/030-prompt-builder.md)
- [031-cohort-prompt-builder](../tickets/031-cohort-prompt-builder.md)
- [032-prompt-verification](../tickets/032-prompt-verification.md)
