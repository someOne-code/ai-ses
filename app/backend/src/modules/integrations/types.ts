import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type {
  LeadIntent,
  LeadTemperature
} from "../retell/post-call-analysis.js";
import type { PreferredTimeWindow } from "../showing-requests/types.js";

export const BOOKING_WORKFLOW_CONNECTION_KIND = "booking_workflow";
export const CRM_WEBHOOK_CONNECTION_KIND = "crm_webhook";
export const N8N_CALLBACK_SECRET_HEADER = "x-ai-ses-callback-secret";
export const BOOKING_RESULT_CALLBACK_PATH = "/v1/webhooks/n8n/booking-results";
export const CRM_DELIVERY_CALLBACK_PATH = "/v1/webhooks/n8n/crm-deliveries";

const officeParamsSchema = z.object({
  officeId: z.string().uuid()
});

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());

const optionalDatetimeString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().datetime({ offset: true }).optional());

const showingRequestParamsSchema = officeParamsSchema.extend({
  showingRequestId: z.string().uuid()
});

const crmContractEntitySchema = z.discriminatedUnion("entityType", [
  z.object({
    entityType: z.literal("showing_request"),
    entityId: z.string().uuid(),
    eventType: z.enum([
      "lead_created",
      "lead_updated",
      "showing_request_created",
      "showing_booking_confirmed",
      "showing_booking_failed"
    ])
  }),
  z.object({
    entityType: z.literal("call_log"),
    entityId: z.string().uuid(),
    eventType: z.enum(["call_outcome_logged", "call_summary_ready"])
  })
]);

const bookingResultCallbackBodySchema = z.object({
  officeId: z.string().uuid(),
  showingRequestId: z.string().uuid(),
  connectionId: z.string().uuid(),
  status: z.enum(["confirmed", "failed", "canceled"]),
  workflowRunId: optionalTrimmedString,
  externalBookingId: optionalTrimmedString,
  scheduledDatetime: optionalDatetimeString,
  note: optionalTrimmedString,
  payload: z.unknown().optional()
});

const crmDeliveryCallbackBodySchema = z.object({
  officeId: z.string().uuid(),
  connectionId: z.string().uuid(),
  entityType: z.enum(["showing_request", "call_log"]),
  entityId: z.string().uuid(),
  eventType: z.enum([
    "lead_created",
    "lead_updated",
    "showing_request_created",
    "showing_booking_confirmed",
    "showing_booking_failed",
    "call_outcome_logged",
    "call_summary_ready"
  ]),
  deliveryStatus: z.enum(["delivered", "failed", "skipped"]),
  workflowRunId: optionalTrimmedString,
  externalRecordId: optionalTrimmedString,
  note: optionalTrimmedString,
  payload: z.unknown().optional()
});

export interface IntegrationConnectionRecord {
  id: string;
  officeId: string;
  kind: string;
  status: string;
  config: unknown;
}

export interface OfficeContextRecord {
  officeId: string;
  tenantId: string;
  officeName: string;
  officeTimezone: string;
}

export interface ShowingRequestIntegrationSource {
  id: string;
  officeId: string;
  tenantId: string;
  officeName: string;
  officeTimezone: string;
  listingId: string;
  listingReferenceCode: string;
  listingTitle: string;
  listingType: string;
  propertyType: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  preferredTimeWindow: PreferredTimeWindow | null;
  preferredDatetime: string;
  status: string;
  createdAt: string;
}

export interface CallLogIntegrationSource {
  id: string;
  officeId: string;
  tenantId: string;
  officeName: string;
  officeTimezone: string;
  providerCallId: string;
  direction: string;
  status: string;
  summary: string | null;
  leadIntent: LeadIntent | null;
  leadTemperature: LeadTemperature | null;
  handoffRecommended: boolean | null;
  budgetKnown: boolean | null;
  locationKnown: boolean | null;
  timelineKnown: boolean | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface BookingWorkflowDispatchContract {
  kind: typeof BOOKING_WORKFLOW_CONNECTION_KIND;
  connection: {
    id: string;
    config: unknown;
  };
  office: {
    officeId: string;
    tenantId: string;
    name: string;
    timezone: string;
  };
  showingRequest: {
    id: string;
    listingId: string;
    listingReferenceCode: string;
    listingTitle: string;
    listingType: string | null;
    propertyType: string | null;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    preferredTimeWindow: PreferredTimeWindow | null;
    preferredDatetime: string;
    status: string;
    createdAt: string;
  };
  callback: {
    path: typeof BOOKING_RESULT_CALLBACK_PATH;
    secretHeader: typeof N8N_CALLBACK_SECRET_HEADER;
    secretEnvName: "N8N_BOOKING_CALLBACK_SECRET";
  };
}

export type CrmWebhookDispatchEntity =
  | {
      entityType: "showing_request";
      entityId: string;
      eventType:
        | "lead_created"
        | "lead_updated"
        | "showing_request_created"
        | "showing_booking_confirmed"
        | "showing_booking_failed";
    }
  | {
      entityType: "call_log";
      entityId: string;
      eventType: "call_outcome_logged" | "call_summary_ready";
    };

export interface CrmWebhookDispatchContract {
  kind: typeof CRM_WEBHOOK_CONNECTION_KIND;
  connection: {
    id: string;
    config: unknown;
  };
  office: {
    officeId: string;
    tenantId: string;
    name: string;
    timezone: string;
  };
  entity:
    | {
        entityType: "showing_request";
        id: string;
        showingRequestId: string;
        listingId: string;
        listingReferenceCode: string;
        customerName: string;
        customerPhone: string;
        customerEmail: string | null;
        preferredTimeWindow: PreferredTimeWindow | null;
        preferredDatetime: string;
        status: string;
      }
    | {
        entityType: "call_log";
        id: string;
        providerCallId: string;
        direction: string;
        status: string;
        summary: string | null;
        leadIntent: LeadIntent | null;
        leadTemperature: LeadTemperature | null;
        handoffRecommended: boolean | null;
        budgetKnown: boolean | null;
        locationKnown: boolean | null;
        timelineKnown: boolean | null;
        startedAt: string | null;
        endedAt: string | null;
      };
  event: {
    eventType: CrmWebhookDispatchEntity["eventType"];
  };
  callback: {
    path: typeof CRM_DELIVERY_CALLBACK_PATH;
    secretHeader: typeof N8N_CALLBACK_SECRET_HEADER;
    secretEnvName: "N8N_CRM_CALLBACK_SECRET";
  };
}

export type BookingWorkflowContractParams = z.infer<
  typeof showingRequestParamsSchema
>;
export type CrmWebhookContractParams = z.infer<typeof officeParamsSchema> &
  z.infer<typeof crmContractEntitySchema>;
export type BookingResultCallbackBody = z.infer<
  typeof bookingResultCallbackBodySchema
>;
export type CrmDeliveryCallbackBody = z.infer<
  typeof crmDeliveryCallbackBodySchema
>;

export interface BookingResultCallbackResult {
  received: true;
  officeId: string;
  showingRequestId: string;
  status: BookingResultCallbackBody["status"];
  connectionId: string;
}

export interface CrmDeliveryCallbackResult {
  received: true;
  officeId: string;
  entityType: CrmDeliveryCallbackBody["entityType"];
  entityId: string;
  deliveryStatus: CrmDeliveryCallbackBody["deliveryStatus"];
  connectionId: string;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError(message, 400);
  }

  return result.data;
}

export function parseBookingWorkflowContractParams(
  input: unknown
): BookingWorkflowContractParams {
  return parseWithSchema(
    showingRequestParamsSchema,
    input,
    "Invalid booking workflow contract parameters."
  );
}

export function parseCrmWebhookContractParams(
  input: unknown
): CrmWebhookContractParams {
  return parseWithSchema(
    officeParamsSchema.and(crmContractEntitySchema),
    input,
    "Invalid CRM webhook contract parameters."
  );
}

export function parseBookingResultCallbackBody(
  input: unknown
): BookingResultCallbackBody {
  return parseWithSchema(
    bookingResultCallbackBodySchema,
    input,
    "Invalid booking result callback payload."
  );
}

export function parseCrmDeliveryCallbackBody(
  input: unknown
): CrmDeliveryCallbackBody {
  return parseWithSchema(
    crmDeliveryCallbackBodySchema,
    input,
    "Invalid CRM delivery callback payload."
  );
}
