# Phase 4: PostgreSQL Baseline

## Goal
Same data in relational tables with SQL-based retrieval for fair comparison against graph. Two variants: SQL-only and SQL+FTS.

## Dependencies
- Phase 2 (synthetic data generated with JSON snapshot)

## Steps
1. Set up PostgreSQL 16 via Docker Compose
2. Create relational schema — 7 tables mirroring the graph node tables, with foreign keys and indexes
3. Add FTS indexes (tsvector/tsquery) for the SQL+FTS variant
4. Ingest generated JSON data into PostgreSQL
5. Build SQL adapter — 7 retrieval functions equivalent to the MCP graph tools, using JOINs
6. Build SQL+FTS adapter variant — same functions but using full-text search for text matching
7. Verify query results match graph results for simple cases

## Tickets
- [023-postgres-docker-setup](../tickets/023-postgres-docker-setup.md)
- [024-sql-schema](../tickets/024-sql-schema.md)
- [025-sql-fts-indexes](../tickets/025-sql-fts-indexes.md)
- [026-postgres-data-ingestion](../tickets/026-postgres-data-ingestion.md)
- [027-sql-adapter](../tickets/027-sql-adapter.md)
- [028-sql-fts-adapter](../tickets/028-sql-fts-adapter.md)
- [029-baseline-verification](../tickets/029-baseline-verification.md)
