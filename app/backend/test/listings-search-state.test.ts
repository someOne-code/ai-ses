import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import type { ListingsService } from "../src/modules/listings/service.js";
import type {
  ListingSearchResult,
  ListingSearchState
} from "../src/modules/listings/types.js";
import { createInitialListingSearchState } from "../src/modules/listings/service.js";
import type { RetellRepository } from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";

const RETELL_SECRET = "retell-test-secret";
const OFFICE_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

interface StoredCallLog {
  id: string;
  payload: Record<string, unknown>;
}

interface SearchExecutionFixture {
  result: ListingSearchResult;
  nextState: ListingSearchState;
}

function buildShortlistResult(
  overrides: Partial<ListingSearchResult>
): ListingSearchResult {
  return {
    listings: [],
    matchInterpretation: "no_match",
    ...overrides
  };
}

function buildListing(id: string, referenceCode: string) {
  return {
    id,
    referenceCode,
    title: `${referenceCode} Listing`,
    listingType: "rent",
    propertyType: "apartment",
    price: 65000,
    currency: "TRY",
    bedrooms: 2,
    bathrooms: 1,
    netM2: 95,
    district: "Kadikoy",
    neighborhood: "Moda",
    status: "active",
    dues: 1200,
    buildingAge: 8,
    hasBalcony: true,
    hasParking: false,
    hasElevator: true,
    matchSource: "hybrid" as const,
    approximate: true,
    cosineDistance: 0.34
  };
}

function buildState(overrides: Partial<ListingSearchState>): ListingSearchState {
  return {
    ...createInitialListingSearchState(new Date("2026-04-02T00:00:00.000Z")),
    ...overrides
  };
}

function createFakeListingsService(
  fixtures: SearchExecutionFixture[]
): ListingsService {
  return {
    async searchListingsDetailed(_filters, context) {
      const fixture = fixtures.shift();

      if (!fixture) {
        throw new Error("Missing search fixture.");
      }

      context?.onSearchStateResolved?.(fixture.nextState);

      return fixture.result;
    },
    async searchListings() {
      return [];
    },
    async getListingByReference() {
      throw new Error("getListingByReference should not be called in this test");
    },
    async refreshMainSearchDocument() {
      throw new Error(
        "refreshMainSearchDocument should not be called in this test"
      );
    }
  };
}

function createFakeRetellRepository(
  initialCallLogs: Array<{ callId: string; payload: Record<string, unknown> }>
) {
  const callLogs = new Map<string, StoredCallLog>(
    initialCallLogs.map((entry, index) => [
      entry.callId,
      {
        id: `call-log-${index + 1}`,
        payload: { ...entry.payload }
      }
    ])
  );
  const repository: RetellRepository = {
    async findOfficeContextById(officeId) {
      if (officeId !== OFFICE_ID) {
        return null;
      }

      return {
        officeId: OFFICE_ID,
        tenantId: TENANT_ID
      };
    },
    async findOfficeContextByPhoneNumbers() {
      return null;
    },
    async findCallLogByProviderCallId(providerCallId) {
      const callLog = callLogs.get(providerCallId);

      if (!callLog) {
        return null;
      }

      return {
        id: callLog.id,
        payload: callLog.payload
      };
    },
    async createCallLog(input) {
      callLogs.set(input.providerCallId, {
        id: `call-log-${callLogs.size + 1}`,
        payload:
          typeof input.payload === "object" && input.payload !== null
            ? { ...(input.payload as Record<string, unknown>) }
            : {}
      });
    },
    async updateCallLog(callLogId, input) {
      const currentEntry = Array.from(callLogs.entries()).find(
        ([, value]) => value.id === callLogId
      );

      if (!currentEntry) {
        return;
      }

      const [providerCallId] = currentEntry;
      callLogs.set(providerCallId, {
        id: callLogId,
        payload:
          typeof input.payload === "object" && input.payload !== null
            ? { ...(input.payload as Record<string, unknown>) }
            : {}
      });
    },
    async createAuditEvent() {
      return;
    },
    async findCallSearchState(providerCallId) {
      const payload = callLogs.get(providerCallId)?.payload;
      const state = payload?.searchState;

      return state && typeof state === "object"
        ? (state as ListingSearchState)
        : null;
    },
    async updateCallSearchState(providerCallId, nextState) {
      const callLog = callLogs.get(providerCallId);

      if (!callLog) {
        return null;
      }

      callLogs.set(providerCallId, {
        ...callLog,
        payload: {
          ...callLog.payload,
          searchState: nextState
        }
      });

      return nextState;
    }
  };

  return {
    repository,
    callLogs
  };
}

async function executeSearchListingsTool(input: {
  retellService: ReturnType<typeof createRetellService>;
  callId: string;
  args: Record<string, unknown>;
}) {
  const body = {
    name: "search_listings",
    args: input.args,
    call: {
      call_id: input.callId,
      metadata: {
        office_id: OFFICE_ID
      }
    }
  };
  const rawBody = JSON.stringify(body);
  const signature = await sign(rawBody, RETELL_SECRET);

  return input.retellService.executeTool({
    signature,
    body,
    rawBody
  });
}

function createFakeShowingRequestsService(): ShowingRequestsService {
  return {
    async createShowingRequest() {
      throw new Error("createShowingRequest should not be called in this test");
    }
  };
}

test("search state is persisted into call_logs payload after successful shortlist", async () => {
  const callId = "call-search-state-success";
  const nextState = buildState({
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    lastSearchOutcome: "success",
    viewedListingIds: ["listing-1"]
  });
  const listingsService = createFakeListingsService([
    {
      result: buildShortlistResult({
        listings: [buildListing("listing-1", "DEMO-IST-3401")],
        matchInterpretation: "hybrid_candidate"
      }),
      nextState
    }
  ]);
  const retellRepository = createFakeRetellRepository([
    {
      callId,
      payload: {
        event: "call_started"
      }
    }
  ]);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  const result = await executeSearchListingsTool({
    retellService,
    callId,
    args: {
      queryText: "metroya yakin",
      limit: 3
    }
  });
  const storedPayload = retellRepository.callLogs.get(callId)?.payload;

  assert.equal(result.ok, true);
  assert.ok(storedPayload);
  assert.equal(storedPayload?.event, "call_started");
  assert.deepEqual(storedPayload?.searchState, nextState);
});

test("no_match free-text attempt does not overwrite previously successful semantic intent", async () => {
  const callId = "call-search-state-no-match";
  const previousState = buildState({
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    activeNegatedTerms: [],
    lastSearchOutcome: "success",
    viewedListingIds: ["listing-1"]
  });
  const nextStateFromSearch = buildState({
    activeSemanticIntent: "aileye uygun",
    activeMustAnchorTerms: [{ canonical: "park", raw: "parka" }],
    activeNegatedTerms: [],
    lastSearchOutcome: "no_match",
    lastUserSearchText: "aileye uygun",
    viewedListingIds: []
  });
  const listingsService = createFakeListingsService([
    {
      result: buildShortlistResult({
        listings: [],
        matchInterpretation: "no_match"
      }),
      nextState: nextStateFromSearch
    }
  ]);
  const retellRepository = createFakeRetellRepository([
    {
      callId,
      payload: {
        searchState: previousState
      }
    }
  ]);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  const result = await executeSearchListingsTool({
    retellService,
    callId,
    args: {
      queryText: "aileye uygun",
      limit: 3
    }
  });
  const persistedState = retellRepository.callLogs.get(callId)?.payload
    ?.searchState as ListingSearchState | undefined;

  assert.equal(result.ok, true);
  assert.ok(persistedState);
  assert.equal(persistedState?.activeSemanticIntent, "metroya yakin");
  assert.deepEqual(persistedState?.activeMustAnchorTerms, [
    { canonical: "metro", raw: "metroya" }
  ]);
  assert.equal(persistedState?.lastSearchOutcome, "no_match");
});

test("viewedListingIds are updated and preserved across pagination turns", async () => {
  const callId = "call-search-state-pagination";
  const initialState = buildState({
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    lastSearchOutcome: "success",
    viewedListingIds: ["listing-1"]
  });
  const listingsService = createFakeListingsService([
    {
      result: buildShortlistResult({
        listings: [buildListing("listing-2", "DEMO-IST-3402")],
        matchInterpretation: "hybrid_candidate"
      }),
      nextState: buildState({
        ...initialState,
        viewedListingIds: ["listing-1", "listing-2"],
        lastSearchOutcome: "success"
      })
    },
    {
      result: buildShortlistResult({
        listings: [],
        matchInterpretation: "no_match"
      }),
      nextState: buildState({
        ...initialState,
        viewedListingIds: ["listing-1", "listing-2"],
        lastSearchOutcome: "exhausted_results"
      })
    }
  ]);
  const retellRepository = createFakeRetellRepository([
    {
      callId,
      payload: {
        searchState: initialState
      }
    }
  ]);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  await executeSearchListingsTool({
    retellService,
    callId,
    args: {
      limit: 3
    }
  });

  const afterFirstPage = retellRepository.callLogs.get(callId)?.payload
    ?.searchState as ListingSearchState | undefined;
  assert.deepEqual(afterFirstPage?.viewedListingIds, ["listing-1", "listing-2"]);

  await executeSearchListingsTool({
    retellService,
    callId,
    args: {
      limit: 3
    }
  });

  const afterSecondPage = retellRepository.callLogs.get(callId)?.payload
    ?.searchState as ListingSearchState | undefined;
  assert.deepEqual(afterSecondPage?.viewedListingIds, [
    "listing-1",
    "listing-2"
  ]);
  assert.equal(afterSecondPage?.lastSearchOutcome, "exhausted_results");
});
