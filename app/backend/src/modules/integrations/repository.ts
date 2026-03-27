import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import {
  auditEvents,
  callLogs,
  integrationConnections,
  listings,
  offices,
  showingRequests
} from "../../db/schema/index.js";

export interface CreateAuditEventInput {
  tenantId?: string | null;
  officeId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  payload?: unknown;
}

export interface FindAuditEventByActorInput {
  officeId: string;
  actorType: string;
  actorId: string;
  action: string;
}

export interface ClaimBookingCallbackMutationInput {
  tenantId: string;
  officeId: string;
  showingRequestId: string;
  workflowRunId: string;
  status: string;
  payload: unknown;
}

export function createIntegrationsRepository(db: Database) {
  return {
    async findOfficeContextById(officeId: string) {
      const [office] = await db
        .select({
          officeId: offices.id,
          tenantId: offices.tenantId,
          officeName: offices.name,
          officeTimezone: offices.timezone
        })
        .from(offices)
        .where(and(eq(offices.id, officeId), eq(offices.status, "active")))
        .limit(1);

      return office ?? null;
    },

    async findActiveConnectionByKind(officeId: string, kind: string) {
      const connections = await db
        .select({
          id: integrationConnections.id,
          officeId: integrationConnections.officeId,
          kind: integrationConnections.kind,
          status: integrationConnections.status,
          config: integrationConnections.config
        })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.officeId, officeId),
            eq(integrationConnections.kind, kind),
            eq(integrationConnections.status, "active")
          )
        )
        .orderBy(
          desc(integrationConnections.updatedAt),
          desc(integrationConnections.createdAt)
        )
        .limit(2);

      return connections;
    },

    async findConnectionById(
      officeId: string,
      kind: string,
      connectionId: string
    ) {
      const [connection] = await db
        .select({
          id: integrationConnections.id,
          officeId: integrationConnections.officeId,
          kind: integrationConnections.kind,
          status: integrationConnections.status,
          config: integrationConnections.config
        })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.id, connectionId),
            eq(integrationConnections.officeId, officeId),
            eq(integrationConnections.kind, kind)
          )
        )
        .limit(1);

      return connection ?? null;
    },

    async findShowingRequestById(officeId: string, showingRequestId: string) {
      const [showingRequest] = await db
        .select({
          id: showingRequests.id,
          officeId: showingRequests.officeId,
          tenantId: offices.tenantId,
          officeName: offices.name,
          officeTimezone: offices.timezone,
          listingId: showingRequests.listingId,
          listingReferenceCode: listings.referenceCode,
          listingTitle: listings.title,
          listingType: listings.listingType,
          propertyType: listings.propertyType,
          customerName: showingRequests.customerName,
          customerPhone: showingRequests.customerPhone,
          customerEmail: showingRequests.customerEmail,
          preferredDatetime: showingRequests.preferredDatetime,
          status: showingRequests.status,
          createdAt: showingRequests.createdAt
        })
        .from(showingRequests)
        .innerJoin(offices, eq(showingRequests.officeId, offices.id))
        .innerJoin(listings, eq(showingRequests.listingId, listings.id))
        .where(
          and(
            eq(showingRequests.officeId, officeId),
            eq(showingRequests.id, showingRequestId)
          )
        )
        .limit(1);

      return showingRequest ?? null;
    },

    async updateShowingRequestStatus(
      officeId: string,
      showingRequestId: string,
      status: string
    ) {
      const [showingRequest] = await db
        .update(showingRequests)
        .set({ status })
        .where(
          and(
            eq(showingRequests.officeId, officeId),
            eq(showingRequests.id, showingRequestId)
          )
        )
        .returning({
          id: showingRequests.id,
          officeId: showingRequests.officeId,
          status: showingRequests.status
        });

      return showingRequest ?? null;
    },

    async findCallLogById(officeId: string, callLogId: string) {
      const [callLog] = await db
        .select({
          id: callLogs.id,
          officeId: callLogs.officeId,
          tenantId: offices.tenantId,
          officeName: offices.name,
          officeTimezone: offices.timezone,
          providerCallId: callLogs.providerCallId,
          direction: callLogs.direction,
          status: callLogs.status,
          summary: callLogs.summary,
          leadIntent: callLogs.leadIntent,
          leadTemperature: callLogs.leadTemperature,
          handoffRecommended: callLogs.handoffRecommended,
          budgetKnown: callLogs.budgetKnown,
          locationKnown: callLogs.locationKnown,
          timelineKnown: callLogs.timelineKnown,
          startedAt: callLogs.startedAt,
          endedAt: callLogs.endedAt,
          createdAt: callLogs.createdAt
        })
        .from(callLogs)
        .innerJoin(offices, eq(callLogs.officeId, offices.id))
        .where(and(eq(callLogs.officeId, officeId), eq(callLogs.id, callLogId)))
        .limit(1);

      return callLog ?? null;
    },

    async findAuditEventByActor(input: FindAuditEventByActorInput) {
      const [auditEvent] = await db
        .select({
          id: auditEvents.id,
          officeId: auditEvents.officeId,
          actorType: auditEvents.actorType,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          payload: auditEvents.payload,
          createdAt: auditEvents.createdAt
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.officeId, input.officeId),
            eq(auditEvents.actorType, input.actorType),
            eq(auditEvents.actorId, input.actorId),
            eq(auditEvents.action, input.action)
          )
        )
        .orderBy(desc(auditEvents.createdAt))
        .limit(1);

      return auditEvent ?? null;
    },

    async createAuditEvent(input: CreateAuditEventInput) {
      await db.insert(auditEvents).values({
        tenantId: input.tenantId ?? null,
        officeId: input.officeId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        payload: input.payload
      });
    },

    async createAuditEventIfAbsent(input: CreateAuditEventInput) {
      const [auditEvent] = await db
        .insert(auditEvents)
        .values({
          tenantId: input.tenantId ?? null,
          officeId: input.officeId ?? null,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          payload: input.payload
        })
        .onConflictDoNothing()
        .returning({
          id: auditEvents.id
        });

      return auditEvent ?? null;
    },

    async claimBookingCallbackRunAndUpdateShowingRequest(
      input: ClaimBookingCallbackMutationInput
    ) {
      return db.transaction(async (tx) => {
        const [auditEvent] = await tx
          .insert(auditEvents)
          .values({
            tenantId: input.tenantId,
            officeId: input.officeId,
            actorType: "n8n",
            actorId: input.workflowRunId,
            action: "booking_result_recorded",
            payload: input.payload
          })
          .onConflictDoNothing()
          .returning({
            id: auditEvents.id
          });

        if (!auditEvent) {
          const [recordedEvent] = await tx
            .select({
              payload: auditEvents.payload
            })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.officeId, input.officeId),
                eq(auditEvents.actorType, "n8n"),
                eq(auditEvents.actorId, input.workflowRunId),
                eq(auditEvents.action, "booking_result_recorded")
              )
            )
            .orderBy(desc(auditEvents.createdAt))
            .limit(1);

          return {
            inserted: false as const,
            recordedPayload: recordedEvent?.payload ?? null
          };
        }

        const [showingRequest] = await tx
          .update(showingRequests)
          .set({ status: input.status })
          .where(
            and(
              eq(showingRequests.officeId, input.officeId),
              eq(showingRequests.id, input.showingRequestId)
            )
          )
          .returning({
            id: showingRequests.id,
            officeId: showingRequests.officeId,
            status: showingRequests.status
          });

        if (!showingRequest) {
          throw new Error(
            "Failed to update showing request after claiming booking callback workflow run."
          );
        }

        return {
          inserted: true as const,
          showingRequest
        };
      });
    }
  };
}

export type IntegrationsRepository = ReturnType<
  typeof createIntegrationsRepository
>;
