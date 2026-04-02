import assert from "node:assert/strict";
import test from "node:test";

import { decomposeListingSearchPlan } from "../src/modules/listings/decomposition.js";
import {
  createListingSearchRouter,
  LISTING_SEARCH_ROUTER_TIMEOUT_MS
} from "../src/modules/listings/router.js";
import { createListingsService } from "../src/modules/listings/service.js";
import type {
  DecomposedListingSearchPlan,
  SearchListingsFilters
} from "../src/modules/listings/types.js";

function buildFilters(
  overrides: Partial<SearchListingsFilters> = {}
): SearchListingsFilters {
  const queryText = overrides.queryText;

  return {
    officeId: "22222222-2222-4222-8222-222222222222",
    searchMode: queryText ? "hybrid" : "structured",
    limit: 5,
    ...overrides
  };
}

function buildPlan(
  filters: SearchListingsFilters,
  state?: { hasActiveSearch: boolean; lastSearchOutcome?: "success" | "no_match" | "none" | "exhausted_results" }
): DecomposedListingSearchPlan {
  return decomposeListingSearchPlan(filters, state);
}

test("router falls back to rule-based plan after hard timeout", async () => {
  const filters = buildFilters({
    queryText: "metroya yakin bir ev bak"
  });
  const state = {
    hasActiveSearch: true,
    lastSearchOutcome: "success" as const
  };
  const fallback = buildPlan(filters, state);
  const router = createListingSearchRouter({
    client: {
      models: {
        async generateContent(input) {
          return new Promise((_, reject) => {
            input.config.abortSignal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true }
            );
          });
        }
      }
    }
  });
  const startedAt = Date.now();
  const result = await router.decompose(filters, { state });
  const elapsedMs = Date.now() - startedAt;

  assert.deepEqual(result, fallback);
  assert.ok(elapsedMs >= LISTING_SEARCH_ROUTER_TIMEOUT_MS - 80);
  assert.ok(elapsedMs < LISTING_SEARCH_ROUTER_TIMEOUT_MS + 600);
});

test("router falls back to rule-based plan on schema-invalid json output", async () => {
  const filters = buildFilters({
    queryText: "fiyat biraz dusuk olsun"
  });
  const state = {
    hasActiveSearch: true,
    lastSearchOutcome: "success" as const
  };
  const fallback = buildPlan(filters, state);
  const router = createListingSearchRouter({
    client: {
      models: {
        async generateContent() {
          return {
            text: JSON.stringify({
              intentMode: "unexpected_value"
            })
          };
        }
      }
    }
  });

  const result = await router.decompose(filters, { state });

  assert.deepEqual(result, fallback);
});

test("router returns valid intent mode when structured output is valid", async () => {
  const filters = buildFilters({
    district: "Kadikoy",
    queryText: "vazgectim besiktas olsun"
  });
  const state = {
    hasActiveSearch: true,
    lastSearchOutcome: "success" as const
  };
  let seenResponseMimeType: string | null = null;
  let seenModel: string | null = null;
  const router = createListingSearchRouter({
    client: {
      models: {
        async generateContent(input) {
          seenResponseMimeType = input.config.responseMimeType;
          seenModel = input.model;

          return {
            text: JSON.stringify({
              intentMode: "new_search",
              structuredFiltersPatch: {
                district: "Besiktas"
              },
              structuredFiltersAction: "replace",
              semanticIntent: "besiktasta uygun daire",
              mustAnchorTerms: [],
              negatedTerms: [],
              clearSelectedListingContext: true,
              paginationAction: "none"
            })
          };
        }
      }
    }
  });

  const result = await router.decompose(filters, { state });

  assert.equal(seenModel, "gemini-3.1-flash-lite-preview");
  assert.equal(seenResponseMimeType, "application/json");
  assert.equal(result.intentMode, "new_search");
  assert.equal(result.structuredFilters.district, "Besiktas");
  assert.equal(result.semanticIntent, "besiktasta uygun daire");
  assert.equal(result.clearSelectedListingContext, true);
});

test("listings service applies router plan before repository search", async () => {
  const filters = buildFilters({
    district: "Kadikoy",
    queryText: "vazgectim besiktas olsun"
  });
  const fallback = buildPlan(filters, {
    hasActiveSearch: true,
    lastSearchOutcome: "success"
  });
  const planned: DecomposedListingSearchPlan = {
    ...fallback,
    intentMode: "new_search",
    structuredFilters: {
      ...fallback.structuredFilters,
      district: "Besiktas"
    },
    structuredFiltersPatch: {
      district: "Besiktas"
    },
    structuredFiltersAction: "replace",
    semanticIntent: "besiktasta uygun daire",
    appliedQueryText: "besiktasta uygun daire"
  };
  let capturedFilters: SearchListingsFilters | null = null;
  const service = createListingsService(
    {
      async search(inputFilters) {
        capturedFilters = inputFilters;

        return {
          listings: [],
          matchInterpretation: "no_match" as const
        };
      },
      async findByReference() {
        return { kind: "not_found" as const };
      },
      async findActiveById() {
        return null;
      }
    } as never,
    {
      searchRouter: {
        async decompose() {
          return planned;
        }
      }
    }
  );

  await service.searchListingsDetailed(filters, {
    routerState: { hasActiveSearch: true, lastSearchOutcome: "success" }
  });

  assert.equal(capturedFilters?.district, "Besiktas");
  assert.equal(capturedFilters?.queryText, "besiktasta uygun daire");
  assert.equal(capturedFilters?.searchMode, "hybrid");
});
