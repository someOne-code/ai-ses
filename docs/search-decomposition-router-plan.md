# Search Decomposition, Router, Negation ve Voice-Safe Pagination Planı

## Status

COMPLETED (2026-04-02)

## Summary

Bu faz `search_listings` davranışını production-safe hale getirir. Amaç:

- eski free-text intent’in yeni aramaya yapışmasını engellemek
- semantic drift yüzünden alakasız approximate adayların dönmesini engellemek
- negatif tercihler (`metro istemiyorum`, `otoyola yakın olmasın`) için güvenli exclusion eklemek
- aynı shortlist’in tekrar tekrar okunmasını engellemek
- tüm kararları backend-owned yapmak; prompt yalnız sequencing ve konuşma üslubu taşısın

Karar kilidi:

- `referenceCode` lookup aynen kalır
- public REST `listings/search` contract’i değişmez
- `search_listings` dış wire shape’i değişmez
- Micro-LLM router kullanılacak ama yalnız decomposition/router için
- router strict Structured Outputs JSON Schema ile çalışacak
- router hard timeout `700ms`
- timeout veya schema failure durumunda rule-based fallback devreye girecek
- arama state’i `call_logs.payload.searchState` içinde tutulacak
- yeni DB tablosu açılmayacak

## Implementation Changes

### 1. Listings decomposition: rule-based core + strict router fallback

`src/modules/listings` altında yeni internal decomposition modülü eklenir.

Yeni internal tipler:

- `DecomposedListingSearchPlan`
- `StructuredSearchCriteria`
- `SearchIntentMode = "new_search" | "refine_search" | "replace_failed_free_text" | "next_page"`
- `SearchAnchorTerm`
- `SearchNegatedTerm`
- `StructuredFilterPatch`
- `FilterMergeAction = "replace" | "append" | "clear"`

Katman 1 rule-based parser şu alanları çıkarır:

- `referenceCode`
- `district`
- `neighborhood`
- `listingType`
- `propertyType`
- `bedrooms`
- `min/max price`
- `min/max netM2`
- `min bathrooms`
- `mustAnchorTerms`
- `negatedTerms`
- açık reset dili
- `baska var mi`, `digerleri`, `siradaki` gibi pagination intent’i

Rule-based anchor extraction:

- tam cümle değil, kök odaklı esnek pattern
- proximity/negation sözcükleri ile birlikte yorumlanır
- ilk anchor aileleri:
  - `metro` -> `metro`, `metronun`, `metroya`, `metro dibi`
  - `avm` -> `avm`, `alisveris merkezi`, `mall`
  - `otoyol` -> `otoyol`, `otoban`, `e5`, `tem`
  - `marmaray`, `tramvay`, `park`, `deniz`

Rule-based parse sonrası belirsiz kalan input Micro-LLM router’a gider.

Router input:

- `currentUserText`
- `lastSearchOutcome`
- `activeStructuredCriteria`
- `activeSemanticIntent`
- `activeMustAnchorTerms`
- `activeNegatedTerms`
- `selectedListingReferenceCode`
- `selectedListingFactsForContext`
- `viewedListingIds`
- `lastUserSearchText`

`selectedListingFactsForContext` yalnız:

- `listingType`
- `district`
- `neighborhood`

Router output strict JSON Schema:

- `intentMode`
- `structuredFiltersPatch`
- `structuredFiltersAction`
- `semanticIntent`
- `mustAnchorTerms`
- `negatedTerms`
- `clearSelectedListingContext`
- `paginationAction: "none" | "next_page"`

Kurallar:

- enum dışı değer kabul edilmez
- ek key kabul edilmez
- timeout `700ms`
- parse failure veya timeout durumunda backend rule-based fallback ile devam eder

### 2. State merge policy: conflict resolution açık kurallı

`refine_search` sırasında backend mevcut state ile gelen patch’i deterministic şekilde birleştirir.

Merge policy:

- skaler alanlar `replace`
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
- bu repo fazında liste birleşimi yapılmayacak; tek değerli filtre modeli korunacak
- kullanıcı `vazgeçtim`, `yerine`, `olsun`, `bu değil` dili kullanıyorsa `replace`
- kullanıcı yalnız bir ek daraltma getiriyorsa ilgili alan patch edilir, diğer aktif kriterler korunur
- `replace_failed_free_text` modunda:
  - eski `semanticIntent`
  - eski `mustAnchorTerms`
  - eski `negatedTerms`
  tamamen temizlenir
- `new_search` modunda:
  - selected listing kaynaklı filtre bağlamı temizlenir
  - yalnız kullanıcının yeni cümlesinden çıkan kriterler aktif olur

Router’dan gelen `structuredFiltersAction` alanı zorunlu olarak kullanılır:

- `replace`: patch alanları ezilir
- `clear`: patch alanları silinir
- `append` bu fazda yalnız future-proof enum olarak kalır; mevcut backend tek değerli filtrelerde `replace` gibi davranmaz, hata üretir. Implementer bunu kabul etmeyecek; bu fazda `append` hiç üretilmeyecek.

### 3. Retrieval pipeline: anchor pre-filter + negation exclusion + pagination exclusion

`repository.ts` içindeki hybrid retrieval genişletilir.

Yeni sıra:

1. structured scope
2. positive anchor pre-filter
3. negative anchor hard exclusion
4. lexical retrieval
5. vector retrieval
6. fusion
7. post-fusion acceptance
8. viewed item exclusion
9. final limit

Pozitif anchor kuralı:

- `mustAnchorTerms` varsa candidate pool önce anchor alias setiyle daraltılır
- vector search tüm corpus üstünde koşmaz; anchor-scoped document set üstünde koşar

Negatif anchor kuralı:

- `negatedTerms` her zaman hard exclusion olarak çalışır
- alias setindeki eşleşmeler search document seviyesinde baştan dışlanır
- negatif intent vector’e “ters embedding” olarak verilmez
- örnek:
  - `metro istemiyorum`
  - `metroya çok yakin olmasin`
  bunlar `metro`, `metrobus`, `marmaray`, `tramvay` içeren document’ları retrieval’dan baştan çıkarır

Pagination kuralı:

- `viewedListingIds` varsa bu ID’ler final candidate set’ten exclude edilir
- `next_page` intent’te aynı state korunur ama sadece henüz konuşulmamış listing’ler getirilir
- sonuç kalmazsa `no_match` değil, internal `exhausted_results` benzeri state üretilir; prompt bunu “şu an bu arama için başka doğrulanmış aday görünmüyor” diye konuşturur

Internal detailed result alanları:

- `matchedAnchors`
- `excludedByNegation`
- `appliedSemanticIntent`
- `searchSessionCursor` veya eşdeğer internal pagination metadata

Bunlar public route’a çıkmaz.

### 4. Backend-owned search state

Arama state’i `call_logs.payload.searchState` içinde tutulur.

Yeni state:

- `activeStructuredCriteria`
- `activeSemanticIntent`
- `activeMustAnchorTerms`
- `activeNegatedTerms`
- `lastSearchOutcome: "success" | "no_match" | "exhausted_results" | "none"`
- `lastUserSearchText`
- `selectedListingReferenceCode`
- `selectedListingFactsForContext`
- `viewedListingIds`
- `updatedAt`

Kurallar:

- yalnız shortlist üreten arama aktif state’i günceller
- `no_match` dönen free-text intent aktif semantic state olarak tutulmaz
- `viewedListingIds` yalnız başarılı shortlist sonrası güncellenir
- selected listing detail follow-up ayrı kalır; yeni portfolio search’e filtre olarak sızmaz

Repository/service ekleri:

- `findCallSearchState(providerCallId)`
- `updateCallSearchState(providerCallId, state)`
- `clearSelectedListingContext(providerCallId)`

### 5. Prompt rolü: thin sequencing only

`listing_help` prompt’ta yalnız şu kurallar kalır:

- selected listing facts’i yeni arama filtresi yapma
- başarısız eski free-text intent’i yeni aramaya taşıma
- approximate shortlist’i verified fact gibi konuşma
- `baska var mi` dediğinde yeni arama uydurma; mevcut shortlist session’ının sıradaki adaylarına bak
- item detail için gerektiğinde `get_listing_by_reference` kullan

Prompt owner olmaz:

- `new_search` vs `refine_search`
- merge policy
- negation semantics
- pagination cursor yönetimi

## Tests and Acceptance

### Repository / decomposition tests

Kilitle:

- `metroya yakin` anchor pre-filter çalışır
- `avmye yakin` alias seti çalışır
- `otoyola yakin` alias seti çalışır
- `metro istemiyorum` negative exclusion çalışır
- `metroya cok yakin olmasin` negative exclusion çalışır
- `aileye uygun` semantic intent olarak kalır
- anchor query’de anchor kanıtsız vector-only candidate elenir
- negated anchor içeren candidate retrieval’a hiç girmez
- public route retrieval metadata sızdırmaz

### Router tests

Kilitle:

- `no_match` sonrası yeni free-text -> `replace_failed_free_text`
- başarılı search + fiyat filtresi -> `refine_search`
- verified listing sonrası `metroya yakin ne var` -> `new_search`
- `baska var mi` -> `next_page`
- strict schema dışı output reddedilir, fallback çalışır
- `700ms` timeout sonrası fallback çalışır

### Merge policy tests

Kilitle:

- `Kadikoy` sonrası `Besiktas olsun` -> district replace
- `satilik` sonrası `kiralik olsun` -> listingType replace
- `50 bin alti` sonrası `70 bin alti olsun` -> price replace
- `replace_failed_free_text` eski semantic/anchor/negation state’i temizler

### Pagination tests

Kilitle:

- ilk shortlist okunduktan sonra `baska var mi` aynı ilanları tekrar döndürmez
- viewed list bittiğinde `exhausted_results` oluşur
- yeni arama başladığında `viewedListingIds` temizlenir

### Live smoke

Senaryolar:

1. `DEMO IST 3401`
2. `metroya yakin bir ev var mi`
3. `olmadi, bu sefer aileye uygun bak`
4. `avmye yakin bir sey bak`
5. `otoyola yakin olsun ama metro istemiyorum`
6. shortlist sonrası `baska var mi`

Kabul:

- eski başarısız intent yeni aramaya yapışmaz
- negative anchor doğru exclusion yapar
- anchor query’de alakasız approximate aday gelmez
- aynı shortlist tekrar tekrar okunmaz
- exact lookup davranışı bozulmaz

## Order

1. decomposition types + rule-based parser
2. Micro-LLM router with strict Structured Outputs and `700ms` timeout
3. merge policy implementation
4. anchor pre-filter + negation exclusion + pagination exclusion
5. `searchState` persistence in `call_logs.payload`
6. Retell service wiring
7. prompt alignment
8. repo tests
9. live smoke

## Assumptions

- router için düşük maliyetli hızlı model kullanılacak
- timeout, provider error veya schema failure search path’i bloklamayacak
- yeni DB tablosu açılmayacak
- reranker bu fazda eklenmeyecek
- liste birleşimi bu fazda desteklenmeyecek; tek değerli filtre overwrite modeli kullanılacak
- `referenceCode`, `showing_request`, publish flow, booking ve n8n bu fazın dışında
