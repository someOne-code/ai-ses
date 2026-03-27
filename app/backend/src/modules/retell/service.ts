import { verify } from "retell-sdk";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { ListingsService } from "../listings/service.js";
import type { ShowingRequestsService } from "../showing-requests/service.js";
import { normalizeRetellLeadQualification } from "./post-call-analysis.js";
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

function getWebhookEventName(payload: RetellWebhookPayload): string {
  return payload.event ?? payload.event_type ?? "unknown";
}

function sanitizeToolArgs(name: string, args: Record<string, unknown>) {
  if (name === "create_showing_request") {
    return {
      listingId: typeof args.listingId === "string" ? args.listingId : null,
      preferredDatetime:
        typeof args.preferredDatetime === "string"
          ? args.preferredDatetime
          : null,
      hasCustomerEmail: typeof args.customerEmail === "string"
    };
  }

  return args;
}

export function createRetellService(options: RetellServiceOptions) {
  async function ensureWebhookSecret(): Promise<string> {
    const webhookSecret = options.webhookSecret ?? env.RETELL_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new AppError(
        "Retell webhook secret is not configured.",
        503,
        "RETELL_WEBHOOK_SECRET_MISSING"
      );
    }

    return webhookSecret;
  }

  async function verifySignature(signature: string | undefined, body: unknown) {
    const webhookSecret = await ensureWebhookSecret();

    if (!signature) {
      throw new AppError(
        "Missing Retell signature.",
        401,
        "RETELL_SIGNATURE_INVALID"
      );
    }

    const isValid = await verify(JSON.stringify(body), webhookSecret, signature);

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
    return {
      ok: false,
      tool: toolName,
      error: {
        code: error.code,
        message: error.message
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
    }): Promise<RetellWebhookReceipt> {
      await verifySignature(input.signature, input.body);

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
    }): Promise<RetellToolResult> {
      await verifySignature(input.signature, input.body);

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
            const listings = await options.listingsService.searchListings({
              officeId: officeContext.officeId,
              ...args
            });

            result = {
              ok: true,
              tool: request.name,
              data: {
                count: listings.length,
                listings
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

            result = {
              ok: true,
              tool: request.name,
              data: {
                listing
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
