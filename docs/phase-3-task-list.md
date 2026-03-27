# Phase 3 Task List

This task list covers the first booking and CRM sync implementation pass after hybrid search.

## Phase 3A: Contracts And Ownership

- document the MVP integration kinds backed by `integration_connections`
- define the normalized payload for `booking_workflow`
- define the normalized payload for `crm_webhook`
- define the MVP lead qualification fields for CRM payloads:
  - `leadIntent`
  - `leadTemperature`
  - `handoffRecommended`
  - `budgetKnown`
  - `locationKnown`
  - `timelineKnown`
- define the narrow callback payload for booking results coming back from n8n
- define the narrow callback payload for CRM delivery results coming back from n8n
- keep backend ownership explicit for tenant, office, showing request, and call log state

## Phase 3B: Backend Integration Surface

- add a backend module for integration connection resolution if needed
- resolve active office-scoped integration connections by kind
- add secret-protected n8n callback routes for booking result writeback
- add secret-protected n8n callback routes for CRM delivery writeback
- persist normalized booking or CRM outcome state in backend-owned records or audit events
- do not introduce a full auth system for this slice

## Phase 3C: Booking Workflow Asset

- inspect `infra/n8n/booking-workflow-reference.json`
- extract only the useful booking pattern
- rebuild it as a project-owned `ai-ses - Booking Flow`
- keep it as its own top-level booking workflow, not as one branch inside a mega all-in-one workflow
- replace assistant-specific or legacy wording with Retell-first naming
- keep calendar logic and alternate-slot behavior explicit
- remove live secrets and unrelated nodes

## Phase 3D: CRM Sync Workflow Asset

- inspect `infra/n8n/outbound-real-estate-workflow-reference.json`
- extract only the useful CRM fan-out and follow-up patterns
- rebuild it as a project-owned `ai-ses - CRM Sync`
- keep it as its own top-level CRM workflow, separate from booking
- keep the trigger backend-owned
- prefer generic webhook fan-out over CRM-specific hard-coding
- remove outbound marketing assumptions that do not belong in MVP

## Phase 3E: Testing And Verification

- add backend tests for office-scoped integration resolution
- add backend tests for callback secret validation
- add backend tests for booking result persistence
- add backend tests for CRM delivery result persistence
- add a Retell-facing smoke path that proves webhook ingestion and DB persistence without relying on dashboard `Test Chat` alone
- prefer Retell API driven web call testing or officially signed webhook smoke verification over dashboard playground checks
- verify lead qualification fields persist in `call_logs` after a realistic Retell event with resolved office context
- verify workflow JSON assets contain no live credentials
- verify legacy workflows were not modified in place

## Immediate Next Step: Verification Sprint

- create a realistic local demo seed path
- prove booking unavailable and confirmed branches
- prove CRM delivered, failed, and skipped branches
- keep at least one Retell-facing backend persistence proof beyond dashboard chat/audio
- add one chained local E2E path that covers showing request -> booking result -> CRM fan-out
- document repeatable commands in [verification-sprint.md](/Users/umut/Desktop/ai-ses/docs/verification-sprint.md)

## Recommended Order

1. Phase 3A contracts
2. Phase 3B backend callback surface
3. Phase 3C booking workflow asset
4. Phase 3D CRM sync workflow asset
5. Phase 3E verification
6. Verification sprint closeout
7. v1 listing ingestion before major admin/operator work
8. major admin/operator work after listing onboarding exists

## Immediate Follow-On After Verification Sprint

- implement v1 listing ingestion with `CSV/XLSX import -> backend normalize -> Postgres upsert -> listing_search_documents sync`
- keep it backend-owned
- do not start with customer-specific live database connectors
- do not jump to major admin/operator UI before this onboarding path exists

## Open Decisions

- whether booking result persistence updates `showing_requests` directly or only writes audit events in the first pass
- whether CRM delivery acknowledgements should touch `call_logs`, `audit_events`, or both
- whether one shared n8n callback secret is enough for MVP or per-flow secrets are needed
- whether the long-term Retell smoke path should use `createWebCall`, signed local webhook fixtures, or both
- whether any repeated helper logic is common enough to justify a later shared sub-workflow

## Not In Scope For This Slice

- admin screens for integration setup
- full calendar OAuth onboarding
- deep CRM-native node integrations
- outbound marketing campaigns
- customer self-serve workflow editing
