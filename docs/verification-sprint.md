# Verification Sprint

This document defines the narrow verification sprint that should run after the first booking and CRM workflow foundation is in place and before broader admin/operator work begins.

Use it to avoid confusing:

- repo-level safety
- local runtime safety
- true product acceptance

## Why This Exists

The project now has:

- backend-owned contracts
- booking and CRM workflow assets
- local n8n publish and smoke discipline
- Retell-facing webhook persistence proof

But that does not mean every meaningful MVP path is fully proven end to end.

The goal of this sprint is to close the gap between:

- "the pieces exist"
- and
- "the product path is repeatable and believable"

## Scope

Do this before starting major admin/operator UI work.

Focus only on:

- realistic local data
- workflow branch coverage
- backend persistence proof
- repeatable smoke commands

Do not widen into:

- customer self-serve flows
- full external CRM adapters
- full calendar OAuth onboarding
- analytics or billing

## Required Outcomes

### 1. Realistic Demo Seed

Create a small repeatable local seed path with:

- at least one tenant
- at least one active office
- a handful of realistic listings
- at least one phone mapping
- at least one prompt version
- at least one booking workflow connection
- at least one CRM webhook connection

This should support believable local product demos and smoke tests.

Preferred local command path:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo
```

Optional cleanup path:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo -- --cleanup
```

### 2. Booking Branch Coverage

Prove both booking result paths locally:

- unavailable branch
- confirmed branch

Minimum acceptance:

1. wrong trigger secret returns `401`
2. correct trigger secret passes auth
3. booking workflow reaches the expected callback branch
4. backend persistence updates the correct showing request state
5. backend audit evidence is written

### 3. CRM Branch Coverage

Prove all three CRM delivery result paths locally:

- delivered
- failed
- skipped

Minimum acceptance:

1. wrong trigger secret returns `401`
2. correct trigger secret passes auth
3. downstream receiver behavior drives the expected delivery status
4. backend callback route is reached
5. backend audit evidence is written

Preferred local command path:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_CRM_TRIGGER_SECRET="ai-ses-crm-trigger-local-2026"
npm run smoke:n8n-crm-workflow
```

### 4. Retell-Facing Persistence Proof

Keep at least one dashboard-independent Retell verification path that proves:

1. a realistic or officially signed event reaches the backend
2. office resolution works
3. normalized lead qualification fields persist in `call_logs`

Preferred approaches:

- Retell API-driven web call with metadata or dynamic variables
- or officially signed local webhook smoke verification

### 5. Chained Local E2E Path

Add one repeatable local chained verification path that covers:

1. showing request exists
2. booking workflow can update backend state
3. CRM workflow can fan out the resulting event
4. backend audit trail reflects both steps

This does not need a paid phone number.

For the true chained local proof, do not manually trigger the CRM workflow from the test harness. Booking result writeback must hand off to CRM through backend-owned dispatch.

Preferred local command path:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
npm run smoke:n8n-local-chain
```

## Deliverables

- repeatable seed path
- repeatable booking smoke commands
- repeatable CRM smoke commands
- at least one chained local E2E command or documented sequence
- updated runbook/docs so future runs do not depend on tribal knowledge

## Exit Rule

This sprint is complete when:

- a realistic local demo dataset exists
- booking confirmed and unavailable paths are both proven
- CRM delivered, failed, and skipped paths are all proven
- Retell-facing persistence proof exists beyond dashboard chat/audio
- at least one chained local E2E path is documented and repeatable

After that, the next major implementation area can move to admin/operator tooling with much lower verification risk.

## What This Sprint Does Not Prove

This sprint can prove the product path with local and stubbed downstream systems.

It does not by itself prove:

- real CRM-native provider behavior
- provider auth onboarding
- provider-specific rate limits
- provider-specific error bodies outside the normalized local cases

Treat the sprint result as:

1. `stubbed local product acceptance`
   - the internal system logic is believable and repeatable
2. `partial real provider acceptance`
   - one real Google Calendar booking path can be proven separately
   - CRM-native provider behavior still needs a dedicated later pass

## Required Follow-On After This Sprint

After this sprint closes, keep these next acceptance layers explicit:

### 1. Retell Voice Behavior Review

This is separate from backend persistence.

Use it to review:

- whether the agent qualifies correctly
- whether the agent calls the right tool
- whether the agent chooses handoff at the right time
- whether interruption and pacing feel natural

Acceptable evidence:

- Retell `Test Audio`
- Retell `Test Chat`
- transcript inspection
- tool-call traces

This is a conversation-quality review layer, not backend acceptance.

### 2. Real Provider Acceptance

After listing onboarding is in place, run a separate provider-facing verification pass.

Recommended order:

1. first real calendar provider
   - preferred first provider: `Google Calendar`
2. later CRM-native provider only if needed

That pass should prove:

- real provider auth works
- availability and booking side effects are real
- provider failures still normalize correctly
- backend and workflow visibility remain intact

Current status:

- first real calendar provider path: `Google Calendar`
- accepted proof target:
  - existing `ai-ses - Booking Flow`
  - official n8n Google Calendar node
  - existing local OAuth credential
  - backend writeback still visible after provider-side event creation
