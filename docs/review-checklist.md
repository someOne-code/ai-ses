# Review Checklist

Use this checklist to review every meaningful agent delivery in this repository.

The goal is not only code correctness.
The goal is product correctness, tenant safety, and voice use-case fit.

## 1. Product Logic

- Does this change help a real estate office in a real call flow?
- Does it improve a sellable product, not just a technical demo?
- Is it useful in a voice receptionist workflow, not only in a backend vacuum?

## 2. Scope Control

- Does it stay inside the requested slice?
- Does it avoid drifting into analytics, billing, omnichannel, or generic platform work?
- Does it avoid adding side features that were not requested?

## 3. Source Of Truth

- Is the backend still the source of truth?
- Did business logic stay out of n8n unless it is lightweight workflow glue?
- Did the change avoid hiding durable behavior inside prompts or workflow nodes?

## 4. Tenant Safety

- Is every critical path office-scoped or tenant-scoped?
- Can data leak across offices?
- Did the change introduce any global assumption that breaks multi-tenancy?

## 5. Listing Accuracy

- Can the assistant answer only from backend-backed listing data?
- Did the change reduce or increase hallucination risk?
- If search is involved, does it preserve office scoping and active-listing rules?

## 6. User Experience Fit

- Would this still work for messy spoken input, not just neat typed input?
- Are outputs short enough for a voice channel?
- Does the flow behave sensibly when caller intent is incomplete or fuzzy?

## 7. Cause And Effect

- Is the underlying problem actually solved?
- Did the implementation create complexity without improving the user outcome?
- Does the technical design match the product reason for doing it?

## 8. Operational Reality

- Is the change realistic for production use?
- Are secrets, retries, idempotency, migrations, and webhook behavior handled sensibly?
- Is this more than a happy-path demo?

## 9. Test Quality

- Do tests verify behavior instead of only implementation details?
- Are edge cases covered?
- Could the tests give a false sense of safety?
- If Retell behavior is involved, is there proof beyond dashboard playground or manual chat simulation?
- Does at least one verification path prove webhook ingestion or API-driven persistence into backend storage?

## 10. Critical Integration Review

For booking, CRM, Retell webhook, callback, and provider-dependent work, code review alone is not enough.

Every critical integration change should be reviewed across 3 layers:

- `Code review`: does the implementation look correct on the happy path?
- `Failure-mode review`: what happens on timeout, non-2xx, delayed callback, state drift, connection rotation, wrong secret, duplicate delivery, or cleanup failure?
- `Live smoke`: is there at least one backend-visible runtime proof that the intended path and a meaningful failure path both work?

Use these 5 questions explicitly:

- Does the happy path work?
- Does the failure path stay backend-visible instead of dying silently?
- Can delayed callback or runtime state drift corrupt attribution or leave state stuck?
- Do wrong secret or auth failures fail safely?
- Are cleanup and idempotency good enough to trust repeated runs?

## 11. Repo Rule Compliance

- Does the change follow [AGENTS.md](/Users/umut/Desktop/ai-ses/AGENTS.md)?
- Does it avoid direct reuse of reference repos as production code?
- Does it avoid overwriting legacy workflows from other projects?
- Does it avoid SQL-only search for subjective listing requests once semantic search work begins?

## 12. Ready-Made First

- Did the implementation check whether an official or ready-made solution already existed before building a custom path?
- If a custom path was chosen, is there a clear reason the official or ready-made option was not used?
- Did the delivery avoid reinventing a provider, database, SDK, or platform feature that was already available?

## Fast Review Questions

Use these 5 questions first on every delivery:

1. Is this sellable?
2. Is this tenant-safe?
3. Is this hallucination-safe?
4. Is this backend-owned?
5. Is this actually the requested slice?
