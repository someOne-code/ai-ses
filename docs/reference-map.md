# AI Ses Project Reference Map

This workspace now contains the reference repos and extracted assets we can reuse while building the real estate voice AI SaaS.

## Local Sources

- `references/realtor-ai`
  - Source: `saminkhan1/realtor-ai`
  - Use for:
    - LangGraph conversation flow
    - property search intent parsing
    - Retell custom LLM websocket server pattern
    - basic chat widget ideas
  - Do not reuse as-is for:
    - multitenancy
    - production auth
    - admin panel
    - customer config management

- `references/ai-receptionist-agent`
  - Source: `lightonkalumba/ai-receptionist-agent`
  - Use for:
    - n8n booking workflow
    - Google Calendar availability checks
    - alternative slot suggestion flow

- `references/n8n-nodes-retellai`
  - Source: `RetellAI/n8n-nodes-retellai`
  - Use for:
    - Retell agent management from n8n
    - phone number management from n8n
    - knowledge base operations from n8n
    - call event triggers from n8n

- `references/outbound-real-estate-voice-ai`
  - Source: `Awaisali36/Outbound-Real-State-Voice-AI-Agent-`
  - Note:
    - the upstream repo contains invalid Windows paths, so checkout is broken on this machine
    - the git object database is still usable

- `references/outbound-real-estate-voice-ai-extracted`
  - Clean extraction from the repo above
  - Includes:
    - `README.md`
    - `Protect_fortunes_voice_agent.json`
  - Use for:
    - outbound lead follow-up flow
    - Airtable/CRM mapping ideas
    - WhatsApp and email follow-up patterns
    - Calendly handoff design

- `references/property-pulse`
  - Source: `LannonTheCannon/Property-Pulse`
  - Use for:
    - natural-language property search pipeline ideas
    - residual query extraction concepts
    - search -> result -> answer flow
  - Notes:
    - the repo relies on AI-generated SQL; do not copy this directly into production
    - use it as a pattern reference for hybrid search orchestration only

## Official Technical References

- `pgvector`
  - Source: official `pgvector/pgvector`
  - Use for:
    - Postgres-native vector storage
    - cosine distance queries
    - official vector operators
    - future HNSW or IVFFlat index setup
  - Notes:
    - treat this as an official technical reference, not as an application reference repo
    - prefer it over hand-rolled array-based vector math when the local environment supports it

- `PostgreSQL full text search docs`
  - Source: official PostgreSQL documentation
  - Use for:
    - `tsvector`
    - `websearch_to_tsquery`
    - `ts_rank` and `ts_rank_cd`
    - lexical ranking behavior
  - Notes:
    - use this as the canonical source for lexical search behavior in hybrid listing retrieval

- `Gemini embeddings docs`
  - Source: official Gemini API documentation
  - Use for:
    - embedding model selection
    - output dimensionality
    - task type selection such as retrieval document vs retrieval query
    - official SDK usage expectations
  - Notes:
    - use this as the canonical source for Gemini embedding integration details

## Planned Project Layout

- `app/backend`
  - Our code
  - Responsibilities:
    - tenant model
    - customer settings
    - prompt/config management
    - listing source mapping
    - auth and audit logging
    - Retell webhooks that n8n should not own

- `app/admin`
  - Our code
  - Responsibilities:
    - agency admin UI
    - customer onboarding
    - prompt editing
    - phone number assignment
    - calendar and CRM connection forms

- `infra/n8n`
  - Imported or adapted workflows
  - First candidates:
    - booking flow from `references/ai-receptionist-agent`
    - Retell orchestration with `references/n8n-nodes-retellai`
    - outbound follow-up flow from `references/outbound-real-estate-voice-ai-extracted`

## Reuse Strategy

1. Reuse `realtor-ai` for conversation architecture only.
2. Move booking logic out of hard-coded Google Calendar tools and into n8n workflows.
3. Use the official Retell n8n node for agent, phone number, call, and KB operations.
4. Build the multitenant SaaS layer ourselves in `app/backend` and `app/admin`.
5. Use `property-pulse` only as a reference for query orchestration, not as a production SQL generation approach.

## Immediate Next Steps

1. Inspect the booking workflow JSON and copy it into `infra/n8n` in a cleaned form.
2. Define the backend data model for tenants, prompts, phone numbers, and integrations.
3. Replace single-calendar assumptions with per-customer settings.
4. Stand up a small backend skeleton before wiring production workflows.
5. Add hybrid listing search with structured filters plus semantic retrieval so subjective caller requests are not lost.
