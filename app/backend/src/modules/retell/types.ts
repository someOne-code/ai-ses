import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type { SearchListingsQuery } from "../listings/types.js";
import {
  customerPhoneSchema,
  preferredTimeWindowSchema,
  preferredTimeWindowValues,
  type CreateShowingRequestBody
} from "../showing-requests/types.js";

export interface RetellToolContract {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

const trimmedOptionalString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());

const optionalEmail = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}, z.email().optional());

// Keep Retell's numeric placeholder tolerance scoped to the noisy
// search_listings provider boundary instead of making it a generic rule.
function optionalRetellSearchNumber(schema: z.ZodNumber) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }

    // Retell often emits 0 as a placeholder for missing optional numeric fields.
    if (value === 0 || value === "0") {
      return undefined;
    }

    return value;
  }, z.coerce.number().pipe(schema).optional());
}

const retellCallSchema = z
  .object({
    call_id: z.string().trim().min(1),
    call_status: trimmedOptionalString,
    direction: trimmedOptionalString,
    from_number: trimmedOptionalString,
    to_number: trimmedOptionalString,
    metadata: z.unknown().optional(),
    retell_llm_dynamic_variables: z.unknown().optional(),
    call_analysis: z.unknown().optional(),
    start_timestamp: z.number().int().nullable().optional(),
    end_timestamp: z.number().int().nullable().optional()
  })
  .passthrough();

const retellWebhookSchema = z
  .object({
    event: trimmedOptionalString,
    event_type: trimmedOptionalString,
    call: retellCallSchema.optional()
  })
  .passthrough();

const searchListingsToolArgsSchema = z
  .object({
    district: trimmedOptionalString,
    neighborhood: trimmedOptionalString,
    listingType: trimmedOptionalString,
    propertyType: trimmedOptionalString,
    queryText: trimmedOptionalString,
    minPrice: optionalRetellSearchNumber(z.number().finite().nonnegative()),
    maxPrice: optionalRetellSearchNumber(z.number().finite().nonnegative()),
    minBedrooms: optionalRetellSearchNumber(z.number().int().nonnegative()),
    minBathrooms: optionalRetellSearchNumber(z.number().int().nonnegative()),
    minNetM2: optionalRetellSearchNumber(z.number().finite().nonnegative()),
    maxNetM2: optionalRetellSearchNumber(z.number().finite().nonnegative()),
    limit: optionalRetellSearchNumber(z.number().int().positive())
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      value.minPrice > value.maxPrice
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minPrice cannot be greater than maxPrice.",
        path: ["minPrice"]
      });
    }

    if (
      value.minNetM2 !== undefined &&
      value.maxNetM2 !== undefined &&
      value.minNetM2 > value.maxNetM2
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minNetM2 cannot be greater than maxNetM2.",
        path: ["minNetM2"]
      });
    }
  })
  .transform((value) => ({
    ...value,
    searchMode:
      value.queryText !== undefined
        ? ("hybrid" as const)
        : ("structured" as const),
    limit: Math.min(Math.max(value.limit ?? 5, 1), 5)
  }));

const getListingByReferenceToolArgsSchema = z
  .object({
    referenceCode: z.string().trim().min(1)
  })
  .strict();

const createShowingRequestToolArgsSchema = z
  .object({
    listingId: z.string().uuid(),
    customerName: z.string().trim().min(1),
    customerPhone: customerPhoneSchema,
    customerEmail: optionalEmail,
    preferredTimeWindow: preferredTimeWindowSchema.optional(),
    preferredDatetime: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value))
  })
  .strict();

const retellToolRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
    call: retellCallSchema
  })
  .passthrough();

export type RetellCall = z.infer<typeof retellCallSchema>;
export type RetellWebhookPayload = z.infer<typeof retellWebhookSchema>;
export type RetellToolRequest = z.infer<typeof retellToolRequestSchema>;
export type SearchListingsToolArgs = z.output<typeof searchListingsToolArgsSchema>;
export type GetListingByReferenceToolArgs = z.infer<
  typeof getListingByReferenceToolArgsSchema
>;
export type CreateShowingRequestToolArgs = z.output<
  typeof createShowingRequestToolArgsSchema
>;

export interface RetellWebhookReceipt {
  received: true;
  event: string;
  callId: string | null;
  officeId: string | null;
}

export interface RetellToolSuccess<TData> {
  ok: true;
  tool: string;
  data: TData;
}

export interface RetellToolFailure {
  ok: false;
  tool: string;
  error: {
    code: string;
    message: string;
  };
}

export type RetellToolResult<TData = unknown> =
  | RetellToolSuccess<TData>
  | RetellToolFailure;

export const retellToolContracts: RetellToolContract[] = [
  {
    name: "search_listings",
    description:
      "Search active office-scoped listings with structured filters and optional free-text intent. Only use returned listings. If the tool returns matchInterpretation=verified_structured_match, the results satisfy the structured filters directly. If it returns hybrid_candidate, treat the listings as possible candidates for the free-text intent, not as confirmed proof of subjective criteria such as metroya yakin. If it returns no_match, the requested free-text criterion was not confirmed. If the caller revises or relaxes the search, rebuild the next tool call from the caller's latest active criteria and do not carry over an old free-text intent unless the caller repeats or confirms it. Returned listings may include spokenSummary, spokenHighlights, spokenPrice, spokenDues, spokenNetM2, spokenRoomPlan, and spokenReferenceCode for caller-facing speech. Prefer those spoken fields whenever present. Never read raw keys, JSON fragments, tool formatting, field labels, or raw English title text aloud; convert the returned facts into short natural Turkish sentences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        district: { type: "string", description: "District to search in." },
        neighborhood: {
          type: "string",
          description: "Neighborhood to narrow the search."
        },
        listingType: {
          type: "string",
          description: "Listing type such as sale or rent."
        },
        propertyType: {
          type: "string",
          description: "Property type such as apartment or villa."
        },
        queryText: {
          type: "string",
          description:
            "Optional residual caller intent such as metroya yakin or aile icin uygun. Only include this when that subjective preference is still active in the caller's latest request. Backend decides whether hybrid search is used."
        },
        minPrice: { type: "number", description: "Minimum listing price." },
        maxPrice: { type: "number", description: "Maximum listing price." },
        minBedrooms: {
          type: "integer",
          description: "Minimum number of bedrooms."
        },
        minBathrooms: {
          type: "integer",
          description: "Minimum number of bathrooms."
        },
        minNetM2: {
          type: "number",
          description: "Minimum net square meters."
        },
        maxNetM2: {
          type: "number",
          description: "Maximum net square meters."
        },
        limit: {
          type: "integer",
          description: "Maximum number of listings to return. Defaults to 5."
        }
      }
    }
  },
  {
    name: "get_listing_by_reference",
    description:
      "Get a single active office-scoped listing by reference code. Preserve the full spoken code including any leading prefix such as DEMO; do not drop tokens. Spacing, hyphen, and case variants are acceptable, but partial codes are not. Use the returned fields as source of truth. The verified listing may include spokenSummary, spokenHighlights, spokenPrice, spokenDues, spokenNetM2, spokenRoomPlan, and spokenReferenceCode for caller-facing speech; prefer those spoken fields whenever present. Never read transcript structure, field labels, JSON-like formatting, or raw English title text aloud; summarize the verified listing in short natural Turkish sentences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["referenceCode"],
      properties: {
        referenceCode: {
          type: "string",
          description:
            "Full listing reference code, such as KD-102 or DEMO-IST-3401. Keep every spoken token, including prefixes like DEMO."
        }
      }
    }
  },
  {
    name: "create_showing_request",
    description:
      "Create a showing request for an office-scoped listing after collecting the minimum required customer details. A usable caller name is enough; do not require surname. The listingId must be the verified backend UUID returned by get_listing_by_reference or another backend tool result, never a raw spoken reference code. Use the confirmed callback number, never a literal placeholder such as {{user_number}}, and only include email if the caller volunteered it. When repeating a callback number to the caller, say each digit in short blocks and keep the wording fully Turkish. Do not expose tool names, argument keys, or schema words to the caller.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "listingId",
        "customerName",
        "customerPhone",
        "preferredDatetime"
      ],
      properties: {
        listingId: {
          type: "string",
          format: "uuid",
          description:
            "Verified backend listing UUID returned by get_listing_by_reference or another backend tool result. Never pass a raw reference code or spoken code here."
        },
        customerName: {
          type: "string",
          description:
            "Customer name for the request. A single given name is acceptable if that is all the caller wants to provide."
        },
        customerPhone: {
          type: "string",
          description:
            "Confirmed callback phone number. On phone_call, use the current caller number after brief confirmation. On web_call, use the callback number the caller provided. Never pass a literal placeholder such as {{user_number}}."
        },
        customerEmail: {
          type: "string",
          description: "Customer email address if available."
        },
        preferredTimeWindow: {
          type: "string",
          enum: [...preferredTimeWindowValues],
          description:
            "Optional broad time preference when the caller does not give an exact hour. Use one of: morning, afternoon, evening, after_work, flexible."
        },
        preferredDatetime: {
          type: "string",
          format: "date-time",
          description:
            "Preferred showing datetime in ISO-8601 format with offset. If the caller only gave a broad window, this may be an internal placeholder while preferredTimeWindow preserves the real flexibility."
        }
      }
    }
  }
];

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError(message, 400, "VALIDATION_ERROR");
  }

  return result.data;
}

export function parseRetellWebhookPayload(input: unknown): RetellWebhookPayload {
  return parseWithSchema(
    retellWebhookSchema,
    input,
    "Invalid Retell webhook payload."
  );
}

export function parseRetellToolRequest(input: unknown): RetellToolRequest {
  return parseWithSchema(
    retellToolRequestSchema,
    input,
    "Invalid Retell tool payload."
  );
}

export function parseSearchListingsToolArgs(
  input: unknown
): SearchListingsQuery {
  return parseWithSchema(
    searchListingsToolArgsSchema,
    input,
    "Invalid search_listings arguments."
  );
}

export function parseGetListingByReferenceToolArgs(
  input: unknown
): GetListingByReferenceToolArgs {
  return parseWithSchema(
    getListingByReferenceToolArgsSchema,
    input,
    "Invalid get_listing_by_reference arguments."
  );
}

export function parseCreateShowingRequestToolArgs(
  input: unknown
): CreateShowingRequestBody {
  return parseWithSchema(
    createShowingRequestToolArgsSchema,
    input,
    "Invalid create_showing_request arguments."
  );
}
