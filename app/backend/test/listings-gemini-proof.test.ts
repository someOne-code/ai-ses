import assert from "node:assert/strict";
import test from "node:test";

import { GoogleGenAI } from "@google/genai";

import { env } from "../src/config/env.js";
import { decomposeListingSearchPlan } from "../src/modules/listings/decomposition.js";
import { createListingSearchRouter } from "../src/modules/listings/router.js";
import type {
  ListingSearchRouterState,
  SearchListingsFilters
} from "../src/modules/listings/types.js";

test(
  "gemini router deep-trace proof: abstract student query is routed with live model response",
  async (t) => {
    if (!env.GEMINI_API_KEY) {
      t.skip("GEMINI_API_KEY not set in environment.");
      return;
    }

    const filters: SearchListingsFilters = {
      officeId: "22222222-2222-4222-8222-222222222222",
      searchMode: "hybrid",
      limit: 5,
      queryText:
        "Ya aslında öğrenciyim, okula yakın ama çok gürültülü olmayan, bütçe dostu bir şeyler bakıyorum."
    };
    const routerState: ListingSearchRouterState = {
      hasActiveSearch: false,
      lastSearchOutcome: "no_match"
    };
    const fallbackPlan = decomposeListingSearchPlan(filters, routerState);

    console.log(
      "🧪 [GEMINI-PROOF] Rule-based fallback:",
      JSON.stringify(fallbackPlan, null, 2)
    );

    // 1) Current configured alias check (Task-2 configured model name).
    const configuredAliasRouter = createListingSearchRouter({
      client: new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY
      }),
      model: "gemini-3.1-flash-lite",
      timeoutMs: 6000
    });
    const configuredAliasResult = await configuredAliasRouter.decompose(filters, {
      state: routerState
    });
    console.log(
      "🧪 [GEMINI-PROOF] Configured alias result:",
      JSON.stringify(configuredAliasResult, null, 2)
    );

    // 2) Live proof with the currently available Lite preview model.
    const liveRouter = createListingSearchRouter({
      client: new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY
      }),
      model: "gemini-3.1-flash-lite-preview",
      timeoutMs: 6000
    });

    const result = await liveRouter.decompose(filters, { state: routerState });

    console.log(
      "🧪 [GEMINI-PROOF] Live router result:",
      JSON.stringify(result, null, 2)
    );

    assert.ok(
      ["new_search", "refine_search", "replace_failed_free_text", "next_page"].includes(
        result.intentMode
      )
    );
    assert.equal(typeof result.clearSelectedListingContext, "boolean");
    assert.equal(typeof result.structuredFiltersAction, "string");
    assert.equal(result.appliedQueryText, filters.queryText);
  }
);
