# Phase 3 Plan

## Title

Booking And CRM Sync Foundation

## Summary

Phase 1 delivered the backend core.
Phase 2 delivered hybrid listing search.

The next MVP phase is not more search work.
It is the first real operations layer:

1. booking orchestration for showing requests
2. CRM sync for leads and call outcomes
3. backend-owned integration contracts so n8n stays glue, not source of truth

This phase must stay narrow.
Do not build admin UI, full calendar auth, or outbound campaigns here.

Grounding:

- [project-plan.md](/Users/umut/Desktop/ai-ses/docs/project-plan.md)
- [reference-map.md](/Users/umut/Desktop/ai-ses/docs/reference-map.md)
- [agent-playbook.md](/Users/umut/Desktop/ai-ses/docs/agent-playbook.md)
- [local-n8n-runbook.md](/Users/umut/Desktop/ai-ses/docs/local-n8n-runbook.md)
- [verification-sprint.md](/Users/umut/Desktop/ai-ses/docs/verification-sprint.md)

## Phase Goal

This phase ends when the product has a clean MVP path for:

1. creating a showing request in the backend
2. handing that request into an internal booking workflow
3. writing a normalized booking result back into the backend
4. sending normalized lead or call outcome events into a generic CRM sync workflow

The backend remains the source of truth.
n8n remains internal workflow glue.

## Scope

### Backend Owns

- office-level integration connection lookup
- normalized event payloads for booking and CRM sync
- protected callback routes for n8n result writeback
- audit-friendly persistence of booking outcomes and CRM delivery outcomes

### n8n Owns

- booking workflow steps
- calendar availability checks
- alternate slot suggestion flow
- CRM fan-out
- email or SMS side effects if needed later
- high-intent owner alert side effects if product rules decide an office owner should be notified

### Retell Owns

- collecting caller intent
- creating showing request through backend tools
- reading short outcomes back to the caller

## Key Changes

### 1. Integration Contract Slice

Use the existing `integration_connections` table as the office-owned integration registry.

MVP integration kinds for this phase:

- `booking_workflow`
- `crm_webhook`

Each office should be able to resolve an active connection for those kinds without moving source of truth into n8n.

Do not build a full generic plugin system.

### 2. Booking Flow Slice

Start from the local booking workflow reference:

- [booking-workflow-reference.json](/Users/umut/Desktop/ai-ses/infra/n8n/booking-workflow-reference.json)
- legacy source pattern: `references/ai-receptionist-agent`

Convert it into a project-owned workflow shape:

- `ai-ses - Booking Flow`

Backend flow shape:

1. backend creates `showing_request`
2. backend or internal trigger hands off a normalized booking payload
3. n8n checks availability and suggests alternatives if needed
4. n8n posts a narrow result back to the backend

Do not let n8n own showing request records.

### 3. CRM Sync Slice

Start from a generic webhook fan-out approach.

Source patterns:

- `references/outbound-real-estate-voice-ai-extracted`
- `references/n8n-nodes-retellai`

Project-owned workflow shape:

- `ai-ses - CRM Sync`

Backend event candidates for MVP:

- showing request created
- showing booking confirmed or failed
- call completed with normalized summary or status

Normalized lead qualification for MVP should stay simple and explicit:

- `leadIntent`
  - example values: `listing_question`, `showing_request`, `general_inquiry`, `handoff_request`
- `leadTemperature`
  - `cold`
  - `warm`
  - `hot`
- `handoffRecommended`
  - boolean
- `budgetKnown`
  - boolean
- `locationKnown`
  - boolean
- `timelineKnown`
  - boolean

This is not a sales-scoring engine.
It is a narrow structured summary for CRM sync and operator visibility.

Do not build CRM-specific deep integrations in this phase.
Use generic webhook delivery first.

### 3A. High-Intent Alert Follow-On

After the verification sprint closes the main booking and CRM confidence gaps, a narrow follow-on ops slice may add owner notifications for high-intent leads.

Guidelines:

- backend decides the alert condition
- n8n performs the side-effect only
- alert logic should key off explicit backend-owned fields such as:
  - `leadTemperature = hot`
  - `handoffRecommended = true`
  - optionally office-defined urgency rules later
- notify through a simple channel first such as SMS, WhatsApp, email, or Slack
- avoid duplicate alert spam; cooldown and idempotency matter

This is an operational acceleration feature, not a replacement for CRM sync or showing request persistence.

### 4. Callback And Audit Slice

The backend should accept narrow n8n result callbacks for:

- booking result
- CRM delivery result

Rules:

- secret-protected
- office-scoped
- no blind trust in workflow payloads
- persist enough state to audit success or failure

### 5. Workflow Asset Slice

Create project-owned workflow assets under `infra/n8n`.

Rules:

- use `ai-ses - ...` naming
- no live secrets in committed JSON
- do not overwrite legacy local workflows
- keep workflow logic thin and explicit
- prefer one project-owned workflow per business flow, not one mega workflow for the whole product
- for this phase, `ai-ses - Booking Flow` and `ai-ses - CRM Sync` should stay separate top-level workflows
- only extract shared sub-workflows after real repetition appears; do not over-modularize the first pass

### 6. Retell Verification Slice

Do not treat Retell dashboard `Test Chat` or `Test Audio` as final acceptance proof for backend writeback.

Those surfaces are useful for quick prompt checks, but they may not produce the same webhook and persistence behavior as a real call path.

For production-facing verification, require an API-driven or webhook-driven smoke path that proves:

1. Retell sends a real or realistically signed event into the backend-owned webhook surface
2. the backend resolves office context correctly
3. normalized post-call fields persist into backend storage
4. the same path can be rerun before production without relying on a paid phone number

Preferred verification path:

- Retell API driven web call or equivalent event path with `metadata` or `retell_llm_dynamic_variables`
- or a backend smoke harness that uses the official Retell webhook signature format and verifies DB persistence end to end

Do not rely on dashboard playground behavior alone.

Retell verification should be split into two explicit categories:

1. `voice behavior verification`
   - tests whether the agent asks the right questions
   - tests whether the agent chooses the right tool or handoff path
   - tests interruption, pacing, and conversation quality
   - may use Retell dashboard `Test Audio`, `Test Chat`, transcript inspection, or tool-call traces
   - is useful for prompt and runtime behavior review
   - is not enough to prove backend persistence
2. `backend persistence verification`
   - proves webhook ingestion, office resolution, DB writeback, workflow handoff, and audit visibility
   - must use an API-driven, webhook-driven, or equivalently realistic backend-visible path
   - is required for product acceptance

Both categories matter.
Only the second category is sufficient for backend acceptance.

### 7. Local Runtime Discipline

Do not treat local n8n launch state as tribal knowledge.

For workflow import and smoke work:

- pin the required local n8n env in [local-n8n-runbook.md](/Users/umut/Desktop/ai-ses/docs/local-n8n-runbook.md)
- prove backend health before workflow smoke
- prove the actual registered webhook path from the live instance instead of assuming `/webhook/<path>`
- treat process env and runtime registration as part of acceptance, not as invisible setup

## Out Of Phase 3

Do not implement yet:

- customer-facing admin UI
- full calendar provider settings UX
- outbound sales campaigns
- Airtable-specific product assumptions
- customer self-serve CRM installers
- cross-encoder reranking or more search work

## Acceptance

This phase is acceptable when:

- backend can resolve office-owned booking and CRM integration connections
- booking workflow contract is explicit and project-owned
- CRM sync workflow contract is explicit and project-owned
- n8n callback routes are secret-protected and office-scoped
- backend remains the source of truth for lead, showing, and call records
- no legacy workflow is modified in place
- Retell-facing verification includes at least one webhook or API-driven smoke path that proves backend persistence beyond dashboard playground tests

## Completion Rule

Start with the backend integration contract and callback surface first.
Only after that should workflow JSON assets be produced or adapted.

Before major admin/operator tooling work begins, run the verification sprint in [verification-sprint.md](/Users/umut/Desktop/ai-ses/docs/verification-sprint.md) so branch coverage and chained local E2E confidence are in place.

After the verification sprint closes, prioritize the first listing ingestion slice before major admin/operator tooling work:

1. v1 listing ingestion via `CSV/XLSX import -> backend normalize -> Postgres upsert -> listing_search_documents sync`
2. then broader admin/operator tooling

Do not jump straight into admin UI if customer listing data still has no practical onboarding path.

After the verification sprint closes, treat real provider validation as a separate follow-on acceptance layer.

Use this order:

1. stubbed local acceptance
   - proves backend contracts, workflow branches, writeback, and audit behavior
2. first real provider acceptance
   - prove one real calendar provider path first
   - preferred first provider: `Google Calendar`
3. later CRM-native provider acceptance if needed
   - only after generic webhook CRM sync is already operationally useful

Do not confuse stubbed local proof with real vendor proof.
Stubbed local proof is required first because it validates product logic cheaply and repeatably.
Real provider proof is still required later because it validates auth, transport, provider-specific error shapes, and live side effects.
