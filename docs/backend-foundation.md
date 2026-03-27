# Backend Foundation

This document records the chosen backend foundation for the Retell-first real estate voice AI SaaS.

## Stack Decision

Use:

- `Fastify` for the HTTP server and webhook surface
- `TypeScript` for application code
- `PostgreSQL` for system data
- `Drizzle` for schema and migrations
- `zod` for request and environment validation
- `pino` for structured logging

## Why This Stack

- Fastify is a good fit for webhook-heavy and API-heavy backends.
- The stack stays light enough for MVP work.
- Drizzle keeps schema and migration work explicit for tenant-aware tables.
- The backend remains a clean source of truth for Retell tools and n8n automation.

## Initial Backend Shape

```text
app/backend/
  src/
    app.ts
    server.ts
    config/
      env.ts
    db/
      client.ts
      schema/
        tenants.ts
        offices.ts
        listings.ts
        showing-requests.ts
        prompt-versions.ts
        integration-connections.ts
      migrations/
    plugins/
      auth.ts
      db.ts
    modules/
      health/
        routes.ts
      tenants/
        routes.ts
        service.ts
        repository.ts
        types.ts
      offices/
        routes.ts
        service.ts
        repository.ts
        types.ts
      listings/
        routes.ts
        service.ts
        repository.ts
        types.ts
      showing-requests/
        routes.ts
        service.ts
        repository.ts
        types.ts
      retell/
        routes.ts
        service.ts
        types.ts
    lib/
      errors.ts
      logger.ts
      http.ts
  package.json
  tsconfig.json
  drizzle.config.ts
  .env.example
```

## First Build Slice

Build these first:

- Fastify app bootstrap
- PostgreSQL connection
- Drizzle setup
- health endpoint
- initial schema and migration flow
- listing search endpoint
- listing by reference endpoint
- showing request endpoint

## Deliberate Non-Goals For The First Slice

Do not add these yet:

- full customer auth system
- event bus
- queues
- microservices
- heavy abstraction layers
- generic workflow engine
