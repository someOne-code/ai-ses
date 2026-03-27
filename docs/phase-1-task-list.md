# Phase 1 Task List

## Milestone

Finish the first backend product slice for:

- listing search
- listing by reference
- showing request creation

## Tasks

1. Generate the first Drizzle migration from the current schema set.
2. Add database run instructions to the backend README or docs later if needed, but do not widen scope now.
3. Create `listings` module with:
   - query param schemas
   - repository filters
   - service methods
   - route registration
4. Create `showing-requests` module with:
   - body schema
   - office and listing ownership checks
   - repository insert logic
   - route registration
5. Register both modules in the Fastify app.
6. Add shared request/response typing for listing list items, listing detail, and showing request create payload.
7. Ensure search defaults to active listings only.
8. Ensure search limit defaults to `5` and clamps to `20`.
9. Ensure listing-by-reference is office-scoped.
10. Ensure showing request creation rejects cross-office listing IDs.
11. Add Fastify injection tests for:
    - health
    - ready
    - listing search
    - listing by reference
    - showing request creation
12. Run:
    - `npm run typecheck`
    - `npm run build`
    - migration generation

## Do Not Do In This Phase

- Retell webhooks
- Retell tools
- n8n flow wiring
- admin panel
- prompt work
- NL search parsing

## Completion Note

Completed on `2026-03-24`.

Done:

- first Drizzle migration generated and applied
- `listings` module added
- `showing-requests` module added
- routes registered in the Fastify app
- shared request and response typing added
- office-scoped search and by-reference behavior enforced
- cross-office showing request protection enforced
- Fastify injection tests added and passing
- `npm run typecheck`, `npm test`, and `npm run build` passing
