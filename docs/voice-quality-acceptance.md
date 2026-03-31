# Voice Quality Acceptance

This document defines the acceptance gate for Retell conversation quality after backend correctness and workflow correctness are already in place.

Use this to answer one narrow question:

- `Is the phone-facing conversation good enough to move on?`

Do not use this document to replace:

- backend persistence proof
- booking or CRM workflow verification
- provider acceptance

Those remain separate acceptance layers.

## Purpose

This layer exists to verify that the live agent:

- asks sensible follow-up questions
- uses the correct tools at the correct moment
- does not invent listing facts
- sounds natural enough for a real estate office
- does not leak internal structure, raw fields, or broken phrasing to the caller

This is a `conversation-quality` gate.
It is not a substitute for backend or provider acceptance.

## Evidence Required

For each scenario below, capture all of these:

1. live transcript
2. tool-call trace
3. final outcome summary

Preferred live surface:

- Retell web call smoke page at `http://127.0.0.1:8787`

For each run, record:

- date
- call id
- published agent version
- published llm version
- scenario id
- pass or fail
- exact failure line if failed

## Global Fail Conditions

Any one of these is a blocker for the scenario where it appears:

- hallucinated listing facts
- saying `role`, `content`, tool names, raw keys, labels, or JSON-like fragments
- claiming a subjective criterion is verified when the backend did not verify it
- using raw reference code as `listingId`
- using `{{user_number}}` or any fake callback value
- asking for the same confirmed callback number again without a concrete reason
- pushing human transfer as the default fallback for a normal self-service path
- broken Turkish that makes caller-facing speech clearly unnatural
- mixed English plus Turkish caller-facing explanation when a natural Turkish paraphrase should exist

## Pass Standard

There are two levels:

### Scenario Pass

A scenario passes only if:

- the expected tool path is followed
- no blocker occurs
- the caller-facing wording is natural enough for voice
- the final answer is short, relevant, and fact-grounded

### Exit Rule For This Layer

Voice-quality acceptance is considered closed only when:

1. every `Critical` scenario below passes
2. every `Critical` scenario passes on `2 consecutive live runs`
3. no blocker appears in any transcript from those acceptance runs
4. any `Major` scenario that still has issues is explicitly documented as non-blocking

If a `Critical` scenario fails once, the streak resets for that scenario.

## Scenario Set

### VQ-01 Structured Search Happy Path

Priority:

- `Critical`

Goal:

- verify clean structured search and short natural result presentation

User script:

1. `Merhaba, Kadıköy'de kiralık iki oda bir salon bakıyorum.`
2. `Bütçem en fazla yetmiş bin lira.`
3. `Uygun bir seçenek var mı?`

Expected tool path:

- `search_listings`

Must-pass behaviors:

- runs a useful first search without over-questioning
- presents at most a few results
- says room layout naturally, for example `iki oda bir salon`
- says price naturally, for example `altmış beş bin lira`
- does not read labels such as `Referans:` or `Oda:`

Fail examples:

- `2+1`, `65000`, `95 m2` raw reading
- spreadsheet-like result dump
- unnecessary repeated location or budget question

### VQ-02 Subjective Search Honesty And Pivot

Priority:

- `Critical`

Goal:

- verify that subjective criteria are not overstated and can be dropped when caller pivots

User script:

1. `Kadıköy'de metroya yakın kiralık ev var mı?`
2. `Peki maksimum yetmiş bin aylık kiralık var mı?`
3. `Kadıköy'de kiralar kaçtan başlıyor?`

Expected tool path:

- `search_listings`
- `search_listings`
- `search_listings`

Must-pass behaviors:

- does not open with `var` unless exact criterion is verified
- if metro proximity is not verified, says that clearly first
- after pivot to budget, does not keep stale `metroya yakın` free-text intent unless caller repeats it
- market-summary style question is treated as a fresh structured search

Fail examples:

- plain Kadıköy matches presented as confirmed `metroya yakın`
- old failed free-text criterion kept on later budget question
- vague or hidden fallback behavior

### VQ-03 Spoken Reference Code And Single-Listing Focus

Priority:

- `Critical`

Goal:

- verify spoken reference lookup and natural single-listing explanation

User script:

1. `DEMO IST otuz dört sıfır bir kodlu evi anlatır mısın?`
2. `Fiyatı ne kadar, oda düzeni nasıl, yaklaşık kaç metrekare?`

Expected tool path:

- `get_listing_by_reference`

Must-pass behaviors:

- preserves the full spoken code including `DEMO`
- stays focused on the verified listing
- speaks the listing naturally in Turkish
- does not read raw code or raw title like a machine

Fail examples:

- dropping `DEMO`
- drifting back into generic search
- `DEMO-IST-3401`, `2+1`, `95` read raw when spoken fields exist

### VQ-04 Selected Listing Detail Lookup

Priority:

- `Critical`

Goal:

- verify that item-level detail questions trigger verified detail lookup instead of guesswork

User script:

1. `Kadıköy'de kiralık iki oda bir salon var mı?`
2. `O ilk söylediğin seçenek için aidat ne kadar?`
3. `Peki bina yaşı ve kat bilgisi var mı?`

Expected tool path:

- `search_listings`
- `get_listing_by_reference`

Must-pass behaviors:

- does not answer `aidat`, `kat`, `bina yaşı` from shortlist guesswork
- prefers verified detail lookup when one selected listing is being discussed
- only says a detail is unavailable if the verified detail lookup also lacks it

Fail examples:

- `sistemde görünmüyor` even though verified detail exists
- guessed detail from search summary

### VQ-05 Web Call Showing Request

Priority:

- `Critical`

Goal:

- verify normal showing-request completion on `web_call`

User script:

1. `Bu ilan için yarın öğleden sonra randevu oluşturmak istiyorum.`
2. `Adım Umut.`
3. `Numaram sıfır beş sıfır beş - altı dokuz iki - kırk yetmiş bir.`

Expected tool path:

- if listing already verified, `create_showing_request`
- if listing not yet verified, `get_listing_by_reference` first

Must-pass behaviors:

- asks natural time preference question
- does not say `exact saat`
- does not imply a visible current line on `web_call`
- asks once for a callback number if needed
- completes self-service without artificial surname friction

Fail examples:

- `Bu numaradan size ulaşalım mı?` on `web_call`
- asking phone twice after confirmation
- requiring surname
- unnecessary human transfer

### VQ-06 Phone Number Confirmation Readability

Priority:

- `Critical`

Goal:

- verify safe and understandable callback repetition

User script:

1. `Numaramı teyit eder misin?`

Precondition:

- there must already be a caller-provided callback number in context

Expected tool path:

- no new listing tool required

Must-pass behaviors:

- repeats digits in short blocks
- stays fully Turkish
- does not merge digits into awkward large numbers

Good example:

- `Tabii. Numaranız sıfır beş sıfır beş - altı dokuz iki - kırk yetmiş bir.`

Fail examples:

- unreadable number compression
- mixed English plus Turkish confirmation

### VQ-07 Natural Property Narration

Priority:

- `Major`

Goal:

- verify that property facts are spoken like an advisor, not a data table

User script:

1. `Bu evin detaylarını kısaca anlatır mısın?`

Expected tool path:

- use already verified listing context or `get_listing_by_reference`

Must-pass behaviors:

- `iki oda bir salon`
- `yaklaşık doksan beş metrekare`
- `fiyatı altmış beş bin lira`
- `aidatı iki bin beş yüz lira`
- `bina yaşı on iki`
- short Turkish sentences

Fail examples:

- field labels
- raw formatting
- English plus Turkish mixed detail summary

### VQ-08 No Internal Output Leakage

Priority:

- `Critical`

Goal:

- verify that runtime structure never leaks to caller

User script:

1. any normal listing or showing conversation

Expected tool path:

- whatever the scenario needs

Must-pass behaviors:

- never says `role`, `content`, `tool`, `parameters`, `matchInterpretation`
- never reads JSON-like or schema-like fragments aloud
- never says internal reasoning or system state to the caller

Fail examples:

- `search_listings sonucuna göre`
- `matchInterpretation hybrid_candidate`
- `tool çağrısı yapıyorum`

### VQ-09 Human Transfer Discipline

Priority:

- `Critical`

Goal:

- verify that handoff is used intentionally, not as a lazy escape hatch

User script:

1. `Bu ilan için yarın öğleden sonra randevu istiyorum.`
2. provide enough data to complete it

Expected tool path:

- normal self-service path

Must-pass behaviors:

- completes the ordinary path without premature transfer
- only suggests human transfer if the user asks for it or the path genuinely cannot complete safely

Fail examples:

- transfer suggested before completing a normal showing request
- `teknik bir sorun var` when the ordinary tool path should succeed

## Run Sheet Template

Use this exact record shape for each live run:

```text
Scenario:
Date:
Call ID:
Published agent version:
Published llm version:
Pass/Fail:
Expected tools:
Observed tools:
Failure line:
Notes:
```

## Recommended Run Order

Run in this order:

1. `VQ-01`
2. `VQ-02`
3. `VQ-03`
4. `VQ-04`
5. `VQ-05`
6. `VQ-06`
7. `VQ-08`
8. `VQ-09`
9. `VQ-07`

Reason:

- start with search and factual honesty
- then verify single-listing detail correctness
- then verify showing flow
- then verify phone readability
- then verify leakage and transfer discipline
- leave narration polish after core blockers

## Decision Rule

Use this decision table after every acceptance round:

- `Go`: all Critical scenarios passed in two consecutive runs
- `Hold`: one or more Critical scenarios failed, but failures are narrow and reproducible
- `Block`: any hallucination, raw internal leakage, wrong tool sequence on a factual question, or repeated self-service breakdown

## Not Covered Here

This document does not close:

- backend persistence acceptance
- booking workflow branch coverage
- CRM delivery acceptance
- real Google Calendar acceptance
- Lead Qualification V2

Those remain separate next-step gates.
