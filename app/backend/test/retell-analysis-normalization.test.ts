import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { and, desc, eq, inArray } from "drizzle-orm";
import { sign } from "retell-sdk";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5433/ai_ses";
process.env.RETELL_WEBHOOK_SECRET ??= "retell-test-secret";

const { createApp } = await import("../src/app.js");

import { db } from "../src/db/client.js";
import {
  auditEvents,
  callLogs,
  integrationConnections,
  offices,
  tenants
} from "../src/db/schema/index.js";
import { createIntegrationsRepository } from "../src/modules/integrations/repository.js";
import { createIntegrationsService } from "../src/modules/integrations/service.js";
import { normalizeRetellLeadQualification } from "../src/modules/retell/post-call-analysis.js";

const RETELL_SECRET = process.env.RETELL_WEBHOOK_SECRET ?? "retell-test-secret";

async function insertRetellAnalysisFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const crmConnectionId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Retell Analysis Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Retell Analysis Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(integrationConnections).values({
    id: crmConnectionId,
    officeId,
    kind: "crm_webhook",
    status: "active",
    config: {
      workflowSlug: "ai-ses-crm-sync",
      triggerPath: "/webhook/ai-ses-crm-sync"
    }
  });

  return { tenantId, officeId, crmConnectionId };
}

async function cleanupRetellAnalysisFixture(input: {
  tenantId: string;
  officeId: string;
}) {
  await db.delete(auditEvents).where(eq(auditEvents.officeId, input.officeId));
  await db.delete(callLogs).where(eq(callLogs.officeId, input.officeId));
  await db
    .delete(integrationConnections)
    .where(eq(integrationConnections.officeId, input.officeId));
  await db.delete(offices).where(eq(offices.id, input.officeId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}

test("normalizeRetellLeadQualification accepts nested custom analysis data and canonicalizes values", () => {
  const normalized = normalizeRetellLeadQualification({
    leadTemperature: "Warm",
    custom_analysis_data: {
      lead_intent: "showing request",
      handoff_recommended: "yes",
      budget_known: true,
      location_known: "unknown",
      timeline_known: 1
    }
  });

  assert.deepEqual(normalized, {
    leadIntent: "showing_request",
    leadTemperature: "warm",
    handoffRecommended: true,
    budgetKnown: true,
    locationKnown: false,
    timelineKnown: true
  });
});

test("default retell webhook wiring persists normalized lead qualification fields from call_analyzed", async () => {
  const fixture = await insertRetellAnalysisFixture();
  const callId = `retell-analysis-${randomUUID()}`;
  const app = await createApp({
    readyCheck: async () => undefined
  });

  try {
    const payload = {
      event_type: "call_analyzed",
      call: {
        call_id: callId,
        call_status: "ended",
        direction: "inbound",
        metadata: {
          office_id: fixture.officeId
        },
        call_analysis: {
          call_summary: "Caller wants to visit a property this weekend.",
          custom_analysis_data: {
            lead_intent: "showing_request",
            lead_temperature: "hot",
            handoff_recommended: true,
            budget_known: true,
            location_known: true,
            timeline_known: false
          }
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
    assert.equal(response.json().data.officeId, fixture.officeId);

    const [callLog] = await db
      .select({
        id: callLogs.id,
        summary: callLogs.summary,
        leadIntent: callLogs.leadIntent,
        leadTemperature: callLogs.leadTemperature,
        handoffRecommended: callLogs.handoffRecommended,
        budgetKnown: callLogs.budgetKnown,
        locationKnown: callLogs.locationKnown,
        timelineKnown: callLogs.timelineKnown
      })
      .from(callLogs)
      .where(eq(callLogs.providerCallId, callId))
      .limit(1);

    assert.equal(callLog?.summary, "Caller wants to visit a property this weekend.");
    assert.equal(callLog?.leadIntent, "showing_request");
    assert.equal(callLog?.leadTemperature, "hot");
    assert.equal(callLog?.handoffRecommended, true);
    assert.equal(callLog?.budgetKnown, true);
    assert.equal(callLog?.locationKnown, true);
    assert.equal(callLog?.timelineKnown, false);

    const [auditEvent] = await db
      .select({
        action: auditEvents.action,
        payload: auditEvents.payload
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.officeId, fixture.officeId),
          eq(auditEvents.action, "retell.webhook.call_analyzed")
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    assert.equal(auditEvent?.action, "retell.webhook.call_analyzed");
    assert.deepEqual(
      (auditEvent?.payload as { normalizedLeadQualification?: unknown })
        ?.normalizedLeadQualification,
      {
        leadIntent: "showing_request",
        leadTemperature: "hot",
        handoffRecommended: true,
        budgetKnown: true,
        locationKnown: true,
        timelineKnown: false
      }
    );

  const crmContract = await createIntegrationsService({
    repository: createIntegrationsRepository(db)
  }).getCrmWebhookContract({
      officeId: fixture.officeId,
      entityType: "call_log",
      entityId: callLog!.id,
      eventType: "call_summary_ready"
    });

    assert.equal(crmContract.entity.entityType, "call_log");
    assert.equal(crmContract.entity.leadIntent, "showing_request");
    assert.equal(crmContract.entity.leadTemperature, "hot");
    assert.equal(crmContract.entity.handoffRecommended, true);
    assert.equal(crmContract.entity.budgetKnown, true);
    assert.equal(crmContract.entity.locationKnown, true);
    assert.equal(crmContract.entity.timelineKnown, false);
  } finally {
    await cleanupRetellAnalysisFixture(fixture);
  }
});
