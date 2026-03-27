# Phase 1 Plan

## Title

Backend Core For Listings And Showing Requests

## Summary

Use the current Fastify + TypeScript + Drizzle scaffold in `app/backend` as the base and finish the first real product slice.

This phase ends when the backend can do 3 things reliably:

1. search listings for one office with structured filters
2. fetch one listing by office and reference code
3. create a showing request for one office and listing

This phase is backend only. Do not implement Retell tools, n8n flows, or admin UI yet.

Grounding:

- [project-plan.md](/Users/umut/Desktop/ai-ses/docs/project-plan.md)
- [reference-map.md](/Users/umut/Desktop/ai-ses/docs/reference-map.md)
- [backend-foundation.md](/Users/umut/Desktop/ai-ses/docs/backend-foundation.md)

## Key Changes

### Database Slice

Use the current schema set in `src/db/schema` and turn it into the first migration-ready slice.

Keep these tables in phase 1:

- `tenants`
- `offices`
- `phone_number_mappings`
- `prompt_versions`
- `integration_connections`
- `listing_sources`
- `listings`
- `showing_requests`
- `call_logs`
- `audit_events`

Only `tenants`, `offices`, `listings`, and `showing_requests` need active application logic in phase 1.

Schema rules:

- all core records stay tenant-aware through `office_id` or `tenant_id`
- listing lookups are always office-scoped
- `reference_code` is unique per office
- `showing_requests` references both `office_id` and `listing_id`
- `listings.status` is required and defaults to `active`

Migration output:

- generate the first Drizzle migration from the current schema
- do not add runtime seeds or backfills yet

### Backend Modules

Add these modules under `src/modules`:

- `listings`
- `showing-requests`

Each module should use:

- `routes.ts`
- `service.ts`
- `repository.ts`
- `types.ts`

Module responsibilities:

- `listings`
  - validate query params
  - fetch listings from Postgres
  - map DB records to API-safe response shapes
- `showing-requests`
  - validate request body
  - verify listing belongs to office
  - persist request
  - return created request payload

### API Surface

Implement exactly these endpoints:

- `GET /v1/offices/:officeId/listings/search`
- `GET /v1/offices/:officeId/listings/by-reference/:referenceCode`
- `POST /v1/offices/:officeId/showing-requests`

#### Search

Query params:

- `district`
- `neighborhood`
- `listingType`
- `propertyType`
- `minPrice`
- `maxPrice`
- `minBedrooms`
- `minBathrooms`
- `minNetM2`
- `maxNetM2`
- `limit`

Rules:

- all params optional except `officeId`
- default `limit = 5`
- clamp `limit` to a safe max such as `20`
- only return active listings
- sort by `created_at desc`

Search response fields:

- `id`
- `referenceCode`
- `title`
- `listingType`
- `propertyType`
- `price`
- `currency`
- `bedrooms`
- `bathrooms`
- `netM2`
- `district`
- `neighborhood`
- `status`

#### Listing By Reference

Rules:

- exact office-scoped lookup
- return `404` if not found
- return a detailed listing object

Detailed response fields:

- all compact search fields
- `description`
- `grossM2`
- `floorNumber`
- `buildingAge`
- `dues`
- `addressText`
- `hasBalcony`
- `hasParking`
- `hasElevator`

#### Showing Request

Body:

- `listingId`
- `customerName`
- `customerPhone`
- `customerEmail` optional
- `preferredDatetime`

Rules:

- validate `preferredDatetime` as ISO datetime
- verify the listing exists and belongs to the same office
- create request with status `pending`
- return `404` if listing is missing
- return `400` for invalid payload
- return `201` with created request payload

Created response fields:

- `id`
- `officeId`
- `listingId`
- `customerName`
- `customerPhone`
- `customerEmail`
- `preferredDatetime`
- `status`
- `createdAt`

### Validation And Error Handling

Use `zod` for request parsing in both modules.

Keep consistent error behavior:

- `400` for invalid query or body
- `404` for missing listing
- `500` for unexpected failures
- error payload shape stays `{ error: { code, message } }`

Do not add auth, rate limiting, or pagination metadata yet.

### Out Of Phase 1

Do not implement yet:

- Retell webhooks
- Retell function tools
- prompt design
- n8n booking flows
- admin UI
- NL query parsing

## Test Plan

### Route Tests

Use Fastify injection tests for:

- `GET /health` returns `200`
- `GET /ready` returns `200` when DB is reachable
- search returns only listings for the requested office
- search filters work for office, district, listing type, price, and bedrooms
- search limit default and clamp behavior work
- listing by reference is office-scoped
- cross-office listing lookups do not leak
- showing request creation works for a valid office and listing
- showing request fails safely for missing or cross-office listing

### Data Integrity

Verify:

- `reference_code` uniqueness is office-scoped
- search never returns another office’s data
- showing requests cannot be created with office and listing mismatch
- inactive listings are excluded from search

### Build And Migration

Run:

- `npm run typecheck`
- `npm run build`
- Drizzle migration generation

Acceptance:

- backend boots cleanly
- first migration exists
- listing search works with structured filters
- listing by reference works office-scoped
- showing request creation works and persists
- no Retell or n8n dependency is required for this phase

## Assumptions

- keep the current stack: Fastify, TypeScript, Drizzle, PostgreSQL, zod, pino
- use the existing schema set already created in `app/backend`
- phase 1 remains backend-only
- no natural-language query parsing in phase 1
- no customer auth yet
- no runtime seed system unless needed for tests

## Completion Note

Completed on `2026-03-24`.

Delivered:

- office-scoped listing search
- office-scoped listing by reference
- showing request creation
- initial Drizzle migration
- Fastify route tests
- live local Postgres validation for migration application

Locked behavior:

- inactive listings are excluded from search
- inactive listings are not returned by listing-by-reference
