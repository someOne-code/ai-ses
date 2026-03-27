import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import {
  auditEvents,
  callLogs,
  offices,
  phoneNumberMappings
} from "../../db/schema/index.js";

export interface ResolvedOfficeContext {
  officeId: string;
  tenantId: string;
}

export interface UpsertCallLogInput {
  officeId: string;
  providerCallId: string;
  direction: string;
  status: string;
  summary?: string | null | undefined;
  leadIntent?: string | null | undefined;
  leadTemperature?: string | null | undefined;
  handoffRecommended?: boolean | null | undefined;
  budgetKnown?: boolean | null | undefined;
  locationKnown?: boolean | null | undefined;
  timelineKnown?: boolean | null | undefined;
  payload?: unknown;
  startedAt?: Date | undefined;
  endedAt?: Date | undefined;
}

export interface CreateAuditEventInput {
  tenantId?: string | null;
  officeId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  payload?: unknown;
}

export function createRetellRepository(db: Database) {
  return {
    async findOfficeContextById(
      officeId: string
    ): Promise<ResolvedOfficeContext | null> {
      const [office] = await db
        .select({
          officeId: offices.id,
          tenantId: offices.tenantId
        })
        .from(offices)
        .where(and(eq(offices.id, officeId), eq(offices.status, "active")))
        .limit(1);

      return office ?? null;
    },

    async findOfficeContextByPhoneNumbers(
      phoneNumbers: string[]
    ): Promise<ResolvedOfficeContext | null> {
      if (phoneNumbers.length === 0) {
        return null;
      }

      const [match] = await db
        .select({
          officeId: offices.id,
          tenantId: offices.tenantId
        })
        .from(phoneNumberMappings)
        .innerJoin(offices, eq(phoneNumberMappings.officeId, offices.id))
        .where(
          and(
            eq(phoneNumberMappings.provider, "retell"),
            eq(phoneNumberMappings.status, "active"),
            eq(offices.status, "active"),
            inArray(phoneNumberMappings.phoneNumber, phoneNumbers)
          )
        )
        .limit(1);

      return match ?? null;
    },

    async findCallLogByProviderCallId(providerCallId: string) {
      const [callLog] = await db
        .select({
          id: callLogs.id
        })
        .from(callLogs)
        .where(eq(callLogs.providerCallId, providerCallId))
        .limit(1);

      return callLog ?? null;
    },

    async createCallLog(input: UpsertCallLogInput) {
      await db.insert(callLogs).values({
        officeId: input.officeId,
        providerCallId: input.providerCallId,
        direction: input.direction,
        status: input.status,
        summary: input.summary ?? null,
        leadIntent: input.leadIntent ?? null,
        leadTemperature: input.leadTemperature ?? null,
        handoffRecommended: input.handoffRecommended ?? null,
        budgetKnown: input.budgetKnown ?? null,
        locationKnown: input.locationKnown ?? null,
        timelineKnown: input.timelineKnown ?? null,
        payload: input.payload,
        startedAt: input.startedAt,
        endedAt: input.endedAt
      });
    },

    async updateCallLog(callLogId: string, input: UpsertCallLogInput) {
      await db
        .update(callLogs)
        .set({
          direction: input.direction,
          status: input.status,
          summary: input.summary ?? null,
          leadIntent: input.leadIntent ?? null,
          leadTemperature: input.leadTemperature ?? null,
          handoffRecommended: input.handoffRecommended ?? null,
          budgetKnown: input.budgetKnown ?? null,
          locationKnown: input.locationKnown ?? null,
          timelineKnown: input.timelineKnown ?? null,
          payload: input.payload,
          startedAt: input.startedAt,
          endedAt: input.endedAt
        })
        .where(eq(callLogs.id, callLogId));
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
    }
  };
}

export type RetellRepository = ReturnType<typeof createRetellRepository>;
