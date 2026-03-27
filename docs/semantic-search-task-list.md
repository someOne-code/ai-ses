# Semantic Search Task List

This task list covers the first implementation pass for hybrid listing search.

## Phase 2A: Contracts And Data Model

- add a new schema file for `listing_search_documents`
- decide and document the embedding dimension
- add `queryText` and `searchMode` to listing search contracts
- keep the existing structured filters unchanged
- document internal service input and output types

## Phase 2B: Storage And Ingestion

- enable `pgvector` in the local Postgres instance
- add migration for `listing_search_documents`
- add `tsvector` support for lexical search
- create a listing-to-search-document builder
- define when embeddings are created or refreshed

## Phase 2C: Query Path

- keep the existing structured query path as fallback
- implement lexical candidate retrieval
- implement vector candidate retrieval
- implement weighted rerank
- return a compact top-N result set

## Phase 2D: Retell Integration

- extend `search_listings` tool contract with `queryText`
- keep backend in control of hybrid vs structured routing
- do not expose raw scores in voice output
- add safe fallback when no semantic matches are found

## Phase 2E: Testing

- add tests for structured-only search
- add tests for hybrid search with subjective phrases
- add office isolation tests for hybrid search
- add empty-result fallback tests
- add tests proving no inactive listings leak into results

## Open Decisions

- choose the first embedding provider
- choose whether `vector(1536)` stays the default
- choose whether lexical ranking uses plain `tsvector` only in MVP or a richer setup later

## Not In Scope For This Slice

- full RAG chatbot behavior
- free-text answer generation from listing docs
- semantic search in n8n
- Supabase migration as a prerequisite
- admin UI for search tuning
