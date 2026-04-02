import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import type { ListingsService } from "../src/modules/listings/service.js";
import {
  createInitialListingSearchState
} from "../src/modules/listings/service.js";
import type {
  ListingSearchResult,
  ListingSearchState
} from "../src/modules/listings/types.js";
import type { RetellRepository } from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";

const RETELL_SECRET = "retell-final-wiring-secret";
const OFFICE_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

interface SearchFixture {
  expectedViewedIds: string[];
  result: ListingSearchResult;
  nextState: ListingSearchState;
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

function createFakeRetellRepository(initialState: ListingSearchState | null) {
  const callLogs = new Map<
    string,
    {
      id: string;
      payload: Record<string, unknown>;
    }
  >([
    [
      "call-final-wiring",
      {
        id: "call-log-1",
        payload: initialState ? { searchState: initialState } : {}
      }
    ]
  ]);

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
      const callLogEntry = Array.from(callLogs.entries()).find(
        ([, value]) => value.id === callLogId
      );

      if (!callLogEntry) {
        return;
      }

      const [providerCallId] = callLogEntry;
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
      const searchState = callLogs.get(providerCallId)?.payload?.searchState;

      return searchState && typeof searchState === "object"
        ? (searchState as ListingSearchState)
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

function createFakeListingsService(fixtures: SearchFixture[]): ListingsService {
  return {
    async searchListingsDetailed(_filters, context) {
      const fixture = fixtures.shift();

      if (!fixture) {
        throw new Error("Missing search fixture.");
      }

      const receivedViewedIds = context?.searchState?.viewedListingIds ?? [];
      assert.deepEqual(receivedViewedIds, fixture.expectedViewedIds);
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

function createFakeShowingRequestsService(): ShowingRequestsService {
  return {
    async createShowingRequest() {
      throw new Error("createShowingRequest should not be called in this test");
    }
  };
}

async function executeSearch(input: {
  retellService: ReturnType<typeof createRetellService>;
  args: Record<string, unknown>;
}) {
  const body = {
    name: "search_listings",
    args: input.args,
    call: {
      call_id: "call-final-wiring",
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

async function executeLookup(input: {
  retellService: ReturnType<typeof createRetellService>;
  referenceCode: string;
}) {
  const body = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: input.referenceCode
    },
    call: {
      call_id: "call-final-wiring",
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

test("retell search wiring uses persisted viewed ids and returns the next-page shortlist", async () => {
  const firstState = buildState({
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    lastSearchOutcome: "success",
    viewedListingIds: ["listing-1"]
  });
  const secondState = buildState({
    ...firstState,
    viewedListingIds: ["listing-1", "listing-2"]
  });
  const fixtures: SearchFixture[] = [
    {
      expectedViewedIds: [],
      result: {
        listings: [buildListing("listing-1", "DEMO-IST-3401")],
        matchInterpretation: "hybrid_candidate"
      },
      nextState: firstState
    },
    {
      expectedViewedIds: ["listing-1"],
      result: {
        listings: [buildListing("listing-2", "DEMO-IST-3402")],
        matchInterpretation: "hybrid_candidate"
      },
      nextState: secondState
    }
  ];
  const retellRepository = createFakeRetellRepository(null);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService: createFakeListingsService(fixtures),
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  const firstResponse = await executeSearch({
    retellService,
    args: {
      queryText: "metroya yakin",
      limit: 3
    }
  });
  const secondResponse = await executeSearch({
    retellService,
    args: {
      queryText: "baska var mi",
      limit: 3
    }
  });
  const persistedState = retellRepository.callLogs.get("call-final-wiring")
    ?.payload.searchState as ListingSearchState | undefined;

  assert.equal(firstResponse.ok, true);
  assert.equal(secondResponse.ok, true);
  assert.equal(firstResponse.data.searchOutcome, "success");
  assert.equal(secondResponse.data.searchOutcome, "success");
  assert.equal(
    secondResponse.data.listings[0]?.referenceCode,
    "DEMO-IST-3402"
  );
  assert.deepEqual(persistedState?.viewedListingIds, [
    "listing-1",
    "listing-2"
  ]);
});

test("retell search wiring returns exhausted_results voice message when next-page has no remaining candidates", async () => {
  const firstState = buildState({
    activeSemanticIntent: "metroya yakin",
    activeMustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
    lastSearchOutcome: "success",
    viewedListingIds: ["listing-1"]
  });
  const exhaustedState = buildState({
    ...firstState,
    lastSearchOutcome: "exhausted_results",
    viewedListingIds: ["listing-1"]
  });
  const fixtures: SearchFixture[] = [
    {
      expectedViewedIds: ["listing-1"],
      result: {
        listings: [],
        matchInterpretation: "no_match"
      },
      nextState: exhaustedState
    }
  ];
  const retellRepository = createFakeRetellRepository(firstState);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService: createFakeListingsService(fixtures),
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  const response = await executeSearch({
    retellService,
    args: {
      queryText: "baska var mi",
      limit: 3
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.searchOutcome, "exhausted_results");
  assert.equal(
    response.data.searchOutcomeMessage,
    "Bu arama icin su an baska dogrulanmis aday kalmadi."
  );
  assert.match(response.data.nextSuggestion, /yeni bir ilce|butce|sifirdan/i);
});

test("selected listing context is persisted after lookup and does not collide with later portfolio search", async () => {
  const initialState = buildState({
    activeStructuredCriteria: {
      district: "Kadikoy"
    },
    lastSearchOutcome: "success"
  });
  let observedSelectedListingCode: string | null = null;
  const nextSearchState = buildState({
    ...initialState,
    activeSemanticIntent: "metroya yakin",
    selectedListingReferenceCode: null,
    selectedListingFactsForContext: null
  });
  const listingsService: ListingsService = {
    async searchListingsDetailed(_filters, context) {
      observedSelectedListingCode =
        context?.searchState?.selectedListingReferenceCode ?? null;
      context?.onSearchStateResolved?.(nextSearchState);

      return {
        listings: [buildListing("listing-1", "DEMO-IST-3401")],
        matchInterpretation: "hybrid_candidate"
      };
    },
    async searchListings() {
      return [];
    },
    async getListingByReference() {
      return {
        id: "listing-1",
        referenceCode: "DEMO-IST-3401",
        title: "DEMO-IST-3401 Listing",
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
        description: null,
        grossM2: 105,
        floorNumber: 4,
        buildingAge: 8,
        dues: 1200,
        addressText: null,
        hasBalcony: true,
        hasParking: false,
        hasElevator: true
      };
    },
    async refreshMainSearchDocument() {
      throw new Error(
        "refreshMainSearchDocument should not be called in this test"
      );
    }
  };
  const retellRepository = createFakeRetellRepository(initialState);
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });

  const lookupResponse = await executeLookup({
    retellService,
    referenceCode: "DEMO-IST-3401"
  });
  assert.equal(lookupResponse.ok, true);

  await executeSearch({
    retellService,
    args: {
      queryText: "metroya yakin",
      limit: 3
    }
  });

  assert.equal(observedSelectedListingCode, "DEMO-IST-3401");
  const persistedState = retellRepository.callLogs.get("call-final-wiring")
    ?.payload.searchState as ListingSearchState | undefined;

  assert.equal(persistedState?.selectedListingReferenceCode, null);
  assert.equal(persistedState?.selectedListingFactsForContext, null);
});
