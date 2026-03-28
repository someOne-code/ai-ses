import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, desc, eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5433/ai_ses";
process.env.N8N_BASE_URL ??= "https://n8n.example.test";
process.env.N8N_CRM_TRIGGER_SECRET ??= "crm-trigger-test-secret";
process.env.N8N_BOOKING_CALLBACK_SECRET ??= "booking-callback-test-secret";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

import { db } from "../src/db/client.js";
import {
  auditEvents,
  integrationConnections,
  listings,
  offices,
  showingRequests,
  tenants
} from "../src/db/schema/index.js";
import { N8N_CALLBACK_SECRET_HEADER } from "../src/modules/integrations/types.js";

async function insertShowingRequestFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Default Wiring Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Default Wiring Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Default Wiring Listing",
    description: "Default app wiring coverage listing.",
    propertyType: "apartment",
    listingType: "rent",
    status: "active",
    price: "55000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "95.00",
    district: "Kadikoy",
    neighborhood: "Moda"
  });

  return { tenantId, officeId, listingId };
}

async function cleanupShowingRequestFixture(input: {
  tenantId: string;
  officeId: string;
  listingId: string;
}) {
  await db
    .delete(showingRequests)
    .where(eq(showingRequests.listingId, input.listingId));
  await db.delete(listings).where(eq(listings.id, input.listingId));
  await db.delete(offices).where(eq(offices.id, input.officeId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}

async function insertBookingDispatchFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();
  const showingRequestId = randomUUID();
  const bookingConnectionId = randomUUID();
  const crmConnectionId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Default Wiring Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Default Wiring Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Default Wiring Booking Listing",
    description: "Default app wiring CRM dispatch listing.",
    propertyType: "apartment",
    listingType: "sale",
    status: "active",
    price: "7200000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "135.00",
    district: "Besiktas",
    neighborhood: "Levent"
  });
  await db.insert(showingRequests).values({
    id: showingRequestId,
    officeId,
    listingId,
    customerName: "Can Demir",
    customerPhone: "+905551234567",
    customerEmail: "can@example.com",
    preferredTimeWindow: "morning",
    preferredDatetime: new Date("2026-03-28T10:00:00.000Z"),
    status: "pending"
  });
  await db.insert(integrationConnections).values([
    {
      id: bookingConnectionId,
      officeId,
      kind: "booking_workflow",
      status: "active",
      config: {
        workflowSlug: "ai-ses-booking-flow",
        triggerPath: "/webhook/booking-test"
      }
    },
    {
      id: crmConnectionId,
      officeId,
      kind: "crm_webhook",
      status: "active",
      config: {
        workflowSlug: "ai-ses-crm-sync",
        triggerPath: "/webhook/live-crm-route"
      }
    }
  ]);

  return {
    tenantId,
    officeId,
    listingId,
    showingRequestId,
    bookingConnectionId
  };
}

async function cleanupBookingDispatchFixture(input: {
  tenantId: string;
  officeId: string;
  listingId: string;
  showingRequestId: string;
}) {
  await db.delete(auditEvents).where(eq(auditEvents.officeId, input.officeId));
  await db
    .delete(integrationConnections)
    .where(eq(integrationConnections.officeId, input.officeId));
  await db
    .delete(showingRequests)
    .where(eq(showingRequests.id, input.showingRequestId));
  await db.delete(listings).where(eq(listings.id, input.listingId));
  await db.delete(offices).where(eq(offices.id, input.officeId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}

test("default app wiring registers retell routes with env-backed secret validation", async () => {
  const app = await createApp({
    readyCheck: async () => undefined
  });

  const toolResponse = await app.inject({
    method: "POST",
    url: "/v1/retell/tools",
    payload: {
      name: "search_listings",
      args: {},
      call: {
        call_id: "default-wiring-retell-tool",
        metadata: {
          office_id: randomUUID()
        }
      }
    }
  });
  const webhookResponse = await app.inject({
    method: "POST",
    url: "/v1/webhooks/retell",
    payload: {
      event: "call_ended",
      call: {
        call_id: "default-wiring-retell-webhook",
        call_status: "ended"
      }
    }
  });

  assert.equal(toolResponse.statusCode, 401);
  assert.equal(toolResponse.json().error.code, "RETELL_SIGNATURE_INVALID");
  assert.equal(webhookResponse.statusCode, 401);
  assert.equal(webhookResponse.json().error.code, "RETELL_SIGNATURE_INVALID");
});

test("default app wiring uses the showing requests database service", async () => {
  const fixture = await insertShowingRequestFixture();
  const app = await createApp({
    readyCheck: async () => undefined
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/v1/offices/${fixture.officeId}/showing-requests`,
      payload: {
        listingId: fixture.listingId,
        customerName: "Ada Yilmaz",
        customerPhone: "+905551112233",
        customerEmail: "ada@example.com",
        preferredTimeWindow: "afternoon",
        preferredDatetime: "2026-03-28T13:00:00.000Z"
      }
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.officeId, fixture.officeId);
    assert.equal(response.json().data.listingId, fixture.listingId);
    assert.equal(response.json().data.preferredTimeWindow, "afternoon");
    assert.equal(response.json().data.status, "pending");

    const rows = await db
      .select({
        id: showingRequests.id,
        officeId: showingRequests.officeId,
        listingId: showingRequests.listingId,
        preferredTimeWindow: showingRequests.preferredTimeWindow,
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, response.json().data.id))
      .limit(1);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.officeId, fixture.officeId);
    assert.equal(rows[0]?.listingId, fixture.listingId);
    assert.equal(rows[0]?.preferredTimeWindow, "afternoon");
    assert.equal(rows[0]?.status, "pending");
  } finally {
    await cleanupShowingRequestFixture(fixture);
  }
});

test("default app wiring accepts single-name showing requests without forcing surname or email", async () => {
  const fixture = await insertShowingRequestFixture();
  const app = await createApp({
    readyCheck: async () => undefined
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/v1/offices/${fixture.officeId}/showing-requests`,
      payload: {
        listingId: fixture.listingId,
        customerName: "Umut",
        customerPhone: "+905551112233",
        customerEmail: "",
        preferredDatetime: "2026-03-28T13:00:00.000Z"
      }
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.customerName, "Umut");
    assert.equal(response.json().data.customerEmail, null);

    const rows = await db
      .select({
        customerName: showingRequests.customerName,
        customerEmail: showingRequests.customerEmail
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, response.json().data.id))
      .limit(1);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.customerName, "Umut");
    assert.equal(rows[0]?.customerEmail, null);
  } finally {
    await cleanupShowingRequestFixture(fixture);
  }
});

test("default app wiring dispatches resulting crm events after booking callbacks", async () => {
  const fixture = await insertBookingDispatchFixture();
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({
      url: typeof input === "string" ? input : input.toString(),
      init
    });

    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as typeof fetch;

  const app = await createApp({
    readyCheck: async () => undefined
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]:
          process.env.N8N_BOOKING_CALLBACK_SECRET as string
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "confirmed",
        workflowRunId: "default-wiring-booking-run",
        scheduledDatetime: "2026-03-28T14:00:00.000Z",
        note: "Default app wiring booking callback."
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(fetchCalls.length, 1);
    const dispatchedUrl = new URL(fetchCalls[0]?.url as string);

    assert.equal(dispatchedUrl.pathname, "/webhook/live-crm-route");
    assert.equal(
      (fetchCalls[0]?.init?.headers as Record<string, string>)?.[
        "x-ai-ses-trigger-secret"
      ],
      process.env.N8N_CRM_TRIGGER_SECRET
    );

    const dispatchBody = JSON.parse(fetchCalls[0]?.init?.body as string) as {
      office: { officeId: string };
      entity: { entityType: string; id: string; status: string };
      event: { eventType: string };
      connection: { config: { triggerPath: string } };
    };

    assert.equal(dispatchBody.office.officeId, fixture.officeId);
    assert.equal(dispatchBody.entity.entityType, "showing_request");
    assert.equal(dispatchBody.entity.id, fixture.showingRequestId);
    assert.equal(dispatchBody.entity.status, "confirmed");
    assert.equal(dispatchBody.event.eventType, "showing_booking_confirmed");
    assert.equal(
      dispatchBody.connection.config.triggerPath,
      "/webhook/live-crm-route"
    );

    const [bookingAudit] = await db
      .select({
        action: auditEvents.action,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(bookingAudit?.action, "booking_result_recorded");
    assert.equal(
      (bookingAudit?.payload as { status?: string } | undefined)?.status,
      "confirmed"
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupBookingDispatchFixture(fixture);
    await app.close();
  }
});
