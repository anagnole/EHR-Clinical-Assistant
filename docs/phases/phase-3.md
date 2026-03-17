# Phase 3: Custom MCP Tools

## Goal
Build 7 graph retrieval tools registered as the EHR instance's custom context-building functions. All tools return record_ids for citation tracking.

## Dependencies
- Phase 1 (EHR instance with GraphStore extensions)

## Steps
1. Register 7 custom MCP tools with the instance's MCP server:
   - search_patients — FTS search on patient names/city
   - get_patient_summary — graph traversal for demographics + active conditions + medications + recent encounters
   - get_medications — patient medication list with status/date filters
   - get_diagnoses — patient condition list with status filter
   - get_labs — patient lab results with code/date filters
   - get_temporal_relation — path traversal for temporal reasoning (e.g., "labs within 30 days of starting metformin")
   - find_cohort — multi-hop intersection query across entity types
2. Every tool response includes record_ids array for citation tracking and hallucination detection
3. Apply safety limits (max results, timeout, truncation) from Brainifai base
4. Test each tool manually with Claude to verify usability

## Tickets
- [015-search-patients-tool](../tickets/015-search-patients-tool.md)
- [016-patient-summary-tool](../tickets/016-patient-summary-tool.md)
- [017-medications-tool](../tickets/017-medications-tool.md)
- [018-diagnoses-tool](../tickets/018-diagnoses-tool.md)
- [019-labs-tool](../tickets/019-labs-tool.md)
- [020-temporal-relation-tool](../tickets/020-temporal-relation-tool.md)
- [021-find-cohort-tool](../tickets/021-find-cohort-tool.md)
- [022-tool-testing](../tickets/022-tool-testing.md)
