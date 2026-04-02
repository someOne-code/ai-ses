import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import { AppError } from "../src/lib/errors.js";
import { createIntegrationsService } from "../src/modules/integrations/service.js";
import type { ListingsService } from "../src/modules/listings/service.js";
import type {
  ListingDetail,
  ListingSearchResult,
  ListingSearchItem,
  SearchListingsFilters
} from "../src/modules/listings/types.js";
import type {
  CreateAuditEventInput,
  RetellRepository,
  UpsertCallLogInput
} from "../src/modules/retell/repository.js";
import {
  getRepairStepCallerMessage,
  toCanonicalRepairStep,
  toCanonicalVoiceFieldErrors
} from "../src/modules/retell/repair-messages.js";
import { createRetellService } from "../src/modules/retell/service.js";
import { retellToolContracts } from "../src/modules/retell/types.js";
import {
  createShowingRequestsService,
  type ShowingRequestsService
} from "../src/modules/showing-requests/service.js";
import type { ShowingRequestRecord } from "../src/modules/showing-requests/types.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ai_ses";
process.env.RETELL_API_KEY ??= "retell-api-key-test";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

const RETELL_SECRET = "retell-test-secret";
const RETELL_API_KEY = "retell-api-key-test";
const TENANT_1_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OFFICE_1_ID = "11111111-1111-4111-8111-111111111111";
const OFFICE_2_ID = "22222222-2222-4222-8222-222222222222";

interface ListingFixture extends ListingDetail {
  officeId: string;
}

const LISTING_FIXTURES: ListingFixture[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    officeId: OFFICE_1_ID,
    referenceCode: "REF-001",
    title: "Kadikoy Family Flat",
    listingType: "sale",
    propertyType: "apartment",
    price: 6500000,
    currency: "TRY",
    bedrooms: 3,
    bathrooms: 2,
    netM2: 135,
    district: "Kadikoy",
    neighborhood: "Moda",
    status: "active",
    description: "Bright apartment near the coast.",
    grossM2: 150,
    floorNumber: 4,
    buildingAge: 6,
    dues: 1500,
    addressText: "Moda, Kadikoy, Istanbul",
    hasBalcony: true,
    hasParking: false,
    hasElevator: true
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    officeId: OFFICE_1_ID,
    referenceCode: "REF-002",
    title: "Kadikoy Budget Rental",
    listingType: "rent",
    propertyType: "apartment",
    price: 45000,
    currency: "TRY",
    bedrooms: 1,
    bathrooms: 1,
    netM2: 65,
    district: "Kadikoy",
    neighborhood: "Fenerbahce",
    status: "active",
    description: "Compact rental near the marina.",
    grossM2: 72,
    floorNumber: 2,
    buildingAge: 12,
    dues: 500,
    addressText: "Fenerbahce, Kadikoy, Istanbul",
    hasBalcony: false,
    hasParking: false,
    hasElevator: true
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    officeId: OFFICE_2_ID,
    referenceCode: "REF-900",
    title: "Uskudar Villa",
    listingType: "sale",
    propertyType: "villa",
    price: 18500000,
    currency: "TRY",
    bedrooms: 5,
    bathrooms: 3,
    netM2: 280,
    district: "Uskudar",
    neighborhood: "Beylerbeyi",
    status: "active",
    description: "Large villa with Bosphorus access.",
    grossM2: 320,
    floorNumber: null,
    buildingAge: 15,
    dues: null,
    addressText: "Beylerbeyi, Uskudar, Istanbul",
    hasBalcony: true,
    hasParking: true,
    hasElevator: false
  }
];

function createFakeListingsService(): ListingsService {
  async function searchListingsDetailed(
    filters: SearchListingsFilters
  ): Promise<ListingSearchResult> {
    const listings = LISTING_FIXTURES
      .filter((listing) => listing.officeId === filters.officeId)
      .filter((listing) =>
        filters.district ? listing.district === filters.district : true
      )
      .slice(0, filters.limit)
      .map(({ officeId: _officeId, ...listing }) => listing);

    return {
      listings,
      matchInterpretation:
        filters.searchMode === "hybrid" && filters.queryText
          ? "hybrid_candidate"
          : "verified_structured_match"
    };
  }

  return {
    searchListingsDetailed,
    async searchListings(filters) {
      const result = await searchListingsDetailed(filters);

      return result.listings;
    },
    async getListingByReference(params) {
      const listing = LISTING_FIXTURES.find(
        (entry) =>
          entry.officeId === params.officeId &&
          entry.referenceCode === params.referenceCode
      );

      if (!listing) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      const { officeId: _officeId, ...detail } = listing;

      return detail;
    }
  };
}

function createFakeShowingRequestsService() {
  const createdRequests: ShowingRequestRecord[] = [];

  const service: ShowingRequestsService = {
    async createShowingRequest(input) {
      const listing = LISTING_FIXTURES.find(
        (entry) =>
          entry.officeId === input.officeId && entry.id === input.listingId
      );

      if (!listing) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      const record = {
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        officeId: input.officeId,
        listingId: input.listingId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail ?? null,
        preferredTimeWindow: input.preferredTimeWindow ?? null,
        preferredDatetime: input.preferredDatetime.toISOString(),
        status: "pending",
        createdAt: "2026-03-24T09:30:00.000Z"
      };

      createdRequests.push(record);

      return record;
    }
  };

  return { service, createdRequests };
}

function createFakeRetellRepository() {
  const auditEvents: CreateAuditEventInput[] = [];
  const callLogs = new Map<
    string,
    UpsertCallLogInput & {
      id: string;
    }
  >();
  const phoneNumberOfficeMap = new Map([
    ["+905550000001", { officeId: OFFICE_1_ID, tenantId: TENANT_1_ID }]
  ]);

  const repository: RetellRepository = {
    async findOfficeContextById(officeId) {
      if (officeId === OFFICE_1_ID) {
        return { officeId: OFFICE_1_ID, tenantId: TENANT_1_ID };
      }

      return null;
    },
    async findOfficeContextByPhoneNumbers(phoneNumbers) {
      for (const phoneNumber of phoneNumbers) {
        const match = phoneNumberOfficeMap.get(phoneNumber);

        if (match) {
          return match;
        }
      }

      return null;
    },
    async findCallLogByProviderCallId(providerCallId) {
      const callLog = callLogs.get(providerCallId);

      return callLog ? { id: callLog.id } : null;
    },
    async createCallLog(input) {
      callLogs.set(input.providerCallId, {
        id: `call-log-${callLogs.size + 1}`,
        ...input
      });
    },
    async updateCallLog(callLogId, input) {
      callLogs.set(input.providerCallId, {
        id: callLogId,
        ...input
      });
    },
    async createAuditEvent(input) {
      auditEvents.push(input);
    }
  };

  return { repository, auditEvents, callLogs };
}

test("retell tool contracts expose the phase-1 backed tools", () => {
  assert.deepEqual(
    retellToolContracts.map((tool) => tool.name),
    ["search_listings", "get_listing_by_reference", "create_showing_request"]
  );
});

test("search_listings contract tells the agent to drop stale subjective intent after criteria change", () => {
  const searchTool = retellToolContracts.find(
    (tool) => tool.name === "search_listings"
  );

  assert.ok(searchTool);
  assert.match(
    searchTool.description,
    /latest active criteria|latest request/i
  );
  assert.match(searchTool.description, /do not carry over an old free-text intent/i);

  const queryTextProperty = searchTool.parameters.properties.queryText as {
    description?: string;
  };

  assert.match(
    queryTextProperty.description ?? "",
    /still active in the caller's latest request/i
  );
});

test("search and detail contracts separate shortlist answers from selected-listing detail lookup", () => {
  const searchTool = retellToolContracts.find(
    (tool) => tool.name === "search_listings"
  );
  const referenceTool = retellToolContracts.find(
    (tool) => tool.name === "get_listing_by_reference"
  );

  assert.ok(searchTool);
  assert.ok(referenceTool);
  assert.match(searchTool.description, /shortlist-level search output/i);
  assert.match(
    searchTool.description,
    /call get_listing_by_reference with that listing's verified referenceCode before answering/i
  );
  assert.match(
    searchTool.description,
    /dues|aidat|building age|floor|elevator|balcony|parking|address/i
  );
  assert.match(
    referenceTool.description,
    /follow-up detail questions about one selected listing/i
  );
});

test("tool contracts forbid reading internal structure or raw formatting aloud", () => {
  const searchTool = retellToolContracts.find(
    (tool) => tool.name === "search_listings"
  );
  const referenceTool = retellToolContracts.find(
    (tool) => tool.name === "get_listing_by_reference"
  );
  const showingTool = retellToolContracts.find(
    (tool) => tool.name === "create_showing_request"
  );

  assert.ok(searchTool);
  assert.ok(referenceTool);
  assert.ok(showingTool);

  assert.match(
    searchTool.description,
    /never read raw keys, JSON fragments, tool formatting, field labels, or raw English title text aloud/i
  );
  assert.match(searchTool.description, /raw English title text/i);
  assert.match(
    searchTool.description,
    /short natural Turkish sentences/i
  );
  assert.match(searchTool.description, /spokenSummary/i);
  assert.match(searchTool.description, /spokenDues/i);
  assert.match(searchTool.description, /spokenReferenceCode/i);

  assert.match(
    referenceTool.description,
    /never read transcript structure, field labels, JSON-like formatting, or raw English title text aloud/i
  );
  assert.match(referenceTool.description, /raw English title text/i);
  assert.match(
    referenceTool.description,
    /short natural Turkish sentences/i
  );
  assert.match(referenceTool.description, /spokenSummary/i);
  assert.match(referenceTool.description, /spokenDues/i);

  assert.match(
    showingTool.description,
    /do not expose tool names, argument keys, or schema words to the caller/i
  );
  assert.match(showingTool.description, /short blocks/i);
  assert.match(showingTool.description, /fully Turkish/i);
});

test("POST /v1/retell/tools executes search_listings with resolved office scope", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "search_listings",
    args: {
      district: "Kadikoy",
      limit: 2
    },
    call: {
      call_id: "call_search_1",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().tool, "search_listings");
  assert.equal(
    response.json().data.matchInterpretation,
    "verified_structured_match"
  );
  assert.match(
    response.json().data.listings[0].spokenSummary,
    /Kadikoy|kiralık|satılık|daire/i
  );
  assert.ok(response.json().data.listings[0].spokenDues);
  assert.ok(response.json().data.listings[0].spokenReferenceCode);
  assert.deepEqual(
    response
      .json()
      .data.listings.map((listing: ListingSearchItem) => listing.referenceCode),
    ["REF-001", "REF-002"]
  );
  assert.equal(retellRepository.auditEvents.length, 1);
  assert.equal(retellRepository.auditEvents[0]?.action, "retell.tool.executed");

  await app.close();
});

test("POST /v1/retell/tools normalizes noisy optional search args from Retell providers", async () => {
  let receivedFilters: SearchListingsFilters | null = null;

  const listingsService: ListingsService = {
    async searchListingsDetailed(filters) {
      receivedFilters = filters;

      return {
        listings: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
            referenceCode: "REF-002",
            title: "Kadikoy Budget Rental",
            listingType: "rent",
            propertyType: "apartment",
            price: 45000,
            currency: "TRY",
            bedrooms: 2,
            bathrooms: 1,
            netM2: 95,
            district: "Kadikoy",
            neighborhood: "Moda",
            status: "active"
          }
        ],
        matchInterpretation: "verified_structured_match"
      };
    },
    async searchListings(filters) {
      receivedFilters = filters;

      return [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          referenceCode: "REF-002",
          title: "Kadikoy Budget Rental",
          listingType: "rent",
          propertyType: "apartment",
          price: 45000,
          currency: "TRY",
          bedrooms: 2,
          bathrooms: 1,
          netM2: 95,
          district: "Kadikoy",
          neighborhood: "Moda",
          status: "active"
        }
      ];
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
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "search_listings",
    args: {
      district: "Kadıköy",
      neighborhood: "",
      listingType: "rent",
      propertyType: null,
      queryText: null,
      minPrice: 0,
      maxPrice: 65000,
      minBedrooms: 2,
      minBathrooms: 0,
      minNetM2: "",
      maxNetM2: null,
      limit: 3
    },
    call: {
      call_id: "call_search_1_noisy",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(
    response.json().data.matchInterpretation,
    "verified_structured_match"
  );
  assert.equal(receivedFilters?.officeId, OFFICE_1_ID);
  assert.equal(receivedFilters?.district, "Kadıköy");
  assert.equal(receivedFilters?.listingType, "rent");
  assert.equal(receivedFilters?.maxPrice, 65000);
  assert.equal(receivedFilters?.minBedrooms, 2);
  assert.equal(receivedFilters?.searchMode, "structured");
  assert.equal(receivedFilters?.limit, 3);
  assert.equal(receivedFilters?.neighborhood, undefined);
  assert.equal(receivedFilters?.propertyType, undefined);
  assert.equal(receivedFilters?.queryText, undefined);
  assert.equal(receivedFilters?.minPrice, undefined);
  assert.equal(receivedFilters?.minBathrooms, undefined);
  assert.equal(receivedFilters?.minNetM2, undefined);
  assert.equal(receivedFilters?.maxNetM2, undefined);

  await app.close();
});

test("POST /v1/retell/tools returns no_match when subjective queryText has no verified candidates", async () => {
  const listingsService: ListingsService = {
    async searchListingsDetailed(filters) {
      assert.equal(filters.searchMode, "hybrid");
      assert.equal(filters.queryText, "metroya yakin");

      return {
        listings: [],
        matchInterpretation: "no_match"
      };
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
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "search_listings",
    args: {
      district: "Kadikoy",
      queryText: "metroya yakin",
      limit: 3
    },
    call: {
      call_id: "call_search_no_match",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().data.count, 0);
  assert.equal(response.json().data.matchInterpretation, "no_match");
  assert.deepEqual(response.json().data.listings, []);

  await app.close();
});

test("POST /v1/retell/tools includes spoken fields on verified reference lookup results", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: "REF-001"
    },
    call: {
      call_id: "call_reference_spoken_fields",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.ok(response.json().data.listing.spokenSummary);
  assert.ok(response.json().data.listing.spokenDues);
  assert.ok(response.json().data.listing.spokenReferenceCode);
  assert.ok(Array.isArray(response.json().data.listing.spokenHighlights));

  await app.close();
});

test("POST /v1/retell/tools returns reference-code repair details for blank get_listing_by_reference input", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: "   "
    },
    call: {
      call_id: "call_reference_blank_code",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "get_listing_by_reference");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.repairStep, "referenceCode");
  assert.match(
    response.json().error.message,
    /Ilan kodunu tam haliyle bir kez daha almam gerekiyor/i
  );
  assert.deepEqual(response.json().error.fieldErrors, [
    {
      field: "referenceCode",
      message: "Too small: expected string to have >=1 characters"
    }
  ]);

  await app.close();
});

test("POST /v1/retell/tools returns field-specific search repair details for contradictory price filters", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "search_listings",
    args: {
      district: "Kadikoy",
      minPrice: 900000,
      maxPrice: 100000
    },
    call: {
      call_id: "call_search_contradictory_price_range",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "search_listings");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.repairStep, "minPrice");
  assert.match(
    response.json().error.message,
    /Arama kriterlerindeki fiyat, oda ya da metrekare bilgisini yeniden netlestirmem gerekiyor/i
  );
  assert.deepEqual(response.json().error.fieldErrors, [
    {
      field: "minPrice",
      message: "minPrice cannot be greater than maxPrice."
    }
  ]);

  await app.close();
});

test("POST /v1/retell/tools rejects invalid signatures", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellService = createRetellService({
    repository: createFakeRetellRepository().repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": "v=1,d=bad"
    },
    payload: {
      name: "search_listings",
      args: {},
      call: {
        call_id: "call_search_2",
        metadata: {
          office_id: OFFICE_1_ID
        }
      }
    }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "RETELL_SIGNATURE_INVALID");

  await app.close();
});

test("POST /v1/retell/tools uses RETELL_API_KEY before a stale RETELL_WEBHOOK_SECRET", async () => {
  const originalApiKey = process.env.RETELL_API_KEY;
  const originalWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;

  process.env.RETELL_API_KEY = RETELL_API_KEY;
  process.env.RETELL_WEBHOOK_SECRET = "retell-stale-secret";

  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellService = createRetellService({
    repository: createFakeRetellRepository().repository,
    listingsService,
    showingRequestsService
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: "REF-001"
    },
    call: {
      call_id: "call_reference_api_key_precedence",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/retell/tools",
      headers: {
        "x-retell-signature": await sign(
          JSON.stringify(payload),
          RETELL_API_KEY
        )
      },
      payload
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
    assert.equal(response.json().tool, "get_listing_by_reference");
  } finally {
    process.env.RETELL_API_KEY = originalApiKey;
    process.env.RETELL_WEBHOOK_SECRET = originalWebhookSecret;
    await app.close();
  }
});

test("POST /v1/retell/tools keeps explicit webhookSecret override ahead of RETELL_API_KEY", async () => {
  const originalApiKey = process.env.RETELL_API_KEY;
  const originalWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;

  process.env.RETELL_API_KEY = RETELL_API_KEY;
  process.env.RETELL_WEBHOOK_SECRET = "retell-stale-secret";

  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellService = createRetellService({
    repository: createFakeRetellRepository().repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: "REF-001"
    },
    call: {
      call_id: "call_reference_explicit_secret_precedence",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/retell/tools",
      headers: {
        "x-retell-signature": await sign(
          JSON.stringify(payload),
          RETELL_SECRET
        )
      },
      payload
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
    assert.equal(response.json().tool, "get_listing_by_reference");
  } finally {
    process.env.RETELL_API_KEY = originalApiKey;
    process.env.RETELL_WEBHOOK_SECRET = originalWebhookSecret;
    await app.close();
  }
});

test("POST /v1/retell/tools verifies against the raw request body string", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellService = createRetellService({
    repository: createFakeRetellRepository().repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const rawPayload = `{
  "call": {
    "metadata": {
      "office_id": "${OFFICE_1_ID}"
    },
    "call_id": "call_reference_raw_body"
  },
  "args": {
    "referenceCode": "REF-001"
  },
  "name": "get_listing_by_reference"
}`;

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "content-type": "application/json",
      "x-retell-signature": await sign(rawPayload, RETELL_SECRET)
    },
    payload: rawPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().tool, "get_listing_by_reference");

  await app.close();
});

test("POST /v1/webhooks/retell verifies against the raw request body string", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const rawPayload = `{
  "call": {
    "call_status": "ended",
    "direction": "inbound",
    "to_number": "+905550000001",
    "from_number": "+905551234567",
    "call_analysis": {
      "call_summary": "Customer asked for a showing."
    },
    "end_timestamp": 1769308200000,
    "start_timestamp": 1769306400000,
    "call_id": "call_webhook_raw_body"
  },
  "event": "call_ended"
}`;

  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/retell",
    headers: {
      "content-type": "application/json",
      "x-retell-signature": await sign(rawPayload, RETELL_SECRET)
    },
    payload: rawPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.received, true);
  assert.equal(response.json().data.officeId, OFFICE_1_ID);
  assert.equal(retellRepository.callLogs.size, 1);

  await app.close();
});

test("POST /v1/retell/tools accepts blank optional customerEmail for create_showing_request", async () => {
  const listingsService = createFakeListingsService();
  const { service: showingRequestsService, createdRequests } =
    createFakeShowingRequestsService();
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      customerEmail: "",
      preferredTimeWindow: "afternoon",
      preferredDatetime: "2026-03-28T18:30:00.000Z"
    },
    call: {
      call_id: "call_showing_blank_email",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(createdRequests.length, 1);
  assert.equal(createdRequests[0]?.customerEmail, null);
  assert.equal(createdRequests[0]?.preferredTimeWindow, "afternoon");

  await app.close();
});

test("POST /v1/retell/tools normalizes spoken Turkish mobile numbers before create_showing_request", async () => {
  const listingsService = createFakeListingsService();
  const { service: showingRequestsService, createdRequests } =
    createFakeShowingRequestsService();
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Umut",
      customerPhone: "5056924071",
      preferredDatetime: "2026-03-28T18:30:00.000Z"
    },
    call: {
      call_id: "call_showing_spoken_phone_normalized",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(createdRequests.length, 1);
  assert.equal(createdRequests[0]?.customerPhone, "+905056924071");
  assert.equal(
    response.json().data.showingRequest.customerPhone,
    "+905056924071"
  );

  await app.close();
});

test("POST /v1/retell/tools keeps create_showing_request successful when booking dispatch fails after persistence", async () => {
  const listingsService = createFakeListingsService();
  const bookingDispatchAudits: Array<{
    officeId?: string | null;
    action: string;
    payload?: unknown;
  }> = [];
  const showingRequestsService = createShowingRequestsService(
    {
      async findOfficeListing(officeId, listingId) {
        const listing = LISTING_FIXTURES.find(
          (entry) => entry.officeId === officeId && entry.id === listingId
        );

        return listing ? { id: listing.id } : null;
      },
      async create(input) {
        return {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
          officeId: input.officeId,
          listingId: input.listingId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          preferredTimeWindow: input.preferredTimeWindow ?? null,
          preferredDatetime: input.preferredDatetime,
          status: "pending",
          createdAt: new Date("2026-03-29T10:15:00.000Z")
        };
      }
    },
    {
      integrationsService: createIntegrationsService({
        repository: {
          async findOfficeContextById(officeId) {
            if (officeId === OFFICE_1_ID) {
              return {
                officeId,
                tenantId: TENANT_1_ID,
                officeName: "Office 1",
                officeTimezone: "Europe/Istanbul"
              };
            }

            return null;
          },
          async findActiveConnectionByKind() {
            return [];
          },
          async findConnectionById() {
            return null;
          },
          async findShowingRequestById() {
            return null;
          },
          async updateShowingRequestStatus() {
            throw new Error("updateShowingRequestStatus should not be called");
          },
          async findCallLogById() {
            return null;
          },
          async findAuditEventByActor() {
            return null;
          },
          async createAuditEvent(input) {
            bookingDispatchAudits.push({
              officeId: input.officeId ?? null,
              action: input.action,
              payload: input.payload
            });
          },
          async createAuditEventIfAbsent() {
            return null;
          },
          async claimBookingCallbackRunAndUpdateShowingRequest() {
            throw new Error(
              "claimBookingCallbackRunAndUpdateShowingRequest should not be called"
            );
          }
        }
      })
    }
  );
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      preferredTimeWindow: "afternoon",
      preferredDatetime: "2026-03-28T18:30:00.000Z"
    },
    call: {
      call_id: "call_showing_dispatch_failure_nonfatal",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().data.showingRequest.id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
  assert.deepEqual(bookingDispatchAudits, [
    {
      officeId: OFFICE_1_ID,
      action: "booking_dispatch_failed",
      payload: {
        sourceAction: "showing_request_created",
        showingRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
        errorCode: "BOOKING_WORKFLOW_DISPATCH_UNAVAILABLE",
        error: "Booking workflow dispatch is unavailable."
      }
    }
  ]);

  await app.close();
});

test("POST /v1/retell/tools rejects raw reference codes for create_showing_request listingId", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "IST3401",
      customerName: "Umut",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-03-29T12:00:00.000Z"
    },
    call: {
      call_id: "call_showing_raw_reference",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "create_showing_request");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(
    response.json().error.message,
    "Talebi oluşturmak için bazı bilgileri yeniden teyit etmem gerekiyor."
  );
  assert.doesNotMatch(
    response.json().error.message,
    /Invalid|UUID|reference code/i
  );

  await app.close();
});

test("POST /v1/retell/tools rejects literal {{user_number}} callback placeholders", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Umut",
      customerPhone: "{{user_number}}",
      preferredDatetime: "2026-03-29T12:00:00.000Z"
    },
    call: {
      call_id: "call_showing_placeholder_phone",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "create_showing_request");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.repairStep, "customerPhone");
  assert.match(
    response.json().error.message,
    /Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz/i
  );
  assert.deepEqual(response.json().error.fieldErrors, [
    {
      field: "customerPhone",
      message: "Customer phone must not contain unresolved template placeholders."
    }
  ]);

  await app.close();
});

test("POST /v1/retell/tools rejects incomplete spoken Turkish mobile numbers", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Umut",
      customerPhone: "505692471",
      preferredDatetime: "2026-03-29T12:00:00.000Z"
    },
    call: {
      call_id: "call_showing_incomplete_spoken_phone",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "create_showing_request");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.repairStep, "customerPhone");
  assert.match(
    response.json().error.message,
    /Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz/i
  );
  assert.deepEqual(response.json().error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);
  const failedAuditEvent = retellRepository.auditEvents.find(
    (entry) => entry.action === "retell.tool.failed"
  ) as
    | {
        payload?: {
          args?: {
            phoneParse?: {
              digitCount?: number;
              parseConfidence?: string;
              confirmationState?: string;
              normalized?: boolean;
            };
          };
        };
      }
    | undefined;

  assert.equal(failedAuditEvent?.payload?.args?.phoneParse?.digitCount, 9);
  assert.equal(failedAuditEvent?.payload?.args?.phoneParse?.parseConfidence, "low");
  assert.equal(
    failedAuditEvent?.payload?.args?.phoneParse?.confirmationState,
    "not_provided"
  );
  assert.equal(failedAuditEvent?.payload?.args?.phoneParse?.normalized, false);

  await app.close();
});

test("repair message helpers keep Retell-facing repair mapping canonical", () => {
  assert.equal(
    getRepairStepCallerMessage("referenceCode"),
    "Ilan kodunu tam haliyle bir kez daha almam gerekiyor."
  );
  assert.equal(getRepairStepCallerMessage("unknown"), undefined);
  assert.equal(toCanonicalRepairStep("customerPhone"), "customerPhone");
  assert.equal(toCanonicalRepairStep("district"), undefined);
  assert.deepEqual(
    toCanonicalVoiceFieldErrors([
      {
        field: "customerPhone",
        message:
          "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
      },
      {
        field: "district",
        message: "Should be ignored because it is not a canonical repair field."
      }
    ]),
    [
      {
        field: "customerPhone",
        message:
          "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
      }
    ]
  );
});

test("Retell service does not choose a repair field from fieldErrors when repairStep is unknown", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService: ShowingRequestsService = {
    async createShowingRequest() {
      throw new AppError(
        "Invalid input.",
        400,
        "VALIDATION_ERROR",
        {
          code: "VALIDATION_ERROR",
          repairStep: "unknown",
          fieldErrors: [
            {
              field: "customerPhone",
              message:
                "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
            }
          ]
        }
      );
    }
  };
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Umut",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-03-29T12:00:00.000Z"
    },
    call: {
      call_id: "call_showing_unknown_repair_step",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "create_showing_request");
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.repairStep, "unknown");
  assert.match(
    response.json().error.message,
    /Talebi .* yeniden teyit etmem gerekiyor/i
  );
  assert.doesNotMatch(
    response.json().error.message,
    /Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz/i
  );
  assert.deepEqual(response.json().error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);

  await app.close();
});

test("create_showing_request accepts a single caller name without requiring surname", async () => {
  const listingsService = createFakeListingsService();
  const { service: showingRequestsService, createdRequests } =
    createFakeShowingRequestsService();
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Umut",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-03-29T12:00:00.000Z"
    },
    call: {
      call_id: "call_showing_single_name",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(createdRequests.length, 1);
  assert.equal(createdRequests[0]?.customerName, "Umut");
  const successAuditEvent = retellRepository.auditEvents.find(
    (entry) => entry.action === "retell.tool.executed"
  ) as
    | {
        payload?: {
          args?: {
            phoneParse?: {
              digitCount?: number;
              parseConfidence?: string;
              confirmationState?: string;
              normalized?: boolean;
            };
          };
        };
      }
    | undefined;

  assert.equal(successAuditEvent?.payload?.args?.phoneParse?.digitCount, 12);
  assert.equal(successAuditEvent?.payload?.args?.phoneParse?.parseConfidence, "high");
  assert.equal(
    successAuditEvent?.payload?.args?.phoneParse?.confirmationState,
    "not_provided"
  );
  assert.equal(successAuditEvent?.payload?.args?.phoneParse?.normalized, true);

  await app.close();
});

test("create_showing_request contract does not imply surname is required", () => {
  const tool = retellToolContracts.find(
    (entry) => entry.name === "create_showing_request"
  );
  const listingIdProperty = tool?.parameters.properties.listingId as
    | { description?: string }
    | undefined;
  const customerNameProperty = tool?.parameters.properties.customerName as
    | { description?: string }
    | undefined;
  const customerPhoneProperty = tool?.parameters.properties.customerPhone as
    | { description?: string }
    | undefined;

  assert.ok(listingIdProperty?.description);
  assert.ok(customerNameProperty?.description);
  assert.ok(customerPhoneProperty?.description);
  assert.match(
    tool?.description ?? "",
    /minimum required customer details/i
  );
  assert.match(tool?.description ?? "", /verified backend UUID/i);
  assert.match(tool?.description ?? "", /never a raw spoken reference code/i);
  assert.match(tool?.description ?? "", /never a literal placeholder/i);
  assert.match(
    tool?.description ?? "",
    /do not call this tool immediately|explicit confirmation/i
  );
  assert.match(listingIdProperty.description ?? "", /verified backend listing UUID/i);
  assert.match(listingIdProperty.description ?? "", /never pass a raw reference code/i);
  assert.match(customerNameProperty.description ?? "", /single given name/i);
  assert.doesNotMatch(customerNameProperty.description ?? "", /full name/i);
  assert.match(customerPhoneProperty.description ?? "", /confirmed callback/i);
  assert.match(customerPhoneProperty.description ?? "", /phone_call/i);
  assert.match(customerPhoneProperty.description ?? "", /web_call/i);
  assert.match(customerPhoneProperty.description ?? "", /read it back briefly and confirm it/i);
  assert.match(customerPhoneProperty.description ?? "", /never pass a literal placeholder/i);
});

test("get_listing_by_reference contract preserves full spoken prefixes", () => {
  const tool = retellToolContracts.find(
    (entry) => entry.name === "get_listing_by_reference"
  );
  const referenceCodeProperty = tool?.parameters.properties.referenceCode as
    | { description?: string }
    | undefined;

  assert.ok(tool);
  assert.ok(referenceCodeProperty?.description);
  assert.match(tool?.description ?? "", /including any leading prefix such as DEMO/i);
  assert.match(tool?.description ?? "", /partial codes are not/i);
  assert.match(referenceCodeProperty.description ?? "", /full listing reference code/i);
  assert.match(referenceCodeProperty.description ?? "", /including prefixes like DEMO/i);
});

test("POST /v1/webhooks/retell persists call state with phone-based office resolution", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    event: "call_ended",
    call: {
      call_id: "call_webhook_1",
      call_status: "ended",
      direction: "inbound",
      to_number: "+905550000001",
      from_number: "+905551234567",
      start_timestamp: 1769306400000,
      end_timestamp: 1769308200000,
      call_analysis: {
        call_summary: "Customer asked for a showing."
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/retell",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.received, true);
  assert.equal(response.json().data.officeId, OFFICE_1_ID);
  assert.equal(retellRepository.callLogs.size, 1);
  assert.equal(
    retellRepository.callLogs.get("call_webhook_1")?.summary,
    "Customer asked for a showing."
  );
  assert.equal(retellRepository.auditEvents.length, 1);
  assert.equal(
    retellRepository.auditEvents[0]?.action,
    "retell.webhook.call_ended"
  );

  await app.close();
});

test("POST /v1/retell/tools returns structured domain errors without changing HTTP success", async () => {
  const listingsService = createFakeListingsService();
  const showingRequestsService = createFakeShowingRequestsService().service;
  const retellRepository = createFakeRetellRepository();
  const retellService = createRetellService({
    repository: retellRepository.repository,
    listingsService,
    showingRequestsService,
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService,
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: "REF-404"
    },
    call: {
      call_id: "call_search_3",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().tool, "get_listing_by_reference");
  assert.equal(response.json().error.code, "LISTING_NOT_FOUND");
  assert.equal(response.json().error.message, "\u0130lgili ilan\u0131 bulamad\u0131m.");
  assert.doesNotMatch(
    response.json().error.message,
    /Listing not found|reference code|Invalid/i
  );
  assert.equal(retellRepository.auditEvents.length, 1);
  assert.equal(retellRepository.auditEvents[0]?.action, "retell.tool.failed");

  await app.close();
});
