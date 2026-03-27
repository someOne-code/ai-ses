# Semantic Search Specification

This document defines the listing search architecture for the real estate voice AI product.

## Problem

Structured SQL filters alone are not enough for voice search.

They work for:

- district
- neighborhood
- rent or sale
- price range
- bedroom count
- bathroom count
- square meters

They fail on subjective or fuzzy requests such as:

- "metroya yakin"
- "aile icin uygun"
- "sessiz sokakta"
- "masrafsiz tasinmalik"
- "manzarali ama butce dostu"
- "site icinde gibi"

These requests require semantic retrieval, not only exact column filtering.

## Decision

Use hybrid listing search in the backend.

Hybrid search means:

1. parse and apply hard filters first
2. derive a residual semantic query from the caller request
3. retrieve candidates with vector similarity and lexical matching
4. rerank the candidate set
5. return a short structured result set to Retell tools

Do not use AI-generated SQL in production.
Do not make n8n the search layer.
Do not let Retell answer listing details without backend evidence.

## System Ownership

Backend owns:

- normalized listing records
- search documents and embeddings
- hard-filter parsing
- hybrid ranking
- final search response shape

Retell owns:

- collecting the caller request
- calling backend tools
- reading short results back to the caller

n8n owns:

- optional listing ingestion side effects
- optional sync fan-out
- no search-time ranking logic

## Storage Model

Keep `listings` as the source-of-truth record table.

Add a separate search document table for retrieval.

### Proposed Table: `listing_search_documents`

- `id` uuid primary key
- `office_id` uuid not null
- `listing_id` uuid not null
- `document_type` text not null
- `content` text not null
- `content_tsv` tsvector not null
- `embedding` vector(1536) not null
- `metadata` jsonb not null default '{}'::jsonb
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Constraints:

- foreign key `listing_id -> listings.id`
- foreign key `office_id -> offices.id`
- unique `(listing_id, document_type)`

Indexes:

- btree on `(office_id, listing_id)`
- GIN on `content_tsv`
- ivfflat or hnsw on `embedding`

Notes:

- `vector(1536)` is a practical default when using a common embedding model such as OpenAI `text-embedding-3-small`
- if the embedding provider changes, migrate the vector dimension deliberately instead of hiding it behind runtime magic

## Search Document Construction

Create one primary search document per listing.

Recommended `content` composition:

- listing title
- description
- district
- neighborhood
- property type
- listing type
- normalized amenities
- short natural-language synthesis of key facts

Example:

```text
Kadikoy Moda 3+1 kiralik daire. Balkonlu. Asansorlu. Aileye uygun. Sessiz sokakta. Metroya yakin. Net 135 metrekare. Aidat 1500 TL.
```

Optional later:

- separate `document_type` rows for:
  - `main`
  - `amenities`
  - `location`
  - `agent_notes`

For MVP, one `main` document per listing is enough.

## Query Processing

Input from the caller should be split into two parts:

1. hard filters
2. residual semantic query

### Hard Filters

Examples:

- district
- neighborhood
- listing type
- property type
- min price
- max price
- min bedrooms
- min bathrooms
- min net m2
- max net m2

### Residual Semantic Query

This is the part that should not be forced into exact columns.

Examples:

- "metroya yakin"
- "aile icin uygun"
- "sessiz sokakta"
- "butce dostu"
- "oturuma hazir"

## Retrieval Flow

Use this order:

1. office scope filter
2. active listing filter
3. structured filter preselection
4. lexical search over `content_tsv`
5. vector search over `embedding`
6. weighted rerank
7. return top 3 to 5 results

If there is no semantic query, structured search can return directly.

If there are no hard filters, semantic plus office scope is allowed.

## Ranking Strategy

Recommended first-pass score:

```text
final_score =
  0.45 * vector_similarity +
  0.35 * lexical_score +
  0.20 * business_score
```

Where `business_score` may include:

- freshness
- active status
- optional office-defined featured boost

MVP business score should stay simple. Do not add opaque weighting logic.

## API Contract

Do not replace the current structured search contract immediately.
Extend it.

### Public Backend Contract

`GET /v1/offices/:officeId/listings/search`

Add optional query params:

- `queryText`
- `searchMode`

Rules:

- `searchMode` values:
  - `structured`
  - `hybrid`
- default:
  - `structured` when `queryText` is absent
  - `hybrid` when `queryText` is present

Example:

```http
GET /v1/offices/:officeId/listings/search?district=Kadikoy&listingType=rent&minBedrooms=3&queryText=metroya%20yakin%20aile%20icin%20uygun
```

### Internal Search Service Contract

```ts
interface HybridListingSearchInput {
  officeId: string;
  district?: string;
  neighborhood?: string;
  listingType?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  minNetM2?: number;
  maxNetM2?: number;
  queryText?: string;
  searchMode: "structured" | "hybrid";
  limit: number;
}
```

### Response Shape

Keep the current compact listing shape.

Add optional retrieval metadata for internal debugging only, not voice output:

- `matchReason`
- `semanticScore`
- `lexicalScore`

Do not expose those to callers by default.

## Retell Tool Contract

`search_listings` should evolve to support:

```json
{
  "district": "Kadikoy",
  "listingType": "rent",
  "minBedrooms": 3,
  "queryText": "metroya yakin aile icin uygun",
  "limit": 5
}
```

Tool rules:

- Retell may pass `queryText`
- backend decides whether structured or hybrid path is used
- tool output stays short and structured

## Ingestion And Embeddings

Embeddings should be generated when:

- a listing is created
- a listing is updated
- a listing is reactivated
- normalized search content changes

Do not generate embeddings during live caller requests.

Use one of these implementation paths:

1. local Postgres plus `pgvector`
2. Supabase Postgres plus `pgvector`

Supabase is optional hosting, not an architectural requirement.

## Supabase Note

Supabase can host the same pattern:

- `pgvector`
- semantic search
- hybrid search
- automatic embedding workflows

Use Supabase only if we decide to move hosting there.
Do not reframe the product around Supabase just to get semantic search.

## Rollout Plan

### Phase A

- keep current structured search
- add `queryText` to contracts
- store search documents without embeddings if necessary

### Phase B

- enable `pgvector`
- backfill embeddings
- implement hybrid retrieval path
- keep structured-only fallback

### Phase C

- add listing detail reranking improvements
- add office-specific featured boosts if needed
- add evaluation set for caller-style search phrases

## Acceptance Criteria

The search layer is acceptable when:

- strict structured queries still work
- subjective requests return relevant office-scoped listings
- listing search never leaks across offices
- backend remains the only source of truth
- Retell receives short structured results
- no AI-generated SQL is used in production
