import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import { AppError } from "../src/lib/errors.js";
import {
  createListingsService,
  type ListingsService
} from "../src/modules/listings/service.js";
import type {
  ListingDetail,
  MainListingSearchDocumentRefreshResult,
  ListingSearchItem
} from "../src/modules/listings/types.js";
import { parseSearchListingsQuery } from "../src/modules/listings/types.js";
import type { RetellRepository } from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";
import { retellToolContracts } from "../src/modules/retell/types.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";
import type { ShowingRequestRecord } from "../src/modules/showing-requests/types.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5433/ai_ses";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

const TENANT_1_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_2_ID = "44444444-4444-4444-8444-444444444444";
const OFFICE_1_ID = "11111111-1111-4111-8111-111111111111";
const OFFICE_2_ID = "22222222-2222-4222-8222-222222222222";
const SEARCH_DOCUMENT_REFRESH_SECRET = "listing-refresh-test-secret";

interface ListingFixture extends ListingDetail {
  officeId: string;
  createdAt: string;
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
    hasElevator: true,
    createdAt: "2026-03-20T10:00:00.000Z"
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
    hasElevator: true,
    createdAt: "2026-03-19T09:00:00.000Z"
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    officeId: OFFICE_1_ID,
    referenceCode: "REF-003",
    title: "Inactive Listing",
    listingType: "sale",
    propertyType: "apartment",
    price: 8200000,
    currency: "TRY",
    bedrooms: 4,
    bathrooms: 2,
    netM2: 160,
    district: "Besiktas",
    neighborhood: "Levent",
    status: "inactive",
    description: "Should never appear in search.",
    grossM2: 170,
    floorNumber: 8,
    buildingAge: 9,
    dues: 2000,
    addressText: "Levent, Besiktas, Istanbul",
    hasBalcony: true,
    hasParking: true,
    hasElevator: true,
    createdAt: "2026-03-18T08:00:00.000Z"
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    officeId: OFFICE_2_ID,
    referenceCode: "REF-001",
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
    hasElevator: false,
    createdAt: "2026-03-21T11:00:00.000Z"
  }
];

function createFakeListingsService(): ListingsService {
  return {
    async searchListings(filters) {
      return LISTING_FIXTURES
        .filter((listing) => listing.officeId === filters.officeId)
        .filter((listing) => listing.status === "active")
        .filter((listing) =>
          filters.district ? listing.district === filters.district : true
        )
        .filter((listing) =>
          filters.neighborhood
            ? listing.neighborhood === filters.neighborhood
            : true
        )
        .filter((listing) =>
          filters.listingType ? listing.listingType === filters.listingType : true
        )
        .filter((listing) =>
          filters.propertyType
            ? listing.propertyType === filters.propertyType
            : true
        )
        .filter((listing) =>
          filters.minPrice !== undefined
            ? (listing.price ?? 0) >= filters.minPrice
            : true
        )
        .filter((listing) =>
          filters.maxPrice !== undefined
            ? (listing.price ?? 0) <= filters.maxPrice
            : true
        )
        .filter((listing) =>
          filters.minBedrooms !== undefined
            ? (listing.bedrooms ?? 0) >= filters.minBedrooms
            : true
        )
        .filter((listing) =>
          filters.minBathrooms !== undefined
            ? (listing.bathrooms ?? 0) >= filters.minBathrooms
            : true
        )
        .filter((listing) =>
          filters.minNetM2 !== undefined
            ? (listing.netM2 ?? 0) >= filters.minNetM2
            : true
        )
        .filter((listing) =>
          filters.maxNetM2 !== undefined
            ? (listing.netM2 ?? 0) <= filters.maxNetM2
            : true
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, filters.limit)
        .map(({ createdAt: _createdAt, officeId: _officeId, ...listing }) => listing);
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

      const { createdAt: _createdAt, officeId: _officeId, ...detail } = listing;

      return detail;
    },

    async refreshMainSearchDocument(params): Promise<MainListingSearchDocumentRefreshResult> {
      const listing = LISTING_FIXTURES.find(
        (entry) =>
          entry.officeId === params.officeId &&
          entry.id === params.listingId &&
          entry.status === "active"
      );

      if (!listing) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      return {
        id: "search-document-1",
        officeId: params.officeId,
        listingId: params.listingId,
        documentType: "main",
        hasEmbedding: true,
        embeddingModel: "gemini-embedding-001",
        embeddingUpdatedAt: "2026-03-24T10:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z"
      };
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
  const auditEvents: Array<{
    tenantId?: string | null;
    officeId?: string | null;
    actorType: string;
    actorId?: string | null;
    action: string;
    payload?: unknown;
  }> = [];
  const callLogs = new Map<
    string,
    {
      id: string;
      officeId: string;
      providerCallId: string;
      direction: string;
      status: string;
      summary?: string | null;
      payload?: unknown;
      startedAt?: Date;
      endedAt?: Date;
    }
  >();
  const officeContexts = new Map([
    [OFFICE_1_ID, { officeId: OFFICE_1_ID, tenantId: TENANT_1_ID }],
    [OFFICE_2_ID, { officeId: OFFICE_2_ID, tenantId: TENANT_2_ID }]
  ]);
  const phoneMappings = new Map([
    ["+905551110000", officeContexts.get(OFFICE_1_ID)!],
    ["+905552220000", officeContexts.get(OFFICE_2_ID)!]
  ]);

  const repository: RetellRepository = {
    async findOfficeContextById(officeId) {
      return officeContexts.get(officeId) ?? null;
    },

    async findOfficeContextByPhoneNumbers(phoneNumbers) {
      for (const phoneNumber of phoneNumbers) {
        const officeContext = phoneMappings.get(phoneNumber);

        if (officeContext) {
          return officeContext;
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

  return {
    repository,
    auditEvents,
    callLogs
  };
}

function createFakeRetellService() {
  const retellRepository = createFakeRetellRepository();

  return {
    service: createRetellService({
      repository: retellRepository.repository,
      listingsService: createFakeListingsService(),
      showingRequestsService: createFakeShowingRequestsService().service,
      webhookSecret: process.env.RETELL_WEBHOOK_SECRET
    }),
    auditEvents: retellRepository.auditEvents,
    callLogs: retellRepository.callLogs
  };
}

async function createRetellSignature(payload: unknown) {
  return sign(
    JSON.stringify(payload),
    process.env.RETELL_WEBHOOK_SECRET ?? "retell-test-secret"
  );
}

test("GET /health returns 200", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "ok");

  await app.close();
});

test("GET /ready returns 200 when readiness check succeeds", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "GET",
    url: "/ready"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "ready");

  await app.close();
});

test("listing search is office-scoped and excludes inactive listings", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search`
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().data.map((listing: ListingDetail) => listing.referenceCode),
    ["REF-001", "REF-002"]
  );

  await app.close();
});

test("listing search applies structured filters", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search?district=Kadikoy&listingType=sale&minPrice=6000000&minBedrooms=3`
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().data.map((listing: ListingSearchItem) => listing.referenceCode),
    ["REF-001"]
  );

  await app.close();
});

test("listing search uses default limit and clamps to 20", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: {
      async searchListings(filters) {
        return Array.from({ length: filters.limit }, (_, index) => ({
          id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`,
          referenceCode: `REF-${index}`,
          title: `Listing ${index}`,
          listingType: "sale",
          propertyType: "apartment",
          price: 1000000 + index,
          currency: "TRY",
          bedrooms: 2,
          bathrooms: 1,
          netM2: 90,
          district: "Kadikoy",
          neighborhood: "Moda",
          status: "active"
        }));
      },
      async getListingByReference() {
        throw new AppError("Listing not found.", 404);
      }
    },
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const defaultResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search`
  });
  const clampedResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search?limit=50`
  });

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(defaultResponse.json().data.length, 5);
  assert.equal(clampedResponse.statusCode, 200);
  assert.equal(clampedResponse.json().data.length, 20);

  await app.close();
});

test("listing by reference is office-scoped", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const foundResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/by-reference/REF-001`
  });
  const hiddenResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/by-reference/REF-404`
  });

  assert.equal(foundResponse.statusCode, 200);
  assert.equal(foundResponse.json().data.referenceCode, "REF-001");
  assert.equal(hiddenResponse.statusCode, 404);
  assert.equal(hiddenResponse.json().error.code, "LISTING_NOT_FOUND");

  await app.close();
});

test("listing by reference does not return inactive listings", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: {
      async searchListings(filters) {
        return createFakeListingsService().searchListings(filters);
      },
      async getListingByReference(params) {
        const listing = LISTING_FIXTURES.find(
          (entry) =>
            entry.officeId === params.officeId &&
            entry.referenceCode === params.referenceCode &&
            entry.status === "active"
        );

        if (!listing) {
          throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
        }

        const { createdAt: _createdAt, officeId: _officeId, ...detail } = listing;

        return detail;
      }
    },
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/by-reference/REF-003`
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "LISTING_NOT_FOUND");

  await app.close();
});

test("listing main search document refresh route is office-scoped", async () => {
  let capturedParams:
    | { officeId: string; listingId: string }
    | undefined;
  const listingsService: ListingsService = {
    ...createFakeListingsService(),
    async refreshMainSearchDocument(params) {
      capturedParams = params;

      return {
        id: "search-document-1",
        officeId: params.officeId,
        listingId: params.listingId,
        documentType: "main",
        hasEmbedding: true,
        embeddingModel: "gemini-embedding-001",
        embeddingUpdatedAt: "2026-03-24T10:00:00.000Z",
        updatedAt: "2026-03-24T10:00:00.000Z"
      };
    }
  };
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingSearchDocumentRefreshSecret: SEARCH_DOCUMENT_REFRESH_SECRET,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/listings/${LISTING_FIXTURES[0]!.id}/search-documents/main/refresh`,
    headers: {
      "x-search-document-refresh-secret": SEARCH_DOCUMENT_REFRESH_SECRET
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(capturedParams, {
    officeId: OFFICE_1_ID,
    listingId: LISTING_FIXTURES[0]!.id
  });
  assert.equal(response.json().data.documentType, "main");
  assert.equal(response.json().data.hasEmbedding, true);

  await app.close();
});

test("listing main search document refresh route rejects requests without the internal secret", async () => {
  let invoked = false;
  const listingsService: ListingsService = {
    ...createFakeListingsService(),
    async refreshMainSearchDocument() {
      invoked = true;

      throw new Error("refreshMainSearchDocument should not run without the route secret");
    }
  };
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingSearchDocumentRefreshSecret: SEARCH_DOCUMENT_REFRESH_SECRET,
    listingsService,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/listings/${LISTING_FIXTURES[0]!.id}/search-documents/main/refresh`
  });

  assert.equal(response.statusCode, 401);
  assert.equal(
    response.json().error.code,
    "SEARCH_DOCUMENT_REFRESH_FORBIDDEN"
  );
  assert.equal(invoked, false);

  await app.close();
});

test("showing request creation returns 201 for valid office and listing", async () => {
  const showingRequests = createFakeShowingRequestsService();
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: showingRequests.service
  });

  const response = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/showing-requests`,
    payload: {
      listingId: LISTING_FIXTURES[0].id,
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      customerEmail: "ada@example.com",
      preferredDatetime: "2026-03-25T12:00:00.000Z"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.status, "pending");
  assert.equal(showingRequests.createdRequests.length, 1);

  await app.close();
});

test("showing request creation rejects missing or cross-office listings", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const missingListingResponse = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/showing-requests`,
    payload: {
      listingId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-03-25T12:00:00.000Z"
    }
  });
  const crossOfficeResponse = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/showing-requests`,
    payload: {
      listingId: LISTING_FIXTURES[3].id,
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-03-25T12:00:00.000Z"
    }
  });

  assert.equal(missingListingResponse.statusCode, 404);
  assert.equal(missingListingResponse.json().error.code, "LISTING_NOT_FOUND");
  assert.equal(crossOfficeResponse.statusCode, 404);
  assert.equal(crossOfficeResponse.json().error.code, "LISTING_NOT_FOUND");

  await app.close();
});

test("listing search rejects invalid filter combinations and unknown keys", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const contradictoryResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search?minPrice=900000&maxPrice=100000`
  });
  const unknownKeyResponse = await app.inject({
    method: "GET",
    url: `/v1/offices/${OFFICE_1_ID}/listings/search?foo=bar`
  });

  assert.equal(contradictoryResponse.statusCode, 400);
  assert.equal(contradictoryResponse.json().error.code, "VALIDATION_ERROR");
  assert.equal(unknownKeyResponse.statusCode, 400);
  assert.equal(unknownKeyResponse.json().error.code, "VALIDATION_ERROR");

  await app.close();
});

test("showing request creation validates body payload", async () => {
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "POST",
    url: `/v1/offices/${OFFICE_1_ID}/showing-requests`,
    payload: {
      listingId: LISTING_FIXTURES[0].id,
      customerName: "",
      customerPhone: "+905551112233",
      preferredDatetime: "invalid"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});

test("Retell tool contracts expose the current Phase 1 capability set", () => {
  assert.deepEqual(
    retellToolContracts.map((tool) => tool.name),
    [
      "search_listings",
      "get_listing_by_reference",
      "create_showing_request"
    ]
  );

  const searchListingsContract = retellToolContracts.find(
    (tool) => tool.name === "search_listings"
  );

  assert.equal(
    typeof searchListingsContract?.parameters.properties.queryText,
    "object"
  );
});

test("listing search query defaults to structured or hybrid based on queryText", () => {
  const structuredQuery = parseSearchListingsQuery({
    district: "Kadikoy"
  });
  const hybridQuery = parseSearchListingsQuery({
    queryText: "metroya yakin aile icin uygun"
  });

  assert.equal(structuredQuery.searchMode, "structured");
  assert.equal(hybridQuery.searchMode, "hybrid");
  assert.equal(hybridQuery.queryText, "metroya yakin aile icin uygun");
});

test("listing search query rejects hybrid mode without queryText", () => {
  assert.throws(
    () =>
      parseSearchListingsQuery({
        searchMode: "hybrid"
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR"
  );
});

test("hybrid search logs query embedding failures before continuing without vector retrieval", async () => {
  const warningLogs: Array<{
    bindings: Record<string, unknown>;
    message: string;
  }> = [];
  let capturedSearchOptions:
    | {
        queryEmbedding?: number[];
      }
    | undefined;
  const service = createListingsService(
    {
      async search(_filters, options) {
        capturedSearchOptions = options;

        return [
          {
            id: LISTING_FIXTURES[0]!.id,
            referenceCode: LISTING_FIXTURES[0]!.referenceCode,
            title: LISTING_FIXTURES[0]!.title,
            listingType: LISTING_FIXTURES[0]!.listingType,
            propertyType: LISTING_FIXTURES[0]!.propertyType,
            price: String(LISTING_FIXTURES[0]!.price),
            currency: LISTING_FIXTURES[0]!.currency,
            bedrooms: String(LISTING_FIXTURES[0]!.bedrooms),
            bathrooms: String(LISTING_FIXTURES[0]!.bathrooms),
            netM2: String(LISTING_FIXTURES[0]!.netM2),
            district: LISTING_FIXTURES[0]!.district,
            neighborhood: LISTING_FIXTURES[0]!.neighborhood,
            status: LISTING_FIXTURES[0]!.status
          }
        ];
      },
      async findByReference() {
        throw new Error("findByReference should not be called in this test");
      },
      async findActiveById() {
        throw new Error("findActiveById should not be called in this test");
      }
    },
    {
      logger: {
        warn(bindings, message) {
          warningLogs.push({ bindings, message });
        }
      },
      queryEmbeddingGenerator: {
        async generateQueryEmbedding() {
          throw new AppError(
            "Gemini query embedding failed.",
            502,
            "EMBEDDING_GENERATION_FAILED"
          );
        }
      }
    }
  );

  const results = await service.searchListings({
    officeId: OFFICE_1_ID,
    queryText: "metroya yakin aile icin uygun",
    searchMode: "hybrid",
    limit: 5
  });

  assert.equal(results.length, 1);
  assert.equal(capturedSearchOptions, undefined);
  assert.equal(warningLogs.length, 1);
  assert.equal(
    warningLogs[0]!.message,
    "Hybrid search query embedding failed; continuing without vector retrieval."
  );
  assert.equal(
    warningLogs[0]!.bindings.event,
    "hybrid_search_query_embedding_failed"
  );
  assert.equal(warningLogs[0]!.bindings.officeId, OFFICE_1_ID);
  assert.equal(
    warningLogs[0]!.bindings.fallback,
    "continue_without_vector_retrieval"
  );
  assert.equal(
    warningLogs[0]!.bindings.errorCode,
    "EMBEDDING_GENERATION_FAILED"
  );
});

test("POST /v1/retell/tools executes an office-scoped search with a valid signature", async () => {
  const retell = createFakeRetellService();
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    retellService: retell.service,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const payload = {
    name: "search_listings",
    args: {
      district: "Kadikoy",
      listingType: "sale"
    },
    call: {
      call_id: "retell-call-search",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await createRetellSignature(payload)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().tool, "search_listings");
  assert.deepEqual(
    response.json().data.listings.map(
      (listing: ListingSearchItem) => listing.referenceCode
    ),
    ["REF-001"]
  );
  assert.equal(retell.auditEvents.length, 1);

  await app.close();
});

test("POST /v1/retell/tools rejects invalid signatures", async () => {
  const retell = createFakeRetellService();
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    retellService: retell.service,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": "v=1,d=invalid"
    },
    payload: {
      name: "search_listings",
      args: {},
      call: {
        call_id: "retell-call-invalid",
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

test("POST /v1/webhooks/retell verifies the signature and persists a call log via phone mapping", async () => {
  const retell = createFakeRetellService();
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    retellService: retell.service,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const payload = {
    event: "call_ended",
    call: {
      call_id: "retell-call-ended",
      call_status: "ended",
      direction: "inbound",
      from_number: "+905551112233",
      to_number: "+905551110000",
      call_analysis: {
        call_summary: "Customer asked about REF-001."
      },
      start_timestamp: Date.parse("2026-03-24T10:00:00.000Z"),
      end_timestamp: Date.parse("2026-03-24T10:04:00.000Z")
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/webhooks/retell",
    headers: {
      "x-retell-signature": await createRetellSignature(payload)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.received, true);
  assert.equal(response.json().data.officeId, OFFICE_1_ID);
  assert.equal(retell.callLogs.size, 1);
  assert.equal(retell.auditEvents.length, 1);

  const callLog = retell.callLogs.get("retell-call-ended");
  assert.equal(callLog?.status, "ended");
  assert.equal(callLog?.summary, "Customer asked about REF-001.");

  const updatePayload = {
    ...payload,
    call: {
      ...payload.call,
      call_status: "analyzed",
      call_analysis: {
        call_summary: "Customer requested a showing."
      }
    }
  };

  const updateResponse = await app.inject({
    method: "POST",
    url: "/v1/webhooks/retell",
    headers: {
      "x-retell-signature": await createRetellSignature(updatePayload)
    },
    payload: updatePayload
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(retell.callLogs.size, 1);
  assert.equal(retell.auditEvents.length, 2);
  assert.equal(retell.callLogs.get("retell-call-ended")?.status, "analyzed");
  assert.equal(
    retell.callLogs.get("retell-call-ended")?.summary,
    "Customer requested a showing."
  );

  await app.close();
});

test("POST /v1/retell/tools returns a structured business error for unsupported tools", async () => {
  const retell = createFakeRetellService();
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService: createFakeListingsService(),
    retellService: retell.service,
    showingRequestsService: createFakeShowingRequestsService().service
  });

  const payload = {
    name: "create_listing_inquiry",
    args: {},
    call: {
      call_id: "retell-call-unsupported",
      metadata: {
        office_id: OFFICE_1_ID
      }
    }
  };

  const response = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    headers: {
      "x-retell-signature": await createRetellSignature(payload)
    },
    payload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, "RETELL_TOOL_NOT_SUPPORTED");

  await app.close();
});
