import { verify } from "retell-sdk";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import {
  parseTurkishMobilePhoneCandidate,
  type PhoneParseConfidence
} from "../../lib/phone-parser.js";
import { buildListingSpeechPresentation } from "../listings/speech.js";
import {
  createInitialListingSearchState,
  type ListingsService
} from "../listings/service.js";
import type {
  ListingSearchMatchInterpretation,
  ListingSearchOutcome,
  ListingSearchState,
  ListingSelectedContextFacts
} from "../listings/types.js";
import type { ShowingRequestsService } from "../showing-requests/service.js";
import { normalizeRetellLeadQualification } from "./post-call-analysis.js";
import { getCanonicalRetellRepair } from "./repair-messages.js";
import type {
  ResolvedOfficeContext,
  RetellRepository
} from "./repository.js";
import {
  parseCreateShowingRequestToolArgs,
  parseGetListingByReferenceToolArgs,
  parseRetellToolRequest,
  parseRetellWebhookPayload,
  parseSearchListingsToolArgs,
  retellToolContracts,
  type RetellCall,
  type RetellToolFailure,
  type RetellToolResult,
  type RetellWebhookPayload,
  type RetellWebhookReceipt
} from "./types.js";

interface RetellServiceOptions {
  repository: RetellRepository;
  listingsService: ListingsService;
  showingRequestsService: ShowingRequestsService;
  webhookSecret?: string;
}

interface RetellSignedRequestInput {
  signature: string | undefined;
  body: unknown;
  rawBody: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getStringProperty(
  source: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function buildPhoneNumberCandidates(
  ...values: Array<string | undefined>
): string[] {
  const candidates = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    const trimmed = value.trim();

    if (trimmed === "") {
      continue;
    }

    candidates.add(trimmed);

    const digitsOnly = trimmed.replace(/[^\d]/g, "");

    if (digitsOnly === "") {
      continue;
    }

    candidates.add(digitsOnly);
    candidates.add(`+${digitsOnly}`);
  }

  return Array.from(candidates);
}

function toOptionalDate(timestamp: number | null | undefined): Date | undefined {
  return typeof timestamp === "number" ? new Date(timestamp) : undefined;
}

function getCallSummary(call: RetellCall): string | null {
  const callAnalysis = asRecord(call.call_analysis);

  return getStringProperty(callAnalysis, "call_summary", "summary");
}

type PhoneConfirmationState = "confirmed" | "unconfirmed" | "not_provided";

interface PhoneParseAuditSummary {
  digitCount: number;
  parseConfidence: PhoneParseConfidence;
  confirmationState: PhoneConfirmationState;
  normalized: boolean;
}

function toPhoneConfirmationState(value: unknown): PhoneConfirmationState {
  if (value === true) {
    return "confirmed";
  }

  if (value === false) {
    return "unconfirmed";
  }

  return "not_provided";
}

function buildPhoneParseAuditSummary(
  args: Record<string, unknown>
): PhoneParseAuditSummary {
  const parsedPhone = parseTurkishMobilePhoneCandidate(
    typeof args.customerPhone === "string" ? args.customerPhone : null
  );

  return {
    digitCount: parsedPhone.digitCount,
    parseConfidence: parsedPhone.parseConfidence,
    confirmationState: toPhoneConfirmationState(args.customerPhoneConfirmed),
    normalized: parsedPhone.e164 !== null
  };
}

function getWebhookEventName(payload: RetellWebhookPayload): string {
  return payload.event ?? payload.event_type ?? "unknown";
}

function sanitizeToolArgs(name: string, args: Record<string, unknown>) {
  if (name === "create_showing_request") {
    const phoneParse = buildPhoneParseAuditSummary(args);

    return {
      listingId: typeof args.listingId === "string" ? args.listingId : null,
      preferredTimeWindow:
        typeof args.preferredTimeWindow === "string"
          ? args.preferredTimeWindow
          : null,
      preferredDatetime:
        typeof args.preferredDatetime === "string"
          ? args.preferredDatetime
          : null,
      hasCustomerEmail: typeof args.customerEmail === "string",
      phoneParse
    };
  }

  return args;
}

function getCallerSafeFailureMessage(
  toolName: string,
  error: AppError
): string {
  switch (error.code) {
    case "OFFICE_CONTEXT_NOT_FOUND":
      return "Bu çağrıyı doğru ofis kaydıyla eşleştiremedim.";
    case "LISTING_REFERENCE_AMBIGUOUS":
      return "Referans kodunu netleştiremedim. Tam kodu bir kez daha söyleyelim.";
    case "LISTING_NOT_FOUND":
      return toolName === "search_listings"
        ? "Uygun ilan bulamadım."
        : "İlgili ilanı bulamadım.";
    case "VALIDATION_ERROR":
      return toolName === "create_showing_request"
        ? "Talebi oluşturmak için bazı bilgileri yeniden teyit etmem gerekiyor."
        : "İsteği işlerken bir bilgiyi yeniden teyit etmem gerekiyor.";
    case "RETELL_TOOL_NOT_SUPPORTED":
      return "Bu adımı şu anda tamamlayamıyorum.";
    default:
      return "Şu anda isteği tamamlayamadım. Bir kez daha deneyelim.";
  }
}

function buildApproximationNotice(
  matchInterpretation: ListingSearchMatchInterpretation,
  count: number
): string | null {
  if (matchInterpretation !== "hybrid_candidate" || count === 0) {
    return null;
  }

  return "Bu sonuclar, anlattiginiz serbest kritere gore yaklasik adaylar.";
}

function deriveSearchOutcome(input: {
  persistedSearchState: ListingSearchState | null;
  matchInterpretation: ListingSearchMatchInterpretation;
  count: number;
}): ListingSearchOutcome {
  if (input.persistedSearchState) {
    return input.persistedSearchState.lastSearchOutcome;
  }

  if (input.count > 0) {
    return "success";
  }

  if (input.matchInterpretation === "no_match") {
    return "no_match";
  }

  return "none";
}

function buildSearchOutcomeMessage(input: {
  searchOutcome: ListingSearchOutcome;
  queryText: string | undefined;
  count: number;
}): string | null {
  const hasFreeText = normalizeQueryText(input.queryText) !== null;

  if (input.searchOutcome === "exhausted_results") {
    return "Bu arama icin su an baska dogrulanmis aday kalmadi.";
  }

  if (input.searchOutcome === "no_match") {
    return hasFreeText
      ? "Bu tercih icin dogrulanmis uygun ilan bulamadim."
      : "Bu kriterlerle uygun ilan bulamadim.";
  }

  if (input.searchOutcome === "success" && input.count === 0) {
    return "Uygun ilan bulamadim.";
  }

  return null;
}

function buildSearchNextSuggestion(input: {
  searchOutcome: ListingSearchOutcome;
  queryText: string | undefined;
  hasActiveStructuredCriteria: boolean;
}): string | null {
  if (input.searchOutcome === "exhausted_results") {
    return "Isterseniz yeni bir ilce, butce veya oda sayisiyla aramayi sifirdan yenileyelim.";
  }

  if (input.searchOutcome !== "no_match") {
    return null;
  }

  if (normalizeQueryText(input.queryText)) {
    return "Isterseniz ilce, butce veya oda sayisi ekleyip aramayi netlestirelim.";
  }

  return input.hasActiveStructuredCriteria
    ? "Isterseniz butceyi veya oda sayisini biraz esnetelim."
    : "Isterseniz ilce veya butceyle aramayi daraltalim.";
}

function normalizeQueryText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized === "" ? null : normalized;
}

function buildPersistedSearchState(input: {
  previousState: ListingSearchState | null;
  nextState: ListingSearchState | null;
  queryText: string | undefined;
  matchInterpretation: ListingSearchMatchInterpretation;
}): ListingSearchState | null {
  if (!input.nextState) {
    return null;
  }

  const normalizedQueryText = normalizeQueryText(input.queryText);

  if (
    input.matchInterpretation !== "no_match" ||
    normalizedQueryText === null
  ) {
    return input.nextState;
  }

  return {
    ...input.nextState,
    // Keep failed free-text attempts from poisoning the active semantic state.
    activeSemanticIntent: input.previousState?.activeSemanticIntent ?? null,
    activeMustAnchorTerms: input.previousState?.activeMustAnchorTerms ?? [],
    activeNegatedTerms: input.previousState?.activeNegatedTerms ?? []
  };
}

function toSelectedListingFacts(input: {
  listingType: string | null;
  district: string | null;
  neighborhood: string | null;
}): ListingSelectedContextFacts | null {
  const facts: ListingSelectedContextFacts = {};

  if (input.listingType !== null) {
    facts.listingType = input.listingType;
  }

  if (input.district !== null) {
    facts.district = input.district;
  }

  if (input.neighborhood !== null) {
    facts.neighborhood = input.neighborhood;
  }

  return Object.keys(facts).length > 0 ? facts : null;
}

function buildSelectedListingState(input: {
  previousState: ListingSearchState | null;
  listing: {
    referenceCode: string;
    listingType: string | null;
    district: string | null;
    neighborhood: string | null;
  };
}): ListingSearchState {
  const baseState =
    input.previousState ?? createInitialListingSearchState();

  return {
    ...baseState,
    selectedListingReferenceCode: input.listing.referenceCode,
    selectedListingFactsForContext: toSelectedListingFacts({
      listingType: input.listing.listingType,
      district: input.listing.district,
      neighborhood: input.listing.neighborhood
    }),
    updatedAt: new Date().toISOString()
  };
}

export function createRetellService(options: RetellServiceOptions) {
  function shouldBypassSignatureVerification(): boolean {
    const rawFlag = process.env.RETELL_SKIP_SIGNATURE_VERIFICATION;
    const isNodeTestRun =
      process.argv.some((value) => value === "--test") ||
      process.execArgv.some((value) => value === "--test");

    if (!rawFlag || isNodeTestRun) {
      return false;
    }

    return (
      process.env.NODE_ENV === "development" &&
      rawFlag !== "0" &&
      rawFlag.toLowerCase() !== "false"
    );
  }

  async function ensureVerificationKey(): Promise<string> {
    const verificationKey =
      options.webhookSecret ??
      process.env.RETELL_WEBHOOK_SECRET ??
      env.RETELL_WEBHOOK_SECRET ??
      process.env.RETELL_API_KEY ??
      env.RETELL_API_KEY;

    if (!verificationKey) {
      throw new AppError(
        "Retell verification key is not configured.",
        503,
        "RETELL_WEBHOOK_SECRET_MISSING"
      );
    }

    return verificationKey;
  }

  async function verifySignature(input: RetellSignedRequestInput) {
    if (shouldBypassSignatureVerification()) {
      return;
    }

    const verificationKey = await ensureVerificationKey();

    if (!input.signature) {
      throw new AppError(
        "Missing Retell signature.",
        401,
        "RETELL_SIGNATURE_INVALID"
      );
    }

    const isValid = await verify(
      input.rawBody,
      verificationKey,
      input.signature
    );

    if (!isValid) {
      throw new AppError(
        "Invalid Retell signature.",
        401,
        "RETELL_SIGNATURE_INVALID"
      );
    }
  }

  async function resolveOfficeContext(
    call: RetellCall
  ): Promise<ResolvedOfficeContext | null> {
    const metadata = asRecord(call.metadata);
    const dynamicVariables = asRecord(call.retell_llm_dynamic_variables);
    const officeId =
      getStringProperty(metadata, "office_id", "officeId") ??
      getStringProperty(dynamicVariables, "office_id", "officeId");

    if (officeId) {
      const officeContext = await options.repository.findOfficeContextById(officeId);

      if (officeContext) {
        return officeContext;
      }
    }

    return options.repository.findOfficeContextByPhoneNumbers(
      buildPhoneNumberCandidates(call.to_number, call.from_number)
    );
  }

  async function persistCallWebhook(
    payload: RetellWebhookPayload,
    officeContext: ResolvedOfficeContext | null
  ) {
    const call = payload.call;

    if (!call || !officeContext) {
      return;
    }

    const callLogInput = {
      officeId: officeContext.officeId,
      providerCallId: call.call_id,
      direction: call.direction ?? "inbound",
      status: call.call_status ?? getWebhookEventName(payload),
      summary: getCallSummary(call),
      ...normalizeRetellLeadQualification(call.call_analysis),
      payload,
      startedAt: toOptionalDate(call.start_timestamp),
      endedAt: toOptionalDate(call.end_timestamp)
    };

    const existing = await options.repository.findCallLogByProviderCallId(
      call.call_id
    );

    if (existing) {
      await options.repository.updateCallLog(existing.id, callLogInput);
      return;
    }

    await options.repository.createCallLog(callLogInput);
  }

  function buildToolFailure(
    toolName: string,
    error: AppError
  ): RetellToolFailure {
    const validation = getCanonicalRetellRepair(error.details);

    return {
      ok: false,
      tool: toolName,
      error: {
        code: error.code,
        message:
          error.code === "VALIDATION_ERROR"
            ? validation.callerMessage ?? getCallerSafeFailureMessage(toolName, error)
            : getCallerSafeFailureMessage(toolName, error),
        ...(validation.repairStep ? { repairStep: validation.repairStep } : {}),
        ...(validation.fieldErrors
          ? { fieldErrors: validation.fieldErrors }
          : {})
      }
    };
  }

  return {
    getToolContracts() {
      return retellToolContracts;
    },

    async handleWebhook(input: {
      signature: string | undefined;
      body: unknown;
      rawBody: string;
    }): Promise<RetellWebhookReceipt> {
      await verifySignature(input);

      const payload = parseRetellWebhookPayload(input.body);
      const officeContext = payload.call
        ? await resolveOfficeContext(payload.call)
        : null;
      const event = getWebhookEventName(payload);

      await persistCallWebhook(payload, officeContext);
      await options.repository.createAuditEvent({
        tenantId: officeContext?.tenantId ?? null,
        officeId: officeContext?.officeId ?? null,
        actorType: "retell",
        actorId: payload.call?.call_id ?? null,
        action: `retell.webhook.${event}`,
        payload: {
          event,
          callStatus: payload.call?.call_status ?? null,
          officeResolved: officeContext !== null,
          normalizedLeadQualification: payload.call
            ? normalizeRetellLeadQualification(payload.call.call_analysis)
            : null
        }
      });

      return {
        received: true,
        event,
        callId: payload.call?.call_id ?? null,
        officeId: officeContext?.officeId ?? null
      };
    },

    async executeTool(input: {
      signature: string | undefined;
      body: unknown;
      rawBody: string;
    }): Promise<RetellToolResult> {
      await verifySignature(input);

      const request = parseRetellToolRequest(input.body);
      const officeContext = await resolveOfficeContext(request.call);

      if (!officeContext) {
        const error = new AppError(
          "Office context could not be resolved for this call.",
          404,
          "OFFICE_CONTEXT_NOT_FOUND"
        );

        await options.repository.createAuditEvent({
          actorType: "retell",
          actorId: request.call.call_id,
          action: "retell.tool.failed",
          payload: {
            tool: request.name,
            success: false,
            errorCode: error.code
          }
        });

        return buildToolFailure(request.name, error);
      }

      try {
        let result: RetellToolResult;

        switch (request.name) {
          case "search_listings": {
            const args = parseSearchListingsToolArgs(request.args);
            const previousSearchState =
              (await options.repository.findCallSearchState?.(
                request.call.call_id
              )) ?? null;
            let resolvedSearchState: ListingSearchState | null = null;
            const searchExecutionContext = {
              ...(previousSearchState
                ? { searchState: previousSearchState }
                : {}),
              onSearchStateResolved(nextState: ListingSearchState) {
                resolvedSearchState = nextState;
              }
            };
            const searchResult =
              await options.listingsService.searchListingsDetailed({
                officeId: officeContext.officeId,
                ...args
              }, searchExecutionContext);
            const count = searchResult.listings.length;
            const persistedSearchState = buildPersistedSearchState({
              previousState: previousSearchState,
              nextState: resolvedSearchState,
              queryText: args.queryText,
              matchInterpretation: searchResult.matchInterpretation
            });

            if (persistedSearchState) {
              await options.repository.updateCallSearchState?.(
                request.call.call_id,
                persistedSearchState
              );
            }
            const searchOutcome = deriveSearchOutcome({
              persistedSearchState,
              matchInterpretation: searchResult.matchInterpretation,
              count
            });
            const searchOutcomeMessage = buildSearchOutcomeMessage({
              searchOutcome,
              queryText: args.queryText,
              count
            });
            const nextSuggestion = buildSearchNextSuggestion({
              searchOutcome,
              queryText: args.queryText,
              hasActiveStructuredCriteria:
                persistedSearchState
                  ? Object.keys(
                      persistedSearchState.activeStructuredCriteria
                    ).length > 0
                  : false
            });

            result = {
              ok: true,
              tool: request.name,
              data: {
                count,
                matchInterpretation: searchResult.matchInterpretation,
                searchOutcome,
                searchOutcomeMessage,
                nextSuggestion,
                approximationNotice: buildApproximationNotice(
                  searchResult.matchInterpretation,
                  count
                ),
                listings: searchResult.listings.map((listing) => ({
                  ...listing,
                  ...buildListingSpeechPresentation(listing)
                }))
              }
            };
            break;
          }

          case "get_listing_by_reference": {
            const args = parseGetListingByReferenceToolArgs(request.args);
            const listing = await options.listingsService.getListingByReference({
              officeId: officeContext.officeId,
              referenceCode: args.referenceCode
            });
            const previousSearchState =
              (await options.repository.findCallSearchState?.(
                request.call.call_id
              )) ?? null;
            const selectedListingState = buildSelectedListingState({
              previousState: previousSearchState,
              listing: {
                referenceCode: listing.referenceCode,
                listingType: listing.listingType,
                district: listing.district,
                neighborhood: listing.neighborhood
              }
            });

            await options.repository.updateCallSearchState?.(
              request.call.call_id,
              selectedListingState
            );

            result = {
              ok: true,
              tool: request.name,
              data: {
                listing: {
                  ...listing,
                  ...buildListingSpeechPresentation(listing)
                }
              }
            };
            break;
          }

          case "create_showing_request": {
            const args = parseCreateShowingRequestToolArgs(request.args);
            const showingRequest =
              await options.showingRequestsService.createShowingRequest({
                officeId: officeContext.officeId,
                ...args
              });

            result = {
              ok: true,
              tool: request.name,
              data: {
                showingRequest
              }
            };
            break;
          }

          default: {
            result = buildToolFailure(
              request.name,
              new AppError(
                "Unsupported Retell tool.",
                404,
                "RETELL_TOOL_NOT_SUPPORTED"
              )
            );
          }
        }

        await options.repository.createAuditEvent({
          tenantId: officeContext.tenantId,
          officeId: officeContext.officeId,
          actorType: "retell",
          actorId: request.call.call_id,
          action: result.ok ? "retell.tool.executed" : "retell.tool.failed",
          payload: {
            tool: request.name,
            success: result.ok,
            args: sanitizeToolArgs(request.name, request.args)
          }
        });

        return result;
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }

        await options.repository.createAuditEvent({
          tenantId: officeContext.tenantId,
          officeId: officeContext.officeId,
          actorType: "retell",
          actorId: request.call.call_id,
          action: "retell.tool.failed",
          payload: {
            tool: request.name,
            success: false,
            errorCode: error.code,
            args: sanitizeToolArgs(request.name, request.args)
          }
        });

        return buildToolFailure(request.name, error);
      }
    }
  };
}

export type RetellService = ReturnType<typeof createRetellService>;
