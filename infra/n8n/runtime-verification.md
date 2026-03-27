# n8n Runtime Verification

Use this for project-owned `ai-ses - ...` workflows after import or update.

## Do Not Assume

- Do not assume the live webhook is `/webhook/<node-path>`.
- Resolve the actual registered route from live n8n runtime state.
- For local verification, the canonical source is the `webhook_entity` row in:
  - `C:\Users\umut\.n8n\database.sqlite`

## Booking Flow

Current project-owned workflow:

- name: `ai-ses - Booking Flow`

Live runtime verification must prove all of these:

1. the workflow exists and is active in n8n
2. the live webhook route is registered
3. wrong trigger secret returns `401`
4. correct trigger secret gets past auth
5. backend callback writeback succeeds

## Env Access

The booking workflow uses `$env` in expressions for:

- `N8N_BOOKING_TRIGGER_SECRET`
- `N8N_BOOKING_CALLBACK_SECRET`
- `AI_SES_BACKEND_BASE_URL`

If local n8n blocks env access in workflow expressions, the workflow will fail at runtime even if the route is registered.

Local verification should therefore prove:

- route registration
- env-backed auth execution

Not only asset shape.

## Local Host Note

For local Windows smoke runs, prefer:

- `AI_SES_BACKEND_BASE_URL=http://127.0.0.1:3000`

instead of `http://localhost:3000` if n8n reports backend callback connection refusal.

## Repo Smoke Test

Run from [app/backend](C:/Users/umut/Desktop/ai-ses/app/backend):

```powershell
$env:RUN_N8N_SMOKE_TESTS='1'
$env:N8N_BOOKING_TRIGGER_SECRET='<live-trigger-secret>'
npm.cmd run smoke:n8n-booking-workflow
```

This smoke test:

- resolves the workflow by name from live n8n
- reads the actual registered webhook path from `webhook_entity`
- verifies wrong-secret `401`
- runs a safe local unavailable-slot branch
- verifies backend booking callback writeback into PostgreSQL
