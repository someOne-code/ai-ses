import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, desc, eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5433/ai_ses";
process.env.N8N_BASE_URL ??= "https://n8n.example.test";
process.env.N8N_CRM_TRIGGER_SECRET ??= "crm-trigger-test-secret";
process.env.N8N_BOOKING_CALLBACK_SECRET ??= "booking-callback-test-secret";
process.env.N8N_CRM_CALLBACK_SECRET ??= "crm-callback-test-secret";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

import { db } from "../src/db/client.js";
import {
  auditEvents,
  callLogs,
  integrationConnections,
  listings,
  offices,
  showingRequests,
  tenants
} from "../src/db/schema/index.js";
import { createIntegrationsRepository } from "../src/modules/integrations/repository.js";
import { createIntegrationsService } from "../src/modules/integrations/service.js";
import {
  N8N_CALLBACK_SECRET_HEADER,
  parseBookingResultCallbackBody,
  parseCrmDeliveryCallbackBody,
  type BookingWorkflowDispatchContract,
  type CrmWebhookDispatchContract
} from "../src/modules/integrations/types.js";
import type { ListingsService } from "../src/modules/listings/service.js";
import type { RetellService } from "../src/modules/retell/service.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";

const BOOKING_CALLBACK_SECRET = "booking-callback-test-secret";
const CRM_CALLBACK_SECRET = "crm-callback-test-secret";

function createStubListingsService(): ListingsService {
  return {
    async searchListings() {
      return [];
    },
    async getListingByReference() {
      throw new Error("getListingByReference should not be called in integrations tests");
    },
    async refreshMainSearchDocument() {
      throw new Error(
        "refreshMainSearchDocument should not be called in integrations tests"
      );
    }
  };
}

function createStubShowingRequestsService(): ShowingRequestsService {
  return {
    async createShowingRequest() {
      throw new Error("createShowingRequest should not be called in integrations tests");
    }
  };
}

function createStubRetellService(): RetellService {
  return {
    async executeTool() {
      throw new Error("executeTool should not be called in integrations tests");
    },
    async handleWebhook() {
      throw new Error("handleWebhook should not be called in integrations tests");
    }
  };
}

async function createIntegrationTestApp(overrides?: {
  integrationsService?: ReturnType<typeof createIntegrationsService>;
}) {
  return createApp({
    registerDatabasePlugin: false,
    bookingCallbackSecret: BOOKING_CALLBACK_SECRET,
    crmCallbackSecret: CRM_CALLBACK_SECRET,
    integrationsService:
      overrides?.integrationsService ??
      createIntegrationsService({
        repository: createIntegrationsRepository(db)
      }),
    listingsService: createStubListingsService(),
    retellService: createStubRetellService(),
    showingRequestsService: createStubShowingRequestsService(),
    readyCheck: async () => undefined
  });
}

async function insertFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const otherTenantId = randomUUID();
  const otherOfficeId = randomUUID();
  const listingId = randomUUID();
  const showingRequestId = randomUUID();
  const callLogId = randomUUID();
  const otherCallLogId = randomUUID();
  const bookingConnectionId = randomUUID();
  const crmConnectionId = randomUUID();

  await db.insert(tenants).values([
    { id: tenantId, name: `Integrations Test Tenant ${tenantId}` },
    { id: otherTenantId, name: `Integrations Test Tenant ${otherTenantId}` }
  ]);

  await db.insert(offices).values([
    {
      id: officeId,
      tenantId,
      name: `Integrations Test Office ${officeId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    },
    {
      id: otherOfficeId,
      tenantId: otherTenantId,
      name: `Integrations Test Office ${otherOfficeId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    }
  ]);

  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Integration Test Listing",
    description: "Integration test listing description.",
    propertyType: "apartment",
    listingType: "rent",
    status: "active",
    price: "65000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "110.00",
    district: "Kadikoy",
    neighborhood: "Moda"
  });

  await db.insert(showingRequests).values({
    id: showingRequestId,
    officeId,
    listingId,
    customerName: "Ada Yilmaz",
    customerPhone: "+905551112233",
    customerEmail: "ada@example.com",
    preferredTimeWindow: "afternoon",
    preferredDatetime: new Date("2026-03-27T11:00:00.000Z"),
    status: "pending"
  });

  await db.insert(callLogs).values([
    {
      id: callLogId,
      officeId,
      providerCallId: `provider-${callLogId.slice(0, 8)}`,
      direction: "inbound",
      status: "ended",
      summary: "Customer asked for a showing.",
      startedAt: new Date("2026-03-27T10:00:00.000Z"),
      endedAt: new Date("2026-03-27T10:03:00.000Z")
    },
    {
      id: otherCallLogId,
      officeId: otherOfficeId,
      providerCallId: `provider-${otherCallLogId.slice(0, 8)}`,
      direction: "inbound",
      status: "ended",
      summary: "Other office call log.",
      startedAt: new Date("2026-03-27T10:15:00.000Z"),
      endedAt: new Date("2026-03-27T10:17:00.000Z")
    }
  ]);

  await db.insert(integrationConnections).values([
    {
      id: bookingConnectionId,
      officeId,
      kind: "booking_workflow",
      status: "active",
      config: {
        workflowSlug: "ai-ses-booking-flow",
        triggerPath: "/webhook/ai-ses-booking-flow",
        availabilityUrl: "https://calendar.example.test/availability",
        bookingUrl: "https://calendar.example.test/bookings",
        callbackPath: "https://evil.example.test/booking-results",
        callbackSecretHeader: "x-evil-secret",
        backendBaseUrl: "https://evil.example.test"
      }
    },
    {
      id: crmConnectionId,
      officeId,
      kind: "crm_webhook",
      status: "active",
      config: {
        workflowSlug: "ai-ses-crm-sync",
        triggerPath: "/webhook/ai-ses-crm-sync",
        callbackPath: "https://evil.example.test/crm-deliveries",
        callbackSecretHeader: "x-evil-crm-secret",
        backendBaseUrl: "https://evil.example.test"
      }
    }
  ]);

  return {
    tenantId,
    officeId,
    otherTenantId,
    otherOfficeId,
    listingId,
    showingRequestId,
    callLogId,
    otherCallLogId,
    bookingConnectionId,
    crmConnectionId
  };
}

async function cleanupFixture(input: {
  tenantId: string;
  officeId: string;
  otherTenantId: string;
  otherOfficeId: string;
  listingId: string;
  showingRequestId: string;
  callLogId: string;
  otherCallLogId: string;
}) {
  await db
    .delete(auditEvents)
    .where(
      inArray(auditEvents.officeId, [input.officeId, input.otherOfficeId])
    );
  await db
    .delete(integrationConnections)
    .where(
      inArray(integrationConnections.officeId, [input.officeId, input.otherOfficeId])
    );
  await db
    .delete(showingRequests)
    .where(eq(showingRequests.id, input.showingRequestId));
  await db
    .delete(callLogs)
    .where(inArray(callLogs.id, [input.callLogId, input.otherCallLogId]));
  await db.delete(listings).where(eq(listings.id, input.listingId));
  await db
    .delete(offices)
    .where(inArray(offices.id, [input.officeId, input.otherOfficeId]));
  await db
    .delete(tenants)
    .where(inArray(tenants.id, [input.tenantId, input.otherTenantId]));
}

test("booking workflow contract resolves the active office-scoped connection and payload", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    const contract: BookingWorkflowDispatchContract =
      await service.getBookingWorkflowContract({
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId
      });

    assert.equal(contract.kind, "booking_workflow");
    assert.equal(contract.connection.id, fixture.bookingConnectionId);
    assert.equal(contract.office.officeId, fixture.officeId);
    assert.equal(contract.showingRequest.id, fixture.showingRequestId);
    assert.equal(contract.showingRequest.listingId, fixture.listingId);
    assert.equal(contract.showingRequest.preferredTimeWindow, "afternoon");
    assert.equal(contract.callback.path, "/v1/webhooks/n8n/booking-results");
    assert.equal(contract.callback.secretHeader, N8N_CALLBACK_SECRET_HEADER);
    assert.equal(
      contract.callback.secretEnvName,
      "N8N_BOOKING_CALLBACK_SECRET"
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("integration contracts keep callback metadata fixed even if connection config contains misleading callback fields", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    const bookingContract = await service.getBookingWorkflowContract({
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId
    });
    const crmContract = await service.getCrmWebhookContract({
      officeId: fixture.officeId,
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready"
    });

    assert.deepEqual(bookingContract.callback, {
      path: "/v1/webhooks/n8n/booking-results",
      secretHeader: N8N_CALLBACK_SECRET_HEADER,
      secretEnvName: "N8N_BOOKING_CALLBACK_SECRET"
    });
    assert.deepEqual(crmContract.callback, {
      path: "/v1/webhooks/n8n/crm-deliveries",
      secretHeader: N8N_CALLBACK_SECRET_HEADER,
      secretEnvName: "N8N_CRM_CALLBACK_SECRET"
    });
    assert.deepEqual(bookingContract.connection.config, {
      workflowSlug: "ai-ses-booking-flow",
      triggerPath: "/webhook/ai-ses-booking-flow",
      availabilityUrl: "https://calendar.example.test/availability",
      bookingUrl: "https://calendar.example.test/bookings",
      callbackPath: "https://evil.example.test/booking-results",
      callbackSecretHeader: "x-evil-secret",
      backendBaseUrl: "https://evil.example.test"
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("crm webhook contract resolves an office-scoped call log payload", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    const contract: CrmWebhookDispatchContract =
      await service.getCrmWebhookContract({
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready"
      });

    assert.equal(contract.kind, "crm_webhook");
    assert.equal(contract.connection.id, fixture.crmConnectionId);
    assert.equal(contract.office.officeId, fixture.officeId);
    assert.equal(contract.entity.entityType, "call_log");
    assert.equal(contract.entity.id, fixture.callLogId);
    assert.equal(contract.event.eventType, "call_summary_ready");
    assert.equal(contract.callback.path, "/v1/webhooks/n8n/crm-deliveries");
    assert.equal(contract.callback.secretHeader, N8N_CALLBACK_SECRET_HEADER);
    assert.equal(contract.callback.secretEnvName, "N8N_CRM_CALLBACK_SECRET");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("crm webhook contract preserves showing request flexible time windows", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    const contract: CrmWebhookDispatchContract =
      await service.getCrmWebhookContract({
        officeId: fixture.officeId,
        entityType: "showing_request",
        entityId: fixture.showingRequestId,
        eventType: "showing_request_created"
      });

    assert.equal(contract.kind, "crm_webhook");
    assert.equal(contract.connection.id, fixture.crmConnectionId);
    assert.equal(contract.office.officeId, fixture.officeId);
    assert.equal(contract.entity.entityType, "showing_request");
    assert.equal(contract.entity.id, fixture.showingRequestId);
    assert.equal(contract.entity.preferredTimeWindow, "afternoon");
    assert.equal(contract.event.eventType, "showing_request_created");
    assert.equal(contract.callback.path, "/v1/webhooks/n8n/crm-deliveries");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("default app wiring registers the booking and CRM callback routes when env secrets exist", async () => {
  const app = await createApp({
    readyCheck: async () => undefined
  });

  const bookingResponse = await app.inject({
    method: "POST",
    url: "/v1/webhooks/n8n/booking-results",
    payload: {}
  });
  const crmResponse = await app.inject({
    method: "POST",
    url: "/v1/webhooks/n8n/crm-deliveries",
    payload: {}
  });

  assert.equal(bookingResponse.statusCode, 401);
  assert.equal(
    bookingResponse.json().error.code,
    "N8N_BOOKING_CALLBACK_FORBIDDEN"
  );
  assert.equal(crmResponse.statusCode, 401);
  assert.equal(
    crmResponse.json().error.code,
    "N8N_CRM_CALLBACK_FORBIDDEN"
  );
});

test("integration callback parsers normalize null and blank optional provider fields", () => {
  const bookingPayload = parseBookingResultCallbackBody({
    officeId: randomUUID(),
    showingRequestId: randomUUID(),
    connectionId: randomUUID(),
    status: "confirmed",
    workflowRunId: "",
    externalBookingId: null,
    scheduledDatetime: " ",
    note: "   ",
    payload: {
      attempt: 1
    }
  });

  assert.equal(bookingPayload.workflowRunId, undefined);
  assert.equal(bookingPayload.externalBookingId, undefined);
  assert.equal(bookingPayload.scheduledDatetime, undefined);
  assert.equal(bookingPayload.note, undefined);

  const crmPayload = parseCrmDeliveryCallbackBody({
    officeId: randomUUID(),
    connectionId: randomUUID(),
    entityType: "showing_request",
    entityId: randomUUID(),
    eventType: "showing_request_created",
    deliveryStatus: "delivered",
    workflowRunId: null,
    externalRecordId: "",
    note: " ",
    payload: {
      deliveryAttempt: 2
    }
  });

  assert.equal(crmPayload.workflowRunId, undefined);
  assert.equal(crmPayload.externalRecordId, undefined);
  assert.equal(crmPayload.note, undefined);
});

test("booking result callback updates showing request status and records an audit event", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "confirmed",
        workflowRunId: "n8n-booking-run-1",
        externalBookingId: "booking-ext-1",
        scheduledDatetime: "2026-03-28T12:30:00.000Z",
        note: "Calendar event booked.",
        payload: {
          calendarEventId: "calendar-event-1"
        }
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.bookingConnectionId);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "confirmed");

    const [auditEvent] = await db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
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

    assert.equal(auditEvent?.actorType, "n8n");
    assert.equal(auditEvent?.actorId, "n8n-booking-run-1");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.bookingConnectionId,
      kind: "booking_workflow",
      showingRequestId: fixture.showingRequestId,
      listingId: fixture.listingId,
      status: "confirmed",
      externalBookingId: "booking-ext-1",
      scheduledDatetime: "2026-03-28T12:30:00.000Z",
      note: "Calendar event booked.",
      payload: {
        calendarEventId: "calendar-event-1"
      }
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("booking result callback dispatches the resulting crm event through backend-owned logic", async () => {
  const fixture = await insertFixture();
  const dispatchedContracts: CrmWebhookDispatchContract[] = [];
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db),
    crmWorkflowDispatcher: {
      async dispatchCrmWebhook(contract) {
        dispatchedContracts.push(contract);
      }
    }
  });

  try {
    const result = await service.handleBookingResultCallback({
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId,
      connectionId: fixture.bookingConnectionId,
      status: "confirmed",
      workflowRunId: "n8n-booking-run-confirmed"
    });

    assert.equal(result.received, true);
    assert.equal(dispatchedContracts.length, 1);
    assert.equal(dispatchedContracts[0]?.kind, "crm_webhook");
    assert.equal(dispatchedContracts[0]?.connection.id, fixture.crmConnectionId);
    assert.equal(dispatchedContracts[0]?.office.officeId, fixture.officeId);
    assert.equal(dispatchedContracts[0]?.entity.entityType, "showing_request");
    assert.equal(dispatchedContracts[0]?.entity.id, fixture.showingRequestId);
    assert.equal(
      dispatchedContracts[0]?.event.eventType,
      "showing_booking_confirmed"
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("booking result callback stays successful but records a backend-visible audit when crm dispatch fails", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db),
    crmWorkflowDispatcher: {
      async dispatchCrmWebhook() {
        throw new Error("CRM workflow dispatch failed with status 500.");
      }
    }
  });

  try {
    const result = await service.handleBookingResultCallback({
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId,
      connectionId: fixture.bookingConnectionId,
      status: "failed",
      workflowRunId: "n8n-booking-run-failed"
    });

    assert.equal(result.received, true);

    const [auditEvent] = await db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_dispatch_failed")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(auditEvent?.actorType, "backend");
    assert.deepEqual(auditEvent?.payload, {
      sourceAction: "booking_result_recorded",
      showingRequestId: fixture.showingRequestId,
      bookingStatus: "failed",
      eventType: "showing_booking_failed",
      error: "CRM workflow dispatch failed with status 500."
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("duplicate booking callback with the same workflowRunId is idempotent and does not redispatch crm", async () => {
  const fixture = await insertFixture();
  const dispatchedContracts: CrmWebhookDispatchContract[] = [];
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db),
    crmWorkflowDispatcher: {
      async dispatchCrmWebhook(contract) {
        dispatchedContracts.push(contract);
      }
    }
  });

  try {
    const callbackPayload = {
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId,
      connectionId: fixture.bookingConnectionId,
      status: "confirmed" as const,
      workflowRunId: "n8n-booking-run-idempotent",
      externalBookingId: "booking-ext-idempotent",
      scheduledDatetime: "2026-03-28T16:00:00.000Z",
      note: "Duplicate-safe booking callback."
    };

    const first = await service.handleBookingResultCallback(callbackPayload);
    const second = await service.handleBookingResultCallback(callbackPayload);

    assert.deepEqual(second, first);
    assert.equal(dispatchedContracts.length, 1);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "confirmed");

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded"),
          eq(auditEvents.actorId, "n8n-booking-run-idempotent")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("duplicate booking callback delivery stays idempotent through the route surface", async () => {
  const fixture = await insertFixture();
  const dispatchedContracts: CrmWebhookDispatchContract[] = [];
  const app = await createIntegrationTestApp({
    integrationsService: createIntegrationsService({
      repository: createIntegrationsRepository(db),
      crmWorkflowDispatcher: {
        async dispatchCrmWebhook(contract) {
          dispatchedContracts.push(contract);
        }
      }
    })
  });

  try {
    const payload = {
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId,
      connectionId: fixture.bookingConnectionId,
      status: "confirmed",
      workflowRunId: "n8n-booking-route-idempotent",
      externalBookingId: "booking-ext-route-idempotent",
      scheduledDatetime: "2026-03-28T17:00:00.000Z",
      note: "Duplicate-safe booking route callback."
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(dispatchedContracts.length, 1);

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded"),
          eq(auditEvents.actorId, "n8n-booking-route-idempotent")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("duplicate booking callback delivery with the same workflowRunId rejects conflicting payloads without changing the accepted status", async () => {
  const fixture = await insertFixture();
  const dispatchedContracts: CrmWebhookDispatchContract[] = [];
  const app = await createIntegrationTestApp({
    integrationsService: createIntegrationsService({
      repository: createIntegrationsRepository(db),
      crmWorkflowDispatcher: {
        async dispatchCrmWebhook(contract) {
          dispatchedContracts.push(contract);
        }
      }
    })
  });

  try {
    const first = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "confirmed",
        workflowRunId: "n8n-booking-route-conflict"
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "failed",
        workflowRunId: "n8n-booking-route-conflict"
      }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
    assert.equal(
      second.json().error.code,
      "BOOKING_CALLBACK_WORKFLOW_RUN_CONFLICT"
    );
    assert.equal(dispatchedContracts.length, 1);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "confirmed");

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded"),
          eq(auditEvents.actorId, "n8n-booking-route-conflict")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("booking callback rejects a reused workflowRunId when the payload changes without mutating the accepted status", async () => {
  const fixture = await insertFixture();
  const dispatchedContracts: CrmWebhookDispatchContract[] = [];
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db),
    crmWorkflowDispatcher: {
      async dispatchCrmWebhook(contract) {
        dispatchedContracts.push(contract);
      }
    }
  });

  try {
    await service.handleBookingResultCallback({
      officeId: fixture.officeId,
      showingRequestId: fixture.showingRequestId,
      connectionId: fixture.bookingConnectionId,
      status: "confirmed",
      workflowRunId: "n8n-booking-run-conflict"
    });

    await assert.rejects(
      service.handleBookingResultCallback({
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "failed",
        workflowRunId: "n8n-booking-run-conflict"
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "BOOKING_CALLBACK_WORKFLOW_RUN_CONFLICT"
        );

        return true;
      }
    );

    assert.equal(dispatchedContracts.length, 1);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "confirmed");

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded"),
          eq(auditEvents.actorId, "n8n-booking-run-conflict")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("booking result callback rejects an invalid callback secret", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: "invalid-secret"
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "failed"
      }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "N8N_BOOKING_CALLBACK_FORBIDDEN");

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "pending");

    const [auditEvent] = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "booking_result_recorded")
        )
      )
      .limit(1);

    assert.equal(auditEvent, undefined);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("booking result callback rejects payloads that do not include the dispatched connection id", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        status: "failed"
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.message,
      "Invalid booking result callback payload."
    );

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "pending");
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("booking result callback keeps correlating to the dispatched connection after rotation", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();
  const replacementConnectionId = randomUUID();

  try {
    await db
      .update(integrationConnections)
      .set({
        status: "inactive",
        updatedAt: new Date("2026-03-27T12:00:00.000Z")
      })
      .where(eq(integrationConnections.id, fixture.bookingConnectionId));

    await db.insert(integrationConnections).values({
      id: replacementConnectionId,
      officeId: fixture.officeId,
      kind: "booking_workflow",
      status: "active",
      config: {
        workflowSlug: "ai-ses-booking-flow-v2",
        triggerPath: "/webhook/ai-ses-booking-flow-v2",
        availabilityUrl: "https://calendar.example.test/availability-v2",
        bookingUrl: "https://calendar.example.test/bookings-v2"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "confirmed",
        workflowRunId: "n8n-booking-run-rotated",
        scheduledDatetime: "2026-03-28T14:00:00.000Z",
        note: "Original workflow run finished after rotation.",
        payload: {
          branch: "confirmed_after_rotation"
        }
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.bookingConnectionId);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "confirmed");

    const [auditEvent] = await db
      .select({
        actorId: auditEvents.actorId,
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

    assert.equal(auditEvent?.actorId, "n8n-booking-run-rotated");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.bookingConnectionId,
      kind: "booking_workflow",
      showingRequestId: fixture.showingRequestId,
      listingId: fixture.listingId,
      status: "confirmed",
      externalBookingId: null,
      scheduledDatetime: "2026-03-28T14:00:00.000Z",
      note: "Original workflow run finished after rotation.",
      payload: {
        branch: "confirmed_after_rotation"
      }
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("booking result callback accepts the dispatched connection after it is deactivated", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    await db
      .update(integrationConnections)
      .set({
        status: "inactive",
        updatedAt: new Date("2026-03-27T12:30:00.000Z")
      })
      .where(eq(integrationConnections.id, fixture.bookingConnectionId));

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/booking-results",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: BOOKING_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        showingRequestId: fixture.showingRequestId,
        connectionId: fixture.bookingConnectionId,
        status: "failed",
        workflowRunId: "n8n-booking-run-deactivated",
        note: "Original connection was deactivated before callback delivery."
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.bookingConnectionId);

    const [showingRequest] = await db
      .select({
        status: showingRequests.status
      })
      .from(showingRequests)
      .where(eq(showingRequests.id, fixture.showingRequestId))
      .limit(1);

    assert.equal(showingRequest?.status, "failed");

    const [auditEvent] = await db
      .select({
        actorId: auditEvents.actorId,
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

    assert.equal(auditEvent?.actorId, "n8n-booking-run-deactivated");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.bookingConnectionId,
      kind: "booking_workflow",
      showingRequestId: fixture.showingRequestId,
      listingId: fixture.listingId,
      status: "failed",
      externalBookingId: null,
      scheduledDatetime: null,
      note: "Original connection was deactivated before callback delivery."
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("crm delivery callback records an audit event for an office-scoped entity", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "delivered",
        workflowRunId: "n8n-crm-run-1",
        externalRecordId: "crm-record-123",
        note: "Lead pushed to CRM.",
        payload: {
          crm: "generic-webhook"
        }
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.crmConnectionId);

    const [auditEvent] = await db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(auditEvent?.actorType, "n8n");
    assert.equal(auditEvent?.actorId, "n8n-crm-run-1");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.crmConnectionId,
      kind: "crm_webhook",
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready",
      deliveryStatus: "delivered",
      externalRecordId: "crm-record-123",
      note: "Lead pushed to CRM.",
      payload: {
        crm: "generic-webhook"
      }
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("duplicate crm callback with the same workflowRunId is idempotent", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    const callbackPayload = {
      officeId: fixture.officeId,
      connectionId: fixture.crmConnectionId,
      entityType: "call_log" as const,
      entityId: fixture.callLogId,
      eventType: "call_summary_ready" as const,
      deliveryStatus: "delivered" as const,
      workflowRunId: "n8n-crm-run-idempotent",
      externalRecordId: "crm-record-idempotent",
      note: "Duplicate-safe CRM callback."
    };

    const first = await service.handleCrmDeliveryCallback(callbackPayload);
    const second = await service.handleCrmDeliveryCallback(callbackPayload);

    assert.deepEqual(second, first);

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded"),
          eq(auditEvents.actorId, "n8n-crm-run-idempotent")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("duplicate crm callback delivery stays idempotent through the route surface", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const payload = {
      officeId: fixture.officeId,
      connectionId: fixture.crmConnectionId,
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready",
      deliveryStatus: "delivered",
      workflowRunId: "n8n-crm-route-idempotent",
      externalRecordId: "crm-record-route-idempotent",
      note: "Duplicate-safe CRM route callback."
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);

    const recordedAudits = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded"),
          eq(auditEvents.actorId, "n8n-crm-route-idempotent")
        )
      );

    assert.equal(recordedAudits.length, 1);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("duplicate crm callback delivery with the same workflowRunId rejects conflicting payloads", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const first = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "delivered",
        workflowRunId: "n8n-crm-route-conflict"
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "failed",
        workflowRunId: "n8n-crm-route-conflict"
      }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
    assert.equal(
      second.json().error.code,
      "CRM_CALLBACK_WORKFLOW_RUN_CONFLICT"
    );
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("crm callback rejects a reused workflowRunId when the payload changes", async () => {
  const fixture = await insertFixture();
  const service = createIntegrationsService({
    repository: createIntegrationsRepository(db)
  });

  try {
    await service.handleCrmDeliveryCallback({
      officeId: fixture.officeId,
      connectionId: fixture.crmConnectionId,
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready",
      deliveryStatus: "delivered",
      workflowRunId: "n8n-crm-run-conflict"
    });

    await assert.rejects(
      service.handleCrmDeliveryCallback({
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "failed",
        workflowRunId: "n8n-crm-run-conflict"
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "CRM_CALLBACK_WORKFLOW_RUN_CONFLICT"
        );

        return true;
      }
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("crm delivery callback enforces office-scoped entity ownership", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.otherCallLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "failed"
      }
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "CRM_SYNC_ENTITY_NOT_FOUND");

    const [auditEvent] = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded")
        )
      )
      .limit(1);

    assert.equal(auditEvent, undefined);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("crm delivery callback rejects payloads that do not include the dispatched connection id", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "failed"
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json().error.message,
      "Invalid CRM delivery callback payload."
    );

    const [auditEvent] = await db
      .select({
        id: auditEvents.id
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded")
        )
      )
      .limit(1);

    assert.equal(auditEvent, undefined);
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("crm delivery callback keeps correlating to the dispatched connection after rotation", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();
  const replacementConnectionId = randomUUID();

  try {
    await db
      .update(integrationConnections)
      .set({
        status: "inactive",
        updatedAt: new Date("2026-03-27T12:45:00.000Z")
      })
      .where(eq(integrationConnections.id, fixture.crmConnectionId));

    await db.insert(integrationConnections).values({
      id: replacementConnectionId,
      officeId: fixture.officeId,
      kind: "crm_webhook",
      status: "active",
      config: {
        workflowSlug: "ai-ses-crm-sync-v2",
        triggerPath: "/webhook/ai-ses-crm-sync-v2",
        deliveryUrl: "https://crm.example.test/v2/webhooks"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "delivered",
        workflowRunId: "n8n-crm-run-rotated",
        externalRecordId: "crm-record-rotated",
        note: "Original CRM workflow run finished after rotation.",
        payload: {
          branch: "delivered_after_rotation"
        }
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.crmConnectionId);

    const [auditEvent] = await db
      .select({
        actorId: auditEvents.actorId,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(auditEvent?.actorId, "n8n-crm-run-rotated");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.crmConnectionId,
      kind: "crm_webhook",
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready",
      deliveryStatus: "delivered",
      externalRecordId: "crm-record-rotated",
      note: "Original CRM workflow run finished after rotation.",
      payload: {
        branch: "delivered_after_rotation"
      }
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});

test("crm delivery callback accepts the dispatched connection after it is deactivated", async () => {
  const fixture = await insertFixture();
  const app = await createIntegrationTestApp();

  try {
    await db
      .update(integrationConnections)
      .set({
        status: "inactive",
        updatedAt: new Date("2026-03-27T13:00:00.000Z")
      })
      .where(eq(integrationConnections.id, fixture.crmConnectionId));

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/n8n/crm-deliveries",
      headers: {
        [N8N_CALLBACK_SECRET_HEADER]: CRM_CALLBACK_SECRET
      },
      payload: {
        officeId: fixture.officeId,
        connectionId: fixture.crmConnectionId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        eventType: "call_summary_ready",
        deliveryStatus: "failed",
        workflowRunId: "n8n-crm-run-deactivated",
        note: "Original CRM connection was deactivated before callback delivery."
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.received, true);
    assert.equal(response.json().data.connectionId, fixture.crmConnectionId);

    const [auditEvent] = await db
      .select({
        actorId: auditEvents.actorId,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "crm_delivery_result_recorded")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(auditEvent?.actorId, "n8n-crm-run-deactivated");
    assert.deepEqual(auditEvent?.payload, {
      connectionId: fixture.crmConnectionId,
      kind: "crm_webhook",
      entityType: "call_log",
      entityId: fixture.callLogId,
      eventType: "call_summary_ready",
      deliveryStatus: "failed",
      externalRecordId: null,
      note: "Original CRM connection was deactivated before callback delivery."
    });
  } finally {
    await app.close();
    await cleanupFixture(fixture);
  }
});
