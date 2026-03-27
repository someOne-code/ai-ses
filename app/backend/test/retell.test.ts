import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import { AppError } from "../src/lib/errors.js";
import type { ListingsService } from "../src/modules/listings/service.js";
import type {
  ListingDetail,
  ListingSearchItem
} from "../src/modules/listings/types.js";
import type {
  CreateAuditEventInput,
  RetellRepository,
  UpsertCallLogInput
} from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";
import { retellToolContracts } from "../src/modules/retell/types.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";
import type { ShowingRequestRecord } from "../src/modules/showing-requests/types.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ai_ses";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

const RETELL_SECRET = "retell-test-secret";
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
  return {
    async searchListings(filters) {
      return LISTING_FIXTURES
        .filter((listing) => listing.officeId === filters.officeId)
        .filter((listing) =>
          filters.district ? listing.district === filters.district : true
        )
        .slice(0, filters.limit)
        .map(({ officeId: _officeId, ...listing }) => listing);
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
  assert.equal(retellRepository.auditEvents.length, 1);
  assert.equal(retellRepository.auditEvents[0]?.action, "retell.tool.failed");

  await app.close();
});
