import path from "node:path";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";

import { db, pool } from "../src/db/client.js";
import {
  auditEvents,
  callLogs,
  integrationConnections,
  listings,
  listingSearchDocuments,
  offices,
  phoneNumberMappings,
  promptVersions,
  showingRequests,
  tenants
} from "../src/db/schema/index.js";
import {
  createListingSearchDocumentsRepository,
  createListingSearchDocumentsService
} from "../src/modules/listings/search-documents.js";

export const LOCAL_DEMO_IDS = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  officeId: "22222222-2222-4222-8222-222222222222",
  listingIds: [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555"
  ],
  phoneMappingId: "66666666-6666-4666-8666-666666666666",
  promptVersionId: "77777777-7777-4777-8777-777777777777",
  bookingConnectionId: "88888888-8888-4888-8888-888888888888",
  crmConnectionId: "99999999-9999-4999-8999-999999999999",
  showingRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  callLogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
} as const;

export const LOCAL_DEMO_CONNECTION_CONFIGS = {
  booking: {
    workflowName: "ai-ses - Booking Flow",
    availabilityUrl: "http://127.0.0.1:4010/availability",
    bookingUrl: "http://127.0.0.1:4010/booking",
    durationMinutes: 30,
    confirmationDelaySeconds: 0
  },
  crm: {
    workflowName: "ai-ses - CRM Sync",
    triggerPath: "/webhook/ai-ses-crm-sync",
    deliveryUrl: "http://127.0.0.1:4012/crm-delivery"
  }
} as const;

const DEMO_LISTINGS = [
  {
    id: LOCAL_DEMO_IDS.listingIds[0],
    referenceCode: "DEMO-IST-3401",
    title: "Kadikoy Moda 2+1 Renovated Apartment Near the Coast",
    description:
      "Bright 2+1 apartment in Moda with renovated kitchen, balcony, and short walking distance to the seaside and Bagdat Avenue transit links.",
    propertyType: "apartment",
    listingType: "rent",
    price: "65000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "95.00",
    grossM2: "110.00",
    floorNumber: "3",
    buildingAge: "12",
    dues: "2500.00",
    district: "Kadikoy",
    neighborhood: "Moda",
    addressText: "Caferaga Mahallesi, Moda Caddesi, Kadikoy / Istanbul",
    hasBalcony: true,
    hasParking: false,
    hasElevator: true
  },
  {
    id: LOCAL_DEMO_IDS.listingIds[1],
    referenceCode: "DEMO-IST-3402",
    title: "Acibadem 3+1 Family Flat with Parking and Elevator",
    description:
      "Well-kept family flat in Acibadem with enclosed kitchen, building parking, elevator, and easy metrobus access for weekday commuting.",
    propertyType: "apartment",
    listingType: "sale",
    price: "12500000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "145.00",
    grossM2: "165.00",
    floorNumber: "5",
    buildingAge: "8",
    dues: "4200.00",
    district: "Uskudar",
    neighborhood: "Acibadem",
    addressText: "Acibadem Mahallesi, Tekin Sokak, Uskudar / Istanbul",
    hasBalcony: true,
    hasParking: true,
    hasElevator: true
  },
  {
    id: LOCAL_DEMO_IDS.listingIds[2],
    referenceCode: "DEMO-IST-3403",
    title: "Fenerbahce Garden Duplex with Parking",
    description:
      "Garden duplex close to Fenerbahce Park with private entrance, parking space, and flexible layout suited for premium family living.",
    propertyType: "duplex",
    listingType: "sale",
    price: "24500000.00",
    currency: "TRY",
    bedrooms: "4",
    bathrooms: "3",
    netM2: "210.00",
    grossM2: "245.00",
    floorNumber: "1",
    buildingAge: "4",
    dues: "6800.00",
    district: "Kadikoy",
    neighborhood: "Fenerbahce",
    addressText: "Fenerbahce Mahallesi, Cemil Topuzlu Caddesi, Kadikoy / Istanbul",
    hasBalcony: true,
    hasParking: true,
    hasElevator: false
  }
] as const;

const DEMO_PROMPT_CONTENT = [
  "You are the inbound voice receptionist for Bosphorus Homes.",
  "Stay concise, answer only from backend-provided listing data, and never invent unavailable details.",
  "Offer showing requests when the caller is interested, and prefer human handoff for negotiation or contract questions.",
  "If the caller asks subjective or fuzzy portfolio questions, use the backend search tools rather than guessing."
].join("\n");

const LOCAL_DEMO_LOCK_KEY = 328041;

function shouldCleanup() {
  return process.argv.includes("--cleanup");
}

export async function withLocalDemoDataLock<T>(run: () => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [LOCAL_DEMO_LOCK_KEY]);
    return await run();
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [LOCAL_DEMO_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}

export async function cleanupLocalDemoDataWithoutLock() {
  await db.transaction(async (tx) => {
    await tx
      .delete(auditEvents)
      .where(eq(auditEvents.officeId, LOCAL_DEMO_IDS.officeId));
    await tx
      .delete(listingSearchDocuments)
      .where(eq(listingSearchDocuments.officeId, LOCAL_DEMO_IDS.officeId));
    await tx
      .delete(integrationConnections)
      .where(eq(integrationConnections.officeId, LOCAL_DEMO_IDS.officeId));
    await tx
      .delete(promptVersions)
      .where(eq(promptVersions.officeId, LOCAL_DEMO_IDS.officeId));
    await tx
      .delete(phoneNumberMappings)
      .where(eq(phoneNumberMappings.officeId, LOCAL_DEMO_IDS.officeId));
    await tx
      .delete(showingRequests)
      .where(eq(showingRequests.id, LOCAL_DEMO_IDS.showingRequestId));
    await tx.delete(callLogs).where(eq(callLogs.id, LOCAL_DEMO_IDS.callLogId));

    for (const listingId of LOCAL_DEMO_IDS.listingIds) {
      await tx.delete(listings).where(eq(listings.id, listingId));
    }

    await tx.delete(offices).where(eq(offices.id, LOCAL_DEMO_IDS.officeId));
    await tx.delete(tenants).where(eq(tenants.id, LOCAL_DEMO_IDS.tenantId));
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "cleanup",
        tenantId: LOCAL_DEMO_IDS.tenantId,
        officeId: LOCAL_DEMO_IDS.officeId
      },
      null,
      2
    )
  );
}

export async function cleanupLocalDemoData() {
  await withLocalDemoDataLock(async () => {
    await cleanupLocalDemoDataWithoutLock();
  });
}

export async function seedLocalDemoDataWithoutLock() {
  await db.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({
        id: LOCAL_DEMO_IDS.tenantId,
        name: "Bosphorus Homes Demo Tenant",
        status: "active"
      })
      .onConflictDoUpdate({
        target: tenants.id,
        set: {
          name: "Bosphorus Homes Demo Tenant",
          status: "active"
        }
      });

    await tx
      .insert(offices)
      .values({
        id: LOCAL_DEMO_IDS.officeId,
        tenantId: LOCAL_DEMO_IDS.tenantId,
        name: "Bosphorus Homes Kadikoy Office",
        timezone: "Europe/Istanbul",
        phoneNumber: "+902165550100",
        humanTransferNumber: "+905325550100",
        status: "active"
      })
      .onConflictDoUpdate({
        target: offices.id,
        set: {
          tenantId: LOCAL_DEMO_IDS.tenantId,
          name: "Bosphorus Homes Kadikoy Office",
          timezone: "Europe/Istanbul",
          phoneNumber: "+902165550100",
          humanTransferNumber: "+905325550100",
          status: "active"
        }
      });

    await tx
      .insert(phoneNumberMappings)
      .values({
        id: LOCAL_DEMO_IDS.phoneMappingId,
        officeId: LOCAL_DEMO_IDS.officeId,
        provider: "retell",
        externalPhoneId: "retell-phone-demo-kadikoy",
        phoneNumber: "+902165550100",
        status: "active"
      })
      .onConflictDoUpdate({
        target: phoneNumberMappings.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          provider: "retell",
          externalPhoneId: "retell-phone-demo-kadikoy",
          phoneNumber: "+902165550100",
          status: "active"
        }
      });

    await tx
      .insert(promptVersions)
      .values({
        id: LOCAL_DEMO_IDS.promptVersionId,
        officeId: LOCAL_DEMO_IDS.officeId,
        name: "main_voice",
        channel: "voice",
        version: 1,
        content: DEMO_PROMPT_CONTENT,
        isActive: true
      })
      .onConflictDoUpdate({
        target: promptVersions.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          name: "main_voice",
          channel: "voice",
          version: 1,
          content: DEMO_PROMPT_CONTENT,
          isActive: true
        }
      });

    for (const listing of DEMO_LISTINGS) {
      await tx
        .insert(listings)
        .values({
          ...listing,
          officeId: LOCAL_DEMO_IDS.officeId,
          status: "active"
        })
        .onConflictDoUpdate({
          target: listings.id,
          set: {
            officeId: LOCAL_DEMO_IDS.officeId,
            referenceCode: listing.referenceCode,
            title: listing.title,
            description: listing.description,
            propertyType: listing.propertyType,
            listingType: listing.listingType,
            status: "active",
            price: listing.price,
            currency: listing.currency,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            netM2: listing.netM2,
            grossM2: listing.grossM2,
            floorNumber: listing.floorNumber,
            buildingAge: listing.buildingAge,
            dues: listing.dues,
            district: listing.district,
            neighborhood: listing.neighborhood,
            addressText: listing.addressText,
            hasBalcony: listing.hasBalcony,
            hasParking: listing.hasParking,
            hasElevator: listing.hasElevator
          }
        });
    }

    await tx
      .insert(showingRequests)
      .values({
        id: LOCAL_DEMO_IDS.showingRequestId,
        officeId: LOCAL_DEMO_IDS.officeId,
        listingId: LOCAL_DEMO_IDS.listingIds[0],
        customerName: "Ada Yilmaz",
        customerPhone: "+905551112233",
        customerEmail: "ada.yilmaz@example.com",
        preferredDatetime: new Date("2026-03-27T11:00:00.000Z"),
        status: "pending"
      })
      .onConflictDoUpdate({
        target: showingRequests.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          listingId: LOCAL_DEMO_IDS.listingIds[0],
          customerName: "Ada Yilmaz",
          customerPhone: "+905551112233",
          customerEmail: "ada.yilmaz@example.com",
          preferredDatetime: new Date("2026-03-27T11:00:00.000Z"),
          status: "pending"
        }
      });

    await tx
      .insert(callLogs)
      .values({
        id: LOCAL_DEMO_IDS.callLogId,
        officeId: LOCAL_DEMO_IDS.officeId,
        providerCallId: "retell-call-demo-kadikoy-001",
        direction: "inbound",
        status: "ended",
        summary:
          "Caller asked for a family apartment in Kadikoy and requested a showing for the Moda listing.",
        leadIntent: "showing_request",
        leadTemperature: "warm",
        handoffRecommended: false,
        budgetKnown: true,
        locationKnown: true,
        timelineKnown: true,
        startedAt: new Date("2026-03-25T09:00:00.000Z"),
        endedAt: new Date("2026-03-25T09:03:00.000Z"),
        payload: {
          source: "local_demo_seed"
        }
      })
      .onConflictDoUpdate({
        target: callLogs.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          providerCallId: "retell-call-demo-kadikoy-001",
          direction: "inbound",
          status: "ended",
          summary:
            "Caller asked for a family apartment in Kadikoy and requested a showing for the Moda listing.",
          leadIntent: "showing_request",
          leadTemperature: "warm",
          handoffRecommended: false,
          budgetKnown: true,
          locationKnown: true,
          timelineKnown: true,
          startedAt: new Date("2026-03-25T09:00:00.000Z"),
          endedAt: new Date("2026-03-25T09:03:00.000Z"),
          payload: {
            source: "local_demo_seed"
          }
        }
      });

    await tx
      .insert(integrationConnections)
      .values({
        id: LOCAL_DEMO_IDS.bookingConnectionId,
        officeId: LOCAL_DEMO_IDS.officeId,
        kind: "booking_workflow",
        status: "active",
        config: LOCAL_DEMO_CONNECTION_CONFIGS.booking
      })
      .onConflictDoUpdate({
        target: integrationConnections.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          kind: "booking_workflow",
          status: "active",
          config: LOCAL_DEMO_CONNECTION_CONFIGS.booking
        }
      });

    await tx
      .insert(integrationConnections)
      .values({
        id: LOCAL_DEMO_IDS.crmConnectionId,
        officeId: LOCAL_DEMO_IDS.officeId,
        kind: "crm_webhook",
        status: "active",
        config: LOCAL_DEMO_CONNECTION_CONFIGS.crm
      })
      .onConflictDoUpdate({
        target: integrationConnections.id,
        set: {
          officeId: LOCAL_DEMO_IDS.officeId,
          kind: "crm_webhook",
          status: "active",
          config: LOCAL_DEMO_CONNECTION_CONFIGS.crm
        }
      });
  });

  const listingSearchDocumentsService = createListingSearchDocumentsService(
    createListingSearchDocumentsRepository(db)
  );

  const seededSearchDocuments = [];

  for (const listingId of LOCAL_DEMO_IDS.listingIds) {
    const document = await listingSearchDocumentsService.syncMainDocumentForListing(
      listingId
    );

    seededSearchDocuments.push({
      listingId: document.listingId,
      documentType: document.documentType,
      hasEmbedding: document.hasEmbedding
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "seed",
        tenant: {
          id: LOCAL_DEMO_IDS.tenantId,
          name: "Bosphorus Homes Demo Tenant"
        },
        office: {
          id: LOCAL_DEMO_IDS.officeId,
          name: "Bosphorus Homes Kadikoy Office",
          phoneNumber: "+902165550100"
        },
        listings: DEMO_LISTINGS.map((listing) => ({
          id: listing.id,
          referenceCode: listing.referenceCode,
          title: listing.title
        })),
        promptVersion: {
          id: LOCAL_DEMO_IDS.promptVersionId,
          name: "main_voice",
          version: 1
        },
        phoneMapping: {
          id: LOCAL_DEMO_IDS.phoneMappingId,
          externalPhoneId: "retell-phone-demo-kadikoy"
        },
        bookingWorkflowConnection: {
          id: LOCAL_DEMO_IDS.bookingConnectionId,
          workflowName: "ai-ses - Booking Flow"
        },
        crmWebhookConnection: {
          id: LOCAL_DEMO_IDS.crmConnectionId,
          workflowName: "ai-ses - CRM Sync"
        },
        sampleShowingRequest: {
          id: LOCAL_DEMO_IDS.showingRequestId,
          listingId: LOCAL_DEMO_IDS.listingIds[0],
          status: "pending"
        },
        sampleCallLog: {
          id: LOCAL_DEMO_IDS.callLogId,
          providerCallId: "retell-call-demo-kadikoy-001"
        },
        listingSearchDocuments: {
          count: seededSearchDocuments.length,
          mode: "lexical-only",
          items: seededSearchDocuments
        }
      },
      null,
      2
    )
  );
}

export async function seedLocalDemoData() {
  await withLocalDemoDataLock(async () => {
    await seedLocalDemoDataWithoutLock();
  });
}

async function main() {
  if (shouldCleanup()) {
    await cleanupLocalDemoData();
    return;
  }

  await seedLocalDemoData();
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (executedPath !== null && path.resolve(scriptPath) === executedPath) {
  try {
    await main();
  } finally {
    await pool.end();
  }
}
