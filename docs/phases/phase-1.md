# Phase 1: EHR Instance Setup

## Status
**Pending** — requires Brainifai Phases 1-3.

## Goal
Create a Brainifai child instance with a custom "ehr" template. Define the EHR graph schema (7 node tables, 12 relationships, FTS indexes) and extend the GraphStore adapter with EHR-specific queries.

## Dependencies
- Brainifai Phase 2 (CLI & instance model)
- Brainifai Phase 3 (multi-instance Kuzu)

## Steps
1. Create the ThesisBrainifai instance via `brainifai init --template ehr` (or register manually if template system isn't ready yet)
2. Define the EHR graph schema — 7 node tables (Patient, Encounter, Condition, Medication, Observation, Procedure, Provider) and 12 relationship tables
3. Create FTS indexes on key searchable fields (patient names, condition descriptions, medication names, etc.)
4. Extend the base GraphStore adapter with EHR-specific query methods (getPatientSummary, getPatientMedications, getPatientConditions, getPatientLabs, getTemporalRelation, findCohort)
5. Write the instance description for registration with the global Brainifai instance
6. Verify schema creation and basic CRUD operations

## Tickets
- [001-create-ehr-instance](../tickets/001-create-ehr-instance.md)
- [002-ehr-graph-schema](../tickets/002-ehr-graph-schema.md)
- [003-fts-indexes](../tickets/003-fts-indexes.md)
- [004-ehr-graphstore-extension](../tickets/004-ehr-graphstore-extension.md)
- [005-instance-description](../tickets/005-instance-description.md)
- [006-schema-verification](../tickets/006-schema-verification.md)
