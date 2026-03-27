import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { db } from "../src/db/client.js";
import { auditEvents, offices } from "../src/db/schema/index.js";
import {
  cleanupLocalDemoData,
  cleanupLocalDemoDataWithoutLock,
  LOCAL_DEMO_CONNECTION_CONFIGS,
  LOCAL_DEMO_IDS,
  seedLocalDemoData,
  seedLocalDemoDataWithoutLock,
  withLocalDemoDataLock
} from "../scripts/seed-local-demo.js";
import {
  fetchChainedLocalDemoEvidence,
  prepareChainedLocalDemoState,
  resetChainedLocalDemoState
} from "./helpers/local-demo-chain.js";

async function demoOfficeExists() {
  const [office] = await db
    .select({ id: offices.id })
    .from(offices)
    .where(eq(offices.id, LOCAL_DEMO_IDS.officeId))
    .limit(1);

  return office !== undefined;
}

test("chained local demo support prepares and restores the seeded verification baseline", async () => {
  await withLocalDemoDataLock(async () => {
    const hadSeedBefore = await demoOfficeExists();

    try {
      await seedLocalDemoDataWithoutLock();

      await db.insert(auditEvents).values({
        tenantId: LOCAL_DEMO_IDS.tenantId,
        officeId: LOCAL_DEMO_IDS.officeId,
        actorType: "test",
        actorId: "local-demo-chain-support",
        action: "booking_result_recorded",
        payload: {
          status: "confirmed",
          note: "Dirty state before prepare."
        }
      });

      await prepareChainedLocalDemoState(
        {
          bookingAvailabilityUrl: "http://127.0.0.1:4310/availability",
          bookingUrl: "http://127.0.0.1:4310/booking",
          crmTriggerPath: "/webhook/test-ai-ses-crm-sync",
          crmDeliveryUrl: "http://127.0.0.1:4312/crm-delivery"
        },
        { alreadyLocked: true }
      );

      const prepared = await fetchChainedLocalDemoEvidence();

      assert.equal(prepared.showingRequest?.id, LOCAL_DEMO_IDS.showingRequestId);
      assert.equal(prepared.showingRequest?.status, "pending");
      assert.deepEqual(prepared.auditRows, []);
      assert.deepEqual(prepared.bookingConnection?.config, {
        ...LOCAL_DEMO_CONNECTION_CONFIGS.booking,
        availabilityUrl: "http://127.0.0.1:4310/availability",
        bookingUrl: "http://127.0.0.1:4310/booking"
      });
      assert.deepEqual(prepared.crmConnection?.config, {
        ...LOCAL_DEMO_CONNECTION_CONFIGS.crm,
        triggerPath: "/webhook/test-ai-ses-crm-sync",
        deliveryUrl: "http://127.0.0.1:4312/crm-delivery"
      });

      await db.insert(auditEvents).values([
        {
          tenantId: LOCAL_DEMO_IDS.tenantId,
          officeId: LOCAL_DEMO_IDS.officeId,
          actorType: "n8n",
          actorId: "booking-run-1",
          action: "booking_result_recorded",
          payload: {
            status: "confirmed",
            note: "Chain booking completed."
          }
        },
        {
          tenantId: LOCAL_DEMO_IDS.tenantId,
          officeId: LOCAL_DEMO_IDS.officeId,
          actorType: "n8n",
          actorId: "crm-run-1",
          action: "crm_delivery_result_recorded",
          payload: {
            deliveryStatus: "delivered",
            eventType: "showing_booking_confirmed",
            entityType: "showing_request",
            entityId: LOCAL_DEMO_IDS.showingRequestId,
            note: "Chain CRM delivery completed."
          }
        }
      ]);

      await resetChainedLocalDemoState({ alreadyLocked: true });

      const reset = await fetchChainedLocalDemoEvidence();

      assert.equal(reset.showingRequest?.status, "pending");
      assert.deepEqual(reset.auditRows, []);
      assert.deepEqual(
        reset.bookingConnection?.config,
        LOCAL_DEMO_CONNECTION_CONFIGS.booking
      );
      assert.deepEqual(
        reset.crmConnection?.config,
        LOCAL_DEMO_CONNECTION_CONFIGS.crm
      );
    } finally {
      if (hadSeedBefore) {
        await resetChainedLocalDemoState({ alreadyLocked: true });
        await seedLocalDemoDataWithoutLock();
      } else {
        await cleanupLocalDemoDataWithoutLock();
      }
    }
  });
});
