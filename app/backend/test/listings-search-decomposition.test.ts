import assert from "node:assert/strict";
import test from "node:test";

import {
  decomposeListingSearchPlan,
  normalizeListingSearchText
} from "../src/modules/listings/decomposition.js";
import type { SearchListingsFilters } from "../src/modules/listings/types.js";

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

test("decomposition extracts positive anchor and semantic intent", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({
      listingType: "rent",
      queryText: "metroya yakin aileye uygun bir daire bak"
    })
  );

  assert.equal(plan.intentMode, "new_search");
  assert.equal(plan.paginationAction, "none");
  assert.deepEqual(
    plan.mustAnchorTerms.map((term) => term.canonical),
    ["metro"]
  );
  assert.deepEqual(plan.negatedTerms, []);
  assert.equal(plan.semanticIntent, "aileye uygun bak");
  assert.equal(plan.structuredFilters.listingType, "rent");
});

test("decomposition captures negated anchor instead of positive anchor", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({
      queryText: "metroya cok yakin olmasin, gurultu yapiyor"
    })
  );

  assert.deepEqual(plan.mustAnchorTerms, []);
  assert.deepEqual(
    plan.negatedTerms.map((term) => term.canonical),
    ["metro"]
  );
  assert.equal(plan.intentMode, "new_search");
  assert.equal(plan.semanticIntent, "cok gurultu yapiyor");
});

test("decomposition supports root-based proximity variants for multiple anchors", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({
      queryText: "metronun hemen yani avmye yakin bir sey bak"
    })
  );

  assert.deepEqual(
    plan.mustAnchorTerms.map((term) => term.canonical),
    ["metro", "avm"]
  );
  assert.deepEqual(plan.negatedTerms, []);
});

test("decomposition marks next_page intent for repeated shortlist request", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({ queryText: "baska var mi" }),
    { hasActiveSearch: true, lastSearchOutcome: "success" }
  );

  assert.equal(plan.intentMode, "next_page");
  assert.equal(plan.paginationAction, "next_page");
  assert.equal(plan.clearSelectedListingContext, false);
});

test("decomposition marks replace_failed_free_text after previous no_match", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({ queryText: "aileye uygun bak" }),
    { hasActiveSearch: true, lastSearchOutcome: "no_match" }
  );

  assert.equal(plan.intentMode, "replace_failed_free_text");
  assert.equal(plan.clearSelectedListingContext, true);
});

test("decomposition keeps refine_search when active search is still ongoing", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({ queryText: "fiyati biraz dusur, 50 bin alti olsun" }),
    { hasActiveSearch: true, lastSearchOutcome: "success" }
  );

  assert.equal(plan.intentMode, "refine_search");
  assert.equal(plan.paginationAction, "none");
  assert.equal(plan.clearSelectedListingContext, false);
});

test("decomposition marks reset language as new search", () => {
  const plan = decomposeListingSearchPlan(
    buildFilters({ queryText: "vazgectim, avmye yakin bak" }),
    { hasActiveSearch: true, lastSearchOutcome: "success" }
  );

  assert.equal(plan.intentMode, "new_search");
  assert.equal(plan.clearSelectedListingContext, true);
  assert.deepEqual(
    plan.mustAnchorTerms.map((term) => term.canonical),
    ["avm"]
  );
});

test("search text normalization maps Turkish characters to ASCII", () => {
  const normalized = normalizeListingSearchText("Çok Şık İlan, Üsküdar");

  assert.equal(normalized, "cok sik ilan uskudar");
});
