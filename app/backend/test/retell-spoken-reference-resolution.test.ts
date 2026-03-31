import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { inArray } from "drizzle-orm";
import { sign } from "retell-sdk";

import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { listings, offices, tenants } from "../src/db/schema/index.js";
import { AppError } from "../src/lib/errors.js";
import { createListingsRepository } from "../src/modules/listings/repository.js";
import { createListingsService } from "../src/modules/listings/service.js";
import { listingHelpStatePrompt } from "../src/modules/retell/prompt-source/states/listing-help.js";
import type { RetellRepository } from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";

const RETELL_SECRET = "retell-spoken-reference-test-secret";
const listingsService = createListingsService(createListingsRepository(db));

function createNoopShowingRequestsService() {
  return {
    async createShowingRequest() {
      throw new Error("createShowingRequest should not be called in this test");
    }
  };
}

function createFakeRetellRepository(input: {
  officeId: string;
  tenantId: string;
}) {
  const auditEvents: Array<{ action: string; payload?: unknown }> = [];

  const repository: RetellRepository = {
    async findOfficeContextById(officeId) {
      if (officeId !== input.officeId) {
        return null;
      }

      return {
        officeId: input.officeId,
        tenantId: input.tenantId
      };
    },

    async findOfficeContextByPhoneNumbers() {
      return null;
    },

    async findCallLogByProviderCallId() {
      return null;
    },

    async createCallLog() {},

    async updateCallLog() {},

    async createAuditEvent(event) {
      auditEvents.push({
        action: event.action,
        payload: event.payload
      });
    }
  };

  return { repository, auditEvents };
}

async function cleanupFixture(input: {
  tenantIds: string[];
  officeIds: string[];
  listingIds: string[];
}) {
  if (input.listingIds.length > 0) {
    await db.delete(listings).where(inArray(listings.id, input.listingIds));
  }

  if (input.officeIds.length > 0) {
    await db.delete(offices).where(inArray(offices.id, input.officeIds));
  }

  if (input.tenantIds.length > 0) {
    await db.delete(tenants).where(inArray(tenants.id, input.tenantIds));
  }
}

async function seedUniqueResolutionFixture() {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const officeId = randomUUID();
  const otherOfficeId = randomUUID();
  const listingId = randomUUID();
  const otherOfficeListingId = randomUUID();

  await db.insert(tenants).values([
    { id: tenantId, name: `Spoken Reference Tenant ${tenantId}` },
    { id: otherTenantId, name: `Spoken Reference Other Tenant ${otherTenantId}` }
  ]);
  await db.insert(offices).values([
    {
      id: officeId,
      tenantId,
      name: `Spoken Reference Office ${officeId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    },
    {
      id: otherOfficeId,
      tenantId: otherTenantId,
      name: `Spoken Reference Other Office ${otherOfficeId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    }
  ]);
  await db.insert(listings).values([
    {
      id: listingId,
      officeId,
      referenceCode: "DEMO-IST-3401",
      title: "Spoken Reference Primary Listing",
      description: "Fixture for spoken reference-code resolution.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "65000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "95.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: otherOfficeListingId,
      officeId: otherOfficeId,
      referenceCode: "OTHER-IST-3401",
      title: "Spoken Reference Other Office Listing",
      description: "Same numeric suffix in another office must not collide.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "64000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "92.00",
      district: "Kadikoy",
      neighborhood: "Feneryolu"
    }
  ]);

  return {
    tenantId,
    officeId,
    listingId,
    otherTenantId,
    otherOfficeId,
    otherOfficeListingId
  };
}

async function seedAmbiguousSuffixFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const primaryListingId = randomUUID();
  const conflictingListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Spoken Reference Ambiguous Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Spoken Reference Ambiguous Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: primaryListingId,
      officeId,
      referenceCode: "DEMO-IST-3401",
      title: "Ambiguous Primary Listing",
      description: "Primary listing for suffix ambiguity.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "65000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "95.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: conflictingListingId,
      officeId,
      referenceCode: "ALT-3401",
      title: "Ambiguous Conflicting Listing",
      description: "Same-office suffix collision must block auto-resolution.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "68000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "98.00",
      district: "Kadikoy",
      neighborhood: "Caddebostan"
    }
  ]);

  return {
    tenantId,
    officeId,
    primaryListingId,
    conflictingListingId
  };
}

async function executeGetListingByReferenceTool(input: {
  officeId: string;
  tenantId: string;
  referenceCode: string;
}) {
  const retell = createFakeRetellRepository({
    officeId: input.officeId,
    tenantId: input.tenantId
  });
  const retellService = createRetellService({
    repository: retell.repository,
    listingsService,
    showingRequestsService: createNoopShowingRequestsService(),
    webhookSecret: RETELL_SECRET
  });
  const app = await createApp({
    registerDatabasePlugin: false,
    readyCheck: async () => undefined,
    listingsService,
    showingRequestsService: createNoopShowingRequestsService(),
    retellService
  });
  const payload = {
    name: "get_listing_by_reference",
    args: {
      referenceCode: input.referenceCode
    },
    call: {
      call_id: `call_${randomUUID()}`,
      metadata: {
        office_id: input.officeId
      }
    }
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/retell/tools",
      headers: {
        "x-retell-signature": await sign(JSON.stringify(payload), RETELL_SECRET)
      },
      payload
    });

    return {
      response,
      auditEvents: retell.auditEvents
    };
  } finally {
    await app.close();
  }
}

test("Retell get_listing_by_reference resolves the exact live suffix-only tool arg shape 30 34 01 when unique in the office", async () => {
  const fixture = await seedUniqueResolutionFixture();

  try {
    const { response, auditEvents } = await executeGetListingByReferenceTool({
      officeId: fixture.officeId,
      tenantId: fixture.tenantId,
      referenceCode: "30 34 01"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
    assert.equal(response.json().tool, "get_listing_by_reference");
    assert.equal(response.json().data.listing.id, fixture.listingId);
    assert.equal(response.json().data.listing.referenceCode, "DEMO-IST-3401");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]?.action, "retell.tool.executed");
  } finally {
    await cleanupFixture({
      tenantIds: [fixture.tenantId, fixture.otherTenantId],
      officeIds: [fixture.officeId, fixture.otherOfficeId],
      listingIds: [fixture.listingId, fixture.otherOfficeListingId]
    });
  }
});

test("Retell get_listing_by_reference resolves the exact live prefixed tool arg shape DEMO IST 30 34 01 when unique in the office", async () => {
  const fixture = await seedUniqueResolutionFixture();

  try {
    const { response, auditEvents } = await executeGetListingByReferenceTool({
      officeId: fixture.officeId,
      tenantId: fixture.tenantId,
      referenceCode: "DEMO IST 30 34 01"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
    assert.equal(response.json().tool, "get_listing_by_reference");
    assert.equal(response.json().data.listing.id, fixture.listingId);
    assert.equal(response.json().data.listing.referenceCode, "DEMO-IST-3401");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]?.action, "retell.tool.executed");
  } finally {
    await cleanupFixture({
      tenantIds: [fixture.tenantId, fixture.otherTenantId],
      officeIds: [fixture.officeId, fixture.otherOfficeId],
      listingIds: [fixture.listingId, fixture.otherOfficeListingId]
    });
  }
});

test("spoken reference-code acceptance resolves five canonical variants to the same office-scoped listing when that office is unique", async () => {
  const fixture = await seedUniqueResolutionFixture();
  const variants = [
    "30 34 01",
    "otuz dört sıfır bir",
    "üç bin dört yüz bir",
    "DEMO IST 30 34 01",
    "DEMO IST üç bin dört yüz bir"
  ] as const;

  try {
    for (const referenceCode of variants) {
      const listing = await listingsService.getListingByReference({
        officeId: fixture.officeId,
        referenceCode
      });

      assert.equal(listing.id, fixture.listingId, referenceCode);
      assert.equal(listing.referenceCode, "DEMO-IST-3401", referenceCode);
      assert.equal(listing.district, "Kadikoy", referenceCode);
    }
  } finally {
    await cleanupFixture({
      tenantIds: [fixture.tenantId, fixture.otherTenantId],
      officeIds: [fixture.officeId, fixture.otherOfficeId],
      listingIds: [fixture.listingId, fixture.otherOfficeListingId]
    });
  }
});

test("spoken reference-code ambiguity rejects same-office suffix collisions instead of auto-resolving", async () => {
  const fixture = await seedAmbiguousSuffixFixture();

  try {
    await assert.rejects(
      () =>
        listingsService.getListingByReference({
          officeId: fixture.officeId,
          referenceCode: "30 34 01"
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "LISTING_REFERENCE_AMBIGUOUS" &&
        error.statusCode === 409
    );
  } finally {
    await cleanupFixture({
      tenantIds: [fixture.tenantId],
      officeIds: [fixture.officeId],
      listingIds: [fixture.primaryListingId, fixture.conflictingListingId]
    });
  }
});

test("listing_help prompt keeps the spoken reference-code token preservation invariant", () => {
  assert.match(
    listingHelpStatePrompt,
    /Preserve every spoken token, including prefixes like DEMO or IST\./i
  );
});
