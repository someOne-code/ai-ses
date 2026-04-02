# Local Postgres Runbook

Use this document when the local `ai-ses` backend needs the hybrid search path with `pgvector`.

This is a runtime runbook, not product source of truth.

## Why This Exists

The local smoke path now depends on a Postgres runtime that supports:

- `CREATE EXTENSION vector`
- `vector(1536)` columns
- cosine-distance queries from `listing_search_documents.embedding`

The native Windows PostgreSQL process previously used from:

- `app/backend/.tmp/postgres-data`

does not ship with `vector.control`, so local hybrid search can fail with:

- `type "vector" does not exist`

## Repo-Owned Local Runtime

Authoritative local files:

- env template: [infra/postgres/.env.local.example](/Users/umut/Desktop/ai-ses/infra/postgres/.env.local.example)
- local env: [infra/postgres/.env.local](/Users/umut/Desktop/ai-ses/infra/postgres/.env.local)
- compose file: [infra/postgres/compose.yaml](/Users/umut/Desktop/ai-ses/infra/postgres/compose.yaml)
- startup script: [scripts/start-local-postgres.ps1](/Users/umut/Desktop/ai-ses/scripts/start-local-postgres.ps1)

Default runtime:

- image: `pgvector/pgvector:pg17`
- host port: `5433`
- database: `ai_ses`
- user: `postgres`

## Launch Rule

Use the repo-owned startup script instead of the old native `.tmp/postgres-data` process.

Preferred launch command:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\umut\Desktop\ai-ses\scripts\start-local-postgres.ps1
```

The script will:

1. load `infra/postgres/.env.local`
2. start Docker Desktop if needed
3. stop the legacy native postgres process only if it is the known repo-local `.tmp/postgres-data` runtime on port `5433`
4. reuse the expected Docker container safely if Docker already owns `5433`
5. start the Dockerized pgvector Postgres runtime
6. wait for container health
7. run `CREATE EXTENSION IF NOT EXISTS vector;` in the local `ai_ses` database

## Post-Startup Commands

After the DB is up:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
npm run db:migrate
npm run seed:local-demo
```

## Verification

Minimum runtime proof:

```powershell
docker exec ai-ses-postgres psql -U postgres -d ai_ses -c "select extname from pg_extension where extname = 'vector';"
```

Expected result:

- one row with `vector`

Minimum schema proof:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
node --import tsx --test test/listing-search-documents.test.ts
```

Minimum search proof:

```powershell
cd C:\Users\umut\Desktop\ai-ses\app\backend
node --import tsx --test test/local-demo-seed.test.ts test/listings-hybrid-search.test.ts
```

## Scope Reminder

This runbook is for local `pgvector` runtime consistency only.

Do not use it to redesign listing search, prompts, or spoken reference logic.
