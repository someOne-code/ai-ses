# Local n8n Runbook

Use this document when running or debugging the local n8n instance for this repo.

This is a runtime runbook, not product source of truth.

## Why This Exists

Local n8n can appear healthy while workflow runtime still fails because of:

- missing process env
- blocked env access in expressions
- backend callback host mismatch
- assuming the wrong webhook URL after import

Do not rediscover these by trial and error.

## Repo-Owned Local Runtime Files

Keep local n8n runtime config in the repo, not scattered across ad hoc shell env.

Authoritative local files:

- env template: [infra/n8n/.env.local.example](/Users/umut/Desktop/ai-ses/infra/n8n/.env.local.example)
- local env: `infra/n8n/.env.local`
- startup script: [scripts/start-local-n8n.ps1](/Users/umut/Desktop/ai-ses/scripts/start-local-n8n.ps1)

Legacy convenience wrapper:

- `C:\Users\umut\.n8n\start-ai-ses-n8n.ps1`

That wrapper should only delegate to the repo-owned startup script.

## Phase 3 Proven Local Runtime

The local booking workflow smoke was proven with these runtime assumptions:

- n8n runs as a local process
- backend runs locally
- n8n expressions are allowed to read env
- backend callback target is reachable from the n8n process

## Required Local n8n Env

Minimum proven values for the local runtime:

```env
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
N8N_BOOKING_TRIGGER_SECRET=ai-ses-booking-trigger-local-2026
N8N_CRM_TRIGGER_SECRET=ai-ses-crm-trigger-local-2026
N8N_BOOKING_CALLBACK_SECRET=ai-ses-booking-local-2026
N8N_CRM_CALLBACK_SECRET=ai-ses-crm-local-2026
AI_SES_BACKEND_BASE_URL=http://127.0.0.1:3000
```

These should live in `infra/n8n/.env.local`, not only in user-level environment variables.

Notes:

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is required because the workflow uses `$env...` in node expressions.
- `AI_SES_BACKEND_BASE_URL` should use `127.0.0.1` for the proven local booking smoke path.
- `N8N_CRM_TRIGGER_SECRET` and `N8N_CRM_CALLBACK_SECRET` should both be present in the local runtime before CRM workflow smoke work begins.
- For the true chained booking -> CRM local proof, the backend process must also have `N8N_CRM_TRIGGER_SECRET` available so booking result writeback can dispatch the resulting CRM event through the backend-owned path.

## Launch Rule

Load env from `infra/n8n/.env.local` before starting the n8n process.

If you change these variables, fully restart n8n.

Do not assume a running n8n process has picked up newly written user env values.

Preferred launch command:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\umut\Desktop\ai-ses\scripts\start-local-n8n.ps1
```

Do not rely on random terminals with manually exported env values.

## Pre-Smoke Checklist

Before workflow smoke tests:

1. backend health must return `200` at `http://localhost:3000/health`
2. local n8n UI must be reachable at `http://localhost:5678`
3. target workflow must exist in local n8n
4. target workflow must be active

## Repo-Owned Command Paths

Use these commands instead of ad hoc local setup:

Seed realistic local demo data:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo
```

Clean up the local demo seed:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run seed:local-demo -- --cleanup
```

Run the live booking workflow smoke:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
npm run smoke:n8n-booking-workflow
```

Unset those temporary shell variables after the smoke if needed.

Run the real Google Calendar booking acceptance smoke:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_PROVIDER_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
$env:N8N_GOOGLE_CALENDAR_ID="<actual calendar id from the connected Google Calendar credential>"
npm run smoke:n8n-booking-google-calendar
```

This command:

- uses the existing published `ai-ses - Booking Flow`
- uses the official Google Calendar node with the already-connected `Google Calendar account` credential
- proves a real Google-backed success path and a real provider-backed failure path
- still verifies backend booking writeback and audit evidence

Important:

- use the actual Google Calendar ID visible to the connected credential, not a guessed `primary` value
- the smoke may create a real calendar event and should clean it up after verification

Run the live CRM workflow smoke:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_CRM_TRIGGER_SECRET="ai-ses-crm-trigger-local-2026"
npm run smoke:n8n-crm-workflow
```

This command proves the existing published CRM workflow against the live registered route and covers:

- wrong-secret `401`
- delivered
- failed
- skipped

Run the chained local booking -> CRM verification:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
$env:RUN_N8N_SMOKE_TESTS="1"
$env:N8N_BOOKING_TRIGGER_SECRET="ai-ses-booking-trigger-local-2026"
npm run smoke:n8n-local-chain
```

This command:

- reseeds the local demo dataset
- uses the actual live registered booking and CRM webhook routes
- proves booking writeback first
- proves the backend-owned booking -> CRM handoff and CRM delivery writeback second
- cleans up the demo seed after the chained run

Important:

- the shell command above only needs `N8N_BOOKING_TRIGGER_SECRET` for the direct booking workflow trigger
- the backend process itself must already have `N8N_CRM_TRIGGER_SECRET` loaded from `app/backend/.env` or equivalent startup env, because CRM dispatch now happens from backend-owned logic after booking writeback

## Webhook Registration Rule

Do not assume the live webhook URL is always just:

```text
/webhook/<path>
```

For imported workflows, the live registered route may include the workflow id prefix.

For local runtime verification, prove the actual registered route from live n8n state before testing.

Accepted proof sources:

- n8n Public API workflow payload
- local n8n sqlite `webhook_entity`

## Booking Workflow Smoke Acceptance

Minimum acceptable local smoke proof for `ai-ses - Booking Flow`:

1. wrong trigger secret returns `401`
2. correct trigger secret passes the auth gate
3. workflow reaches a callback branch
4. backend writeback happens
5. backend audit event is persisted

Callback writeback nuance:

- backend callback/writeback is best-effort in the project-owned booking and CRM workflows
- if provider or downstream side effects already happened and the backend callback fails afterward, the workflow should still return `200`
- in that case the workflow response must report `callbackAccepted: false` instead of failing the whole workflow response

Repo-only tests are not enough for this step.

## Failure Pattern: Env Access Denied

If a workflow node fails with:

```text
access to env vars denied
```

first suspect:

```env
N8N_BLOCK_ENV_ACCESS_IN_NODE=true
```

or an equivalent runtime process state.

Fix the process env and restart n8n before debugging the workflow itself.

## Scope Reminder

This runbook is for local runtime consistency only.

Do not move product rules, tenant ownership, or backend source-of-truth decisions into this file.
