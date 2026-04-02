import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import {
  auditEvents,
  callLogs,
  offices,
  phoneNumberMappings
} from "../../db/schema/index.js";
import type { ListingSearchState } from "../listings/types.js";

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

interface CallLogLookup {
  id: string;
  payload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSearchOutcome(
  value: unknown
): value is ListingSearchState["lastSearchOutcome"] {
  return (
    value === "success" ||
    value === "no_match" ||
    value === "exhausted_results" ||
    value === "none"
  );
}

function isAnchorTerm(value: unknown): value is { canonical: string; raw: string } {
  const record = asRecord(value);

  return (
    record !== null &&
    typeof record.canonical === "string" &&
    typeof record.raw === "string"
  );
}

function parseStructuredCriteria(
  value: unknown
): ListingSearchState["activeStructuredCriteria"] | null {
  const source = asRecord(value);

  if (!source) {
    return null;
  }

  const criteria: ListingSearchState["activeStructuredCriteria"] = {};
  const stringFields = [
    "district",
    "neighborhood",
    "listingType",
    "propertyType"
  ] as const;
  const numericFields = [
    "minPrice",
    "maxPrice",
    "minBedrooms",
    "minBathrooms",
    "minNetM2",
    "maxNetM2"
  ] as const;

  for (const field of stringFields) {
    const rawValue = source[field];

    if (rawValue === undefined) {
      continue;
    }

    if (typeof rawValue !== "string") {
      return null;
    }

    criteria[field] = rawValue;
  }

  for (const field of numericFields) {
    const rawValue = source[field];

    if (rawValue === undefined) {
      continue;
    }

    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      return null;
    }

    criteria[field] = rawValue;
  }

  return criteria;
}

function parseSelectedListingFacts(
  value: unknown
): ListingSearchState["selectedListingFactsForContext"] | null {
  if (value === null) {
    return null;
  }

  const source = asRecord(value);

  if (!source) {
    return null;
  }

  const facts: NonNullable<ListingSearchState["selectedListingFactsForContext"]> = {};
  const fields = ["listingType", "district", "neighborhood"] as const;

  for (const field of fields) {
    const rawValue = source[field];

    if (rawValue === undefined) {
      continue;
    }

    if (typeof rawValue !== "string") {
      return null;
    }

    facts[field] = rawValue;
  }

  return facts;
}

function parseListingSearchState(value: unknown): ListingSearchState | null {
  const source = asRecord(value);

  if (!source) {
    return null;
  }

  const activeStructuredCriteria = parseStructuredCriteria(
    source.activeStructuredCriteria
  );

  if (!activeStructuredCriteria) {
    return null;
  }

  if (
    source.activeSemanticIntent !== null &&
    typeof source.activeSemanticIntent !== "string"
  ) {
    return null;
  }

  if (
    !Array.isArray(source.activeMustAnchorTerms) ||
    !source.activeMustAnchorTerms.every(isAnchorTerm)
  ) {
    return null;
  }

  if (
    !Array.isArray(source.activeNegatedTerms) ||
    !source.activeNegatedTerms.every(isAnchorTerm)
  ) {
    return null;
  }

  if (!isSearchOutcome(source.lastSearchOutcome)) {
    return null;
  }

  if (
    source.lastUserSearchText !== null &&
    typeof source.lastUserSearchText !== "string"
  ) {
    return null;
  }

  if (
    source.selectedListingReferenceCode !== null &&
    typeof source.selectedListingReferenceCode !== "string"
  ) {
    return null;
  }

  const selectedListingFactsForContext = parseSelectedListingFacts(
    source.selectedListingFactsForContext
  );

  if (
    source.selectedListingFactsForContext !== null &&
    selectedListingFactsForContext === null
  ) {
    return null;
  }

  if (
    !Array.isArray(source.viewedListingIds) ||
    !source.viewedListingIds.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  if (typeof source.updatedAt !== "string") {
    return null;
  }

  return {
    activeStructuredCriteria,
    activeSemanticIntent: source.activeSemanticIntent,
    activeMustAnchorTerms: source.activeMustAnchorTerms,
    activeNegatedTerms: source.activeNegatedTerms,
    lastSearchOutcome: source.lastSearchOutcome,
    lastUserSearchText: source.lastUserSearchText,
    selectedListingReferenceCode: source.selectedListingReferenceCode,
    selectedListingFactsForContext,
    viewedListingIds: source.viewedListingIds,
    updatedAt: source.updatedAt
  };
}

function mergePayloadWithSearchState(
  payload: unknown,
  searchState: ListingSearchState
): Record<string, unknown> {
  const payloadRecord = asRecord(payload);
  const mergedPayload = payloadRecord ? { ...payloadRecord } : {};
  mergedPayload.searchState = searchState;

  return mergedPayload;
}

function preserveSearchStateAcrossWebhookPayload(
  previousPayload: unknown,
  nextPayload: unknown
): unknown {
  const nextPayloadRecord = asRecord(nextPayload);

  if (!nextPayloadRecord) {
    return nextPayload;
  }

  const previousPayloadRecord = asRecord(previousPayload);

  if (
    previousPayloadRecord &&
    previousPayloadRecord.searchState !== undefined &&
    nextPayloadRecord.searchState === undefined
  ) {
    return {
      ...nextPayloadRecord,
      searchState: previousPayloadRecord.searchState
    };
  }

  return nextPayload;
}

export interface RetellRepository {
  findOfficeContextById(
    officeId: string
  ): Promise<ResolvedOfficeContext | null>;
  findOfficeContextByPhoneNumbers(
    phoneNumbers: string[]
  ): Promise<ResolvedOfficeContext | null>;
  findCallLogByProviderCallId(
    providerCallId: string
  ): Promise<CallLogLookup | null>;
  createCallLog(input: UpsertCallLogInput): Promise<void>;
  updateCallLog(callLogId: string, input: UpsertCallLogInput): Promise<void>;
  createAuditEvent(input: CreateAuditEventInput): Promise<void>;
  findCallSearchState?: (
    providerCallId: string
  ) => Promise<ListingSearchState | null>;
  updateCallSearchState?: (
    providerCallId: string,
    nextState: ListingSearchState
  ) => Promise<ListingSearchState | null>;
  clearSelectedListingContext?: (
    providerCallId: string
  ) => Promise<ListingSearchState | null>;
}

export function createRetellRepository(db: Database): RetellRepository {
  async function findCallLogByProviderCallId(
    providerCallId: string
  ): Promise<CallLogLookup | null> {
    const [callLog] = await db
      .select({
        id: callLogs.id,
        payload: callLogs.payload
      })
      .from(callLogs)
      .where(eq(callLogs.providerCallId, providerCallId))
      .limit(1);

    return callLog ?? null;
  }

  const repository: RetellRepository = {
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

    findCallLogByProviderCallId,

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
      const [existingCallLog] = await db
        .select({
          payload: callLogs.payload
        })
        .from(callLogs)
        .where(eq(callLogs.id, callLogId))
        .limit(1);

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
          payload: preserveSearchStateAcrossWebhookPayload(
            existingCallLog?.payload,
            input.payload
          ),
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
    },

    async findCallSearchState(
      providerCallId: string
    ): Promise<ListingSearchState | null> {
      const callLog = await findCallLogByProviderCallId(providerCallId);
      const payload = asRecord(callLog?.payload);

      if (!payload) {
        return null;
      }

      return parseListingSearchState(payload.searchState);
    },

    async updateCallSearchState(
      providerCallId: string,
      nextState: ListingSearchState
    ): Promise<ListingSearchState | null> {
      const callLog = await findCallLogByProviderCallId(providerCallId);

      if (!callLog) {
        return null;
      }

      await db
        .update(callLogs)
        .set({
          payload: mergePayloadWithSearchState(callLog.payload, nextState)
        })
        .where(eq(callLogs.id, callLog.id));

      return nextState;
    },

    async clearSelectedListingContext(
      providerCallId: string
    ): Promise<ListingSearchState | null> {
      const currentState = await repository.findCallSearchState?.(providerCallId);

      if (!currentState) {
        return null;
      }

      const clearedState: ListingSearchState = {
        ...currentState,
        selectedListingReferenceCode: null,
        selectedListingFactsForContext: null,
        updatedAt: new Date().toISOString()
      };

      await repository.updateCallSearchState?.(providerCallId, clearedState);

      return clearedState;
    }
  };

  return repository;
}
