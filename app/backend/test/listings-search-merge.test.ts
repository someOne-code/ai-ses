import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialListingSearchState,
  mergeListingSearchState
} from "../src/modules/listings/service.js";
import type {
  DecomposedListingSearchPlan,
  ListingSearchResult,
  ListingSearchState
} from "../src/modules/listings/types.js";

function buildResult(
  overrides: Partial<ListingSearchResult> = {}
): ListingSearchResult {
  return {
    listings: [],
    matchInterpretation: "no_match",
    ...overrides
  };
}

function buildPlan(
  overrides: Partial<DecomposedListingSearchPlan>
): DecomposedListingSearchPlan {
  return {
    structuredFilters: {},
    semanticIntent: null,
    mustAnchorTerms: [],
    negatedTerms: [],
    intentMode: "new_search",
    structuredFiltersPatch: {},
    structuredFiltersAction: "replace",
    clearSelectedListingContext: false,
    paginationAction: "none",
    appliedQueryText: null,
    ...overrides
  };
}

function buildState(overrides: Partial<ListingSearchState>): ListingSearchState {
  return {
    ...createInitialListingSearchState(new Date("2026-04-02T00:00:00.000Z")),
    ...overrides
  };
}

test("merge policy overwrites district on refine_search (Kadikoy -> Besiktas)", () => {
  const previousState = buildState({
    activeStructuredCriteria: {
      district: "Kadikoy",
      listingType: "rent",
      minBedrooms: 2
    },
    lastSearchOutcome: "success"
  });
  const plan = buildPlan({
    intentMode: "refine_search",
    structuredFiltersPatch: {
      district: "Besiktas"
    },
    structuredFiltersAction: "replace",
    appliedQueryText: "besiktas olsun"
  });
  const result = buildResult({
    matchInterpretation: "hybrid_candidate",
    listings: [
      {
        id: "listing-1",
        referenceCode: "DEMO-IST-3402",
        title: "Besiktas Search Fixture",
        listingType: "rent",
        propertyType: "apartment",
        price: 65000,
        currency: "TRY",
        bedrooms: 2,
        bathrooms: 1,
        netM2: 95,
        district: "Besiktas",
        neighborhood: "Levent",
        status: "active",
        dues: 1200,
        buildingAge: 8,
        hasBalcony: true,
        hasParking: false,
        hasElevator: true,
        matchSource: "hybrid",
        approximate: true,
        cosineDistance: 0.33
      }
    ]
  });

  const nextState = mergeListingSearchState({
    previousState,
    plan,
    result
  });

  assert.equal(nextState.activeStructuredCriteria.district, "Besiktas");
  assert.equal(nextState.activeStructuredCriteria.listingType, "rent");
  assert.equal(nextState.activeStructuredCriteria.minBedrooms, 2);
  assert.equal(nextState.lastSearchOutcome, "success");
});

test("replace_failed_free_text clears stale semantic intent and anchor terms after no_match", () => {
  const previousState = buildState({
    activeStructuredCriteria: {
      listingType: "rent"
    },
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    activeNegatedTerms: [{ canonical: "avm", raw: "avm" }],
    lastSearchOutcome: "no_match"
  });
  const plan = buildPlan({
    intentMode: "replace_failed_free_text",
    semanticIntent: "aileye uygun",
    mustAnchorTerms: [{ canonical: "park", raw: "parka" }],
    negatedTerms: [],
    appliedQueryText: "aileye uygun bak"
  });
  const result = buildResult({
    matchInterpretation: "no_match"
  });

  const nextState = mergeListingSearchState({
    previousState,
    plan,
    result
  });

  assert.equal(nextState.activeSemanticIntent, "aileye uygun");
  assert.deepEqual(nextState.activeMustAnchorTerms, [
    { canonical: "park", raw: "parka" }
  ]);
  assert.deepEqual(nextState.activeNegatedTerms, []);
  assert.equal(nextState.lastSearchOutcome, "no_match");
});

test("new_search reset language flushes old state and selected listing context", () => {
  const previousState = buildState({
    activeStructuredCriteria: {
      district: "Kadikoy",
      listingType: "sale",
      minPrice: 8_000_000,
      minBedrooms: 3
    },
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    lastSearchOutcome: "success",
    selectedListingReferenceCode: "DEMO-IST-3401",
    selectedListingFactsForContext: {
      district: "Kadikoy",
      neighborhood: "Moda",
      listingType: "sale"
    },
    viewedListingIds: ["listing-old"]
  });
  const plan = buildPlan({
    intentMode: "new_search",
    structuredFilters: {
      district: "Besiktas"
    },
    structuredFiltersPatch: {
      district: "Besiktas"
    },
    structuredFiltersAction: "replace",
    semanticIntent: "aileye uygun",
    mustAnchorTerms: [],
    negatedTerms: [],
    clearSelectedListingContext: true,
    appliedQueryText: "bosver, aileye uygun besiktas bak"
  });
  const result = buildResult({
    matchInterpretation: "no_match"
  });

  const nextState = mergeListingSearchState({
    previousState,
    plan,
    result
  });

  assert.deepEqual(nextState.activeStructuredCriteria, {
    district: "Besiktas"
  });
  assert.equal(nextState.activeSemanticIntent, "aileye uygun");
  assert.equal(nextState.selectedListingReferenceCode, null);
  assert.equal(nextState.selectedListingFactsForContext, null);
  assert.deepEqual(nextState.viewedListingIds, []);
  assert.equal(nextState.lastSearchOutcome, "no_match");
});
