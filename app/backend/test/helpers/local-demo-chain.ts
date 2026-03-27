import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../../src/db/client.js";
import {
  auditEvents,
  integrationConnections,
  showingRequests
} from "../../src/db/schema/index.js";
import {
  LOCAL_DEMO_CONNECTION_CONFIGS,
  LOCAL_DEMO_IDS,
  seedLocalDemoDataWithoutLock,
  withLocalDemoDataLock
} from "../../scripts/seed-local-demo.js";

type ChainedLocalDemoOptions = {
  bookingAvailabilityUrl: string;
  bookingUrl: string;
  crmTriggerPath: string;
  crmDeliveryUrl: string;
};

type LocalDemoLockOptions = {
  alreadyLocked?: boolean;
};

type AuditEvidenceRow = {
  action: string;
  status: string | null;
  note: string | null;
  entityType: string | null;
  entityId: string | null;
  eventType: string | null;
  externalRecordId: string | null;
};

export async function prepareChainedLocalDemoState(
  options: ChainedLocalDemoOptions,
  lockOptions?: LocalDemoLockOptions
) {
  const run = async () => {
    await seedLocalDemoDataWithoutLock();

    await db.transaction(async (tx) => {
      await tx
        .delete(auditEvents)
        .where(eq(auditEvents.officeId, LOCAL_DEMO_IDS.officeId));

      await tx
        .update(showingRequests)
        .set({
          status: "pending",
          preferredDatetime: new Date("2026-03-27T11:00:00.000Z")
        })
        .where(eq(showingRequests.id, LOCAL_DEMO_IDS.showingRequestId));

      await tx
        .update(integrationConnections)
        .set({
          status: "active",
          config: {
            ...LOCAL_DEMO_CONNECTION_CONFIGS.booking,
            availabilityUrl: options.bookingAvailabilityUrl,
            bookingUrl: options.bookingUrl
          }
        })
        .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.bookingConnectionId));

      await tx
        .update(integrationConnections)
        .set({
          status: "active",
          config: {
            ...LOCAL_DEMO_CONNECTION_CONFIGS.crm,
            triggerPath: options.crmTriggerPath,
            deliveryUrl: options.crmDeliveryUrl
          }
        })
        .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.crmConnectionId));
    });
  };

  if (lockOptions?.alreadyLocked) {
    await run();
    return;
  }

  await withLocalDemoDataLock(run);

  return {
    officeId: LOCAL_DEMO_IDS.officeId,
    showingRequestId: LOCAL_DEMO_IDS.showingRequestId,
    callLogId: LOCAL_DEMO_IDS.callLogId,
    bookingConnectionId: LOCAL_DEMO_IDS.bookingConnectionId,
    crmConnectionId: LOCAL_DEMO_IDS.crmConnectionId
  };
}

export async function resetChainedLocalDemoState(lockOptions?: LocalDemoLockOptions) {
  const run = async () => {
    await db.transaction(async (tx) => {
      await tx
        .delete(auditEvents)
        .where(eq(auditEvents.officeId, LOCAL_DEMO_IDS.officeId));

      await tx
        .update(showingRequests)
        .set({
          status: "pending",
          preferredDatetime: new Date("2026-03-27T11:00:00.000Z")
        })
        .where(eq(showingRequests.id, LOCAL_DEMO_IDS.showingRequestId));

      await tx
        .update(integrationConnections)
        .set({
          status: "active",
          config: LOCAL_DEMO_CONNECTION_CONFIGS.booking
        })
        .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.bookingConnectionId));

      await tx
        .update(integrationConnections)
        .set({
          status: "active",
          config: LOCAL_DEMO_CONNECTION_CONFIGS.crm
        })
        .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.crmConnectionId));
    });
  };

  if (lockOptions?.alreadyLocked) {
    await run();
    return;
  }

  await withLocalDemoDataLock(run);
}

export async function fetchChainedLocalDemoEvidence() {
  const [showingRequest] = await db
    .select({
      id: showingRequests.id,
      status: showingRequests.status
    })
    .from(showingRequests)
    .where(eq(showingRequests.id, LOCAL_DEMO_IDS.showingRequestId))
    .limit(1);

  const [bookingConnection] = await db
    .select({
      id: integrationConnections.id,
      status: integrationConnections.status,
      config: integrationConnections.config
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.bookingConnectionId))
    .limit(1);

  const [crmConnection] = await db
    .select({
      id: integrationConnections.id,
      status: integrationConnections.status,
      config: integrationConnections.config
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, LOCAL_DEMO_IDS.crmConnectionId))
    .limit(1);

  const auditRows = await db
    .select({
      action: auditEvents.action,
      payload: auditEvents.payload
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.officeId, LOCAL_DEMO_IDS.officeId),
        eq(auditEvents.actorType, "n8n")
      )
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

  const normalizedAuditRows: AuditEvidenceRow[] = auditRows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    return {
      action: row.action,
      status: typeof payload.status === "string" ? payload.status : null,
      note: typeof payload.note === "string" ? payload.note : null,
      entityType:
        typeof payload.entityType === "string" ? payload.entityType : null,
      entityId: typeof payload.entityId === "string" ? payload.entityId : null,
      eventType: typeof payload.eventType === "string" ? payload.eventType : null,
      externalRecordId:
        typeof payload.externalRecordId === "string"
          ? payload.externalRecordId
          : null
    };
  });

  return {
    showingRequest,
    bookingConnection,
    crmConnection,
    auditRows: normalizedAuditRows
  };
}
