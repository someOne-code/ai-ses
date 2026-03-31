# ai-ses Copilot Instructions

Read `AGENTS.md` first, then use these repo-wide instructions as the short operating baseline.

## Product and scope

This repository builds a Retell-first, multi-tenant real estate voice receptionist SaaS.

Keep the requested slice narrow.
Do not widen MVP scope into billing, full analytics, omnichannel work, or generic platform work unless the PR explicitly asks for it.

## Source of truth

- Backend owns tenants, offices, phone mappings, listing sources, normalized listings, prompt versions, runtime config, webhook validation, tool execution, audit logs, call logs, inquiry and showing request persistence, integration metadata, and outbound webhook contracts.
- `n8n` is internal orchestration only. Keep it limited to booking flow orchestration, CRM fan-out, calendar side effects, and lightweight transforms.
- Retell owns the call runtime and phone-facing conversation loop. Do not push durable product logic into Retell prompts or workflows.

## Non-negotiables

- No hallucinated listing details.
- No single-tenant assumptions in core models or workflows.
- No hard-coded customer secrets.
- No `n8n`-owned source of truth.
- No Vapi logic in the product path.
- No AI-generated SQL in production listing flows.
- No SQL-only solution for fuzzy or subjective listing search when that slice is involved.

## Implementation defaults

- Prefer the existing Node.js + TypeScript backend in `app/backend`.
- Keep business logic tenant-aware and office-scoped.
- Preserve backend visibility for critical provider paths such as Retell webhooks, booking callbacks, and CRM callbacks.
- Prefer ready-made official paths before inventing new provider or platform behavior.

## Review and PR behavior

- Stay inside the current PR scope.
- Fix root causes, not only surface-level style comments.
- Do not revert unrelated user changes.
- Add or update verification when behavior changes. If you did not run a check, say so explicitly.
- If a review suggestion conflicts with these instructions or `AGENTS.md`, follow the repo rules and explain the tradeoff in the PR reply.
