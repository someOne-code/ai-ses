# Agent Playbook

This document holds the detailed operating patterns that were removed from `AGENTS.md`.

Use `AGENTS.md` as the repo index.
Use this file when the task needs detailed role routing, delegation recipes, or workflow examples.

## Core Principle

For this repository:

- use skills before re-deriving process
- keep backend as the source of truth
- use subagents only for bounded work or parallel slices
- keep write ownership explicit when multiple agents are involved

## Team Leader Rule

For implementation work, the primary implementation agent is the team leader by default unless the task is explicitly review-only.

Team leader responsibilities:

- read the repo control docs before planning or editing
- prove that read step in the first substantive response by listing the files reviewed
- understand the critical path locally before delegating
- split work only when tasks are clearly separable
- assign explicit ownership to each subagent
- review returned work before integrating it
- run tests or checks after integration
- send fixes back out only when a bounded follow-up is needed

Subagent rules:

- subagents do not decide final architecture on their own
- subagents do not broaden scope
- subagents own only the bounded slice they were assigned
- the team leader owns final merge, correctness, and acceptance

## Evidence Rule

For any non-trivial task, the first substantive response must include:

- `Files reviewed:` with exact repo docs or code paths actually inspected
- `References checked:` with exact local reference repos and files actually inspected, or `none`
- `External docs checked:` with exact primary sources consulted for third-party APIs or libraries, or `none`
- `Ready-made options considered:` with the official or existing options checked first, or `none`

If a proposal depends on a third-party product, SDK, API, or provider behavior, prefer primary sources before implementation. Do not present memory-only guesses as verified guidance.
If the task depends on third-party or infrastructure behavior, do not begin implementation until the evidence block is filled in explicitly. If no primary source was checked, say so and stop before implementation.

## Critical Integration Rule

For booking, CRM, Retell webhook, callback, provider, or workflow-runtime work:

- do not treat code review as sufficient acceptance
- require `code review + failure-mode review + live smoke`

Minimum failure-mode review questions:

- what happens on timeout or non-2xx?
- what happens if callback arrives late?
- what happens if runtime state changes between dispatch and callback?
- what happens with wrong secret or auth mismatch?
- what happens on retry, duplicate delivery, or partial cleanup?

Minimum live smoke rule:

- prove at least one happy path and one meaningful failure path with backend-visible evidence
- do not accept dashboard-only proof for Retell-facing work
- do not accept workflow visibility alone for n8n-facing work

## Role Guide

### Product Architect

Primary skill:

- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)

Support skills:

- [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md)
- [$database-design](/Users/umut/.codex/skills/database-design/SKILL.md)

Use for:

- tenant model
- office and settings model
- prompt and config ownership
- admin panel scope
- MVP boundary decisions

Stay local unless the user explicitly asks for delegation or the task is large enough to split.

### Backend Engineer

Primary subagent:

- [backend-developer.toml](/Users/umut/.codex/agents/backend-developer.toml)

Required skills:

- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
- [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md)

Add when needed:

- [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)

Use for:

- Node.js + TypeScript service structure
- REST endpoints
- webhook handlers
- tenant-aware application services
- showing request and inquiry flows

Default role:

- team leader for backend implementation unless the parent task is explicitly review-only

### API Designer

Primary subagent:

- [api-designer.toml](/Users/umut/.codex/agents/api-designer.toml)

Required skills:

- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
- [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md)

Use for:

- endpoint design
- payload shapes
- validation rules
- webhook contracts
- Retell tool I/O definitions

### TypeScript Engineer

Primary subagent:

- [typescript-pro.toml](/Users/umut/.codex/agents/typescript-pro.toml)

Required skills:

- [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md)

Add when relevant:

- [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)

Use for:

- DTOs
- type-safe service layers
- validation typing
- shared types between admin and backend

### PostgreSQL Engineer

Primary subagent:

- [postgres-pro.toml](/Users/umut/.codex/agents/postgres-pro.toml)

Required skills:

- [$database-design](/Users/umut/.codex/skills/database-design/SKILL.md)
- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)

Use for:

- schema design
- tenant isolation
- indexes
- query planning
- migration review

Typical delegation:

- reviewer or focused specialist under the backend team leader

### LLM Architect

Primary subagent:

- [llm-architect.toml](/Users/umut/.codex/agents/llm-architect.toml)

Required skills:

- [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)
- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)

Use for:

- function and tool design
- guardrails
- prompt boundaries
- hallucination prevention
- listing Q&A policies

Typical delegation:

- focused design reviewer under the current implementation lead

Hard rules:

- never let the model answer listing details without backend tool evidence
- prefer structured tool output over free text retrieval
- do not use AI-generated SQL in production
- do not rely on SQL-only filters for subjective listing requests such as lifestyle, proximity, suitability, or vibe
- use hybrid search design: hard filters first, semantic retrieval second, rerank last

### Prompt Engineer

Primary subagent:

- [prompt-engineer.toml](/Users/umut/.codex/agents/prompt-engineer.toml)

Required skills:

- [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)
- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)

Use for:

- Retell agent prompts
- fallback phrasing
- lead qualification scripts
- transfer and escalation language

Typical delegation:

- focused prompt reviewer under the current implementation lead

Hard rules:

- do not optimize for style over correctness
- prompts must preserve structured tool use
- prompts must say when to admit missing data

### Workflow Engineer

Primary skill:

- [$retell-n8n-voice-ops](/Users/umut/.codex/skills/retell-n8n-voice-ops/SKILL.md)

Primary subagent:

- [n8n-operator.toml](/Users/umut/.codex/agents/n8n-operator.toml)

Support skills:

- [$n8n-workflow-patterns](/Users/umut/.codex/skills/n8n-workflow-patterns/SKILL.md)
- [$n8n-mcp-tools-expert](/Users/umut/.codex/skills/n8n-mcp-tools-expert/SKILL.md)
- [$n8n-node-configuration](/Users/umut/.codex/skills/n8n-node-configuration/SKILL.md)
- [$n8n-expression-syntax](/Users/umut/.codex/skills/n8n-expression-syntax/SKILL.md)
- [$n8n-code-javascript](/Users/umut/.codex/skills/n8n-code-javascript/SKILL.md)
- [$n8n-validation-expert](/Users/umut/.codex/skills/n8n-validation-expert/SKILL.md)

Use for:

- booking flow adaptation
- CRM sync flow
- call summary fan-out
- Retell event normalization
- workflow debugging

Hard rules:

- keep customer configuration out of n8n
- keep secrets out of committed workflow JSON
- keep local n8n runtime env in repo-owned local files and startup scripts, not ad hoc one-off shell state
- keep business rules in backend unless they are lightweight workflow glue
- do not build one mega workflow that owns booking, CRM, and unrelated operations together
- prefer separate top-level workflows per business flow, and extract shared sub-workflows only after real repetition appears
- treat existing local n8n workflows from other projects as legacy references only
- do not assume existing published workflows are correct just because they run
- do not overwrite, rename, or extend legacy workflows in place for this project
- create new project-owned workflows with an `ai-ses - ` prefix
- if a legacy workflow seems useful, audit its pattern first and then reimplement the needed parts cleanly

## Standard Workflows

### Workflow A: Backend Schema Or API Work

1. Read [docs/project-plan.md](/Users/umut/Desktop/ai-ses/docs/project-plan.md).
2. Load [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md).
3. Load [$database-design](/Users/umut/.codex/skills/database-design/SKILL.md) for tables or [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md) for services.
4. If delegation is justified, use `postgres-pro` for schema or `backend-developer` for service implementation.
5. Keep all data models tenant-aware.

### Workflow B: Retell Tool Or Prompt Work

1. Load [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md).
2. Load [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md).
3. Delegate to `llm-architect` for tool design or `prompt-engineer` for prompt rewriting when specialized isolation is useful.
4. Ensure prompts require tool usage before answering listing details.

### Workflow C: n8n Automation Work

1. Load [$retell-n8n-voice-ops](/Users/umut/.codex/skills/retell-n8n-voice-ops/SKILL.md).
2. Load [$n8n-workflow-patterns](/Users/umut/.codex/skills/n8n-workflow-patterns/SKILL.md).
3. Add [$n8n-node-configuration](/Users/umut/.codex/skills/n8n-node-configuration/SKILL.md) and [$n8n-expression-syntax](/Users/umut/.codex/skills/n8n-expression-syntax/SKILL.md) while building.
4. Add [$n8n-code-javascript](/Users/umut/.codex/skills/n8n-code-javascript/SKILL.md) only for lightweight transform logic.
5. Add [$n8n-validation-expert](/Users/umut/.codex/skills/n8n-validation-expert/SKILL.md) during debug.
6. Treat non-`ai-ses - ...` workflows in the local n8n instance as legacy reference material unless the user explicitly reassigns ownership.
7. Create new project workflows instead of modifying unrelated legacy workflows.
8. When local n8n runtime matters, load [local-n8n-runbook.md](/Users/umut/Desktop/ai-ses/docs/local-n8n-runbook.md) and verify process env plus actual registered webhook path before claiming runtime smoke success.

### Retell Operator

Primary subagent:

- [retell-ops.toml](/Users/umut/.codex/agents/retell-ops.toml)

Required skills:

- [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
- [$retell-n8n-voice-ops](/Users/umut/.codex/skills/retell-n8n-voice-ops/SKILL.md)
- [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)

Use for:

- live Retell agent verification
- webhook/debug acceptance
- post-call analysis config compatibility
- dynamic variable and metadata debugging
- provider-facing smoke validation

Hard rules:

- dashboard chat/audio is not final backend-writeback proof
- always separate voice UX validation from backend persistence validation
- keep backend as the source of truth even when Retell runtime is being tuned

### Workflow D: Parallel Delivery

1. Load [$orchestration](/Users/umut/.codex/skills/orchestration/SKILL.md).
2. Split ownership cleanly.
3. Use `backend-developer`, `postgres-pro`, and `prompt-engineer` on disjoint outputs only.
4. Do not duplicate work between subagents.
5. Keep the primary implementation agent as team leader for final integration and testing.

## Delegation Recipes

### Schema Pass

- Main agent loads:
  - [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
  - [$database-design](/Users/umut/.codex/skills/database-design/SKILL.md)
- Delegate to:
  - `postgres-pro`
- Ask for:
  - tables
  - constraints
  - indexes
  - migration caveats

### Backend Endpoint Pass

- Main agent loads:
  - [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
  - [$backend-development](/Users/umut/.codex/skills/backend-development/SKILL.md)
- Delegate to:
  - `api-designer`
  - optionally `backend-developer`
- Ask for:
  - endpoint contract first
  - then implementation scope

### Listing Q&A Guardrail Pass

- Main agent loads:
  - [$llm-application-dev](/Users/umut/.codex/skills/llm-application-dev/SKILL.md)
  - [$retell-real-estate-saas](/Users/umut/.codex/skills/retell-real-estate-saas/SKILL.md)
- Delegate to:
  - `llm-architect`
  - optionally `prompt-engineer`
- Ask for:
  - tool schema
  - prompt guardrails
  - failure behavior when data is missing

### Workflow Conversion Pass

- Main agent loads:
  - [$retell-n8n-voice-ops](/Users/umut/.codex/skills/retell-n8n-voice-ops/SKILL.md)
  - [$n8n-workflow-patterns](/Users/umut/.codex/skills/n8n-workflow-patterns/SKILL.md)
- Stay local by default.
- Delegate to `n8n-operator` when the task includes live import, activation, runtime route debugging, or workflow smoke in a real n8n instance.
- Audit legacy workflows first if they appear relevant.
- Rebuild needed logic into new `ai-ses - ...` workflows instead of patching legacy project workflows in place.

### Workflow And Runtime Split

- Main agent or `backend-developer` owns backend contract or callback fixes.
- `n8n-operator` owns live n8n import, activation, and smoke verification.
- `retell-ops` owns live Retell runtime, webhook, and post-call verification.
- The lead agent keeps final acceptance and integration responsibility.
