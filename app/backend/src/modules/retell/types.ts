import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type { SearchListingsQuery } from "../listings/types.js";
import type { CreateShowingRequestBody } from "../showing-requests/types.js";

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

const trimmedOptionalString = z.string().trim().min(1).optional();

function optionalNumber(schema: z.ZodNumber) {
  return z.preprocess((value) => value, z.coerce.number().pipe(schema).optional());
}

const retellCallSchema = z
  .object({
    call_id: z.string().trim().min(1),
    call_status: z.string().trim().min(1).optional(),
    direction: z.string().trim().min(1).optional(),
    from_number: z.string().trim().min(1).optional(),
    to_number: z.string().trim().min(1).optional(),
    metadata: z.unknown().optional(),
    retell_llm_dynamic_variables: z.unknown().optional(),
    call_analysis: z.unknown().optional(),
    start_timestamp: z.number().int().nullable().optional(),
    end_timestamp: z.number().int().nullable().optional()
  })
  .passthrough();

const retellWebhookSchema = z
  .object({
    event: z.string().trim().min(1).optional(),
    event_type: z.string().trim().min(1).optional(),
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
    minPrice: optionalNumber(z.number().finite().nonnegative()),
    maxPrice: optionalNumber(z.number().finite().nonnegative()),
    minBedrooms: optionalNumber(z.number().int().nonnegative()),
    minBathrooms: optionalNumber(z.number().int().nonnegative()),
    minNetM2: optionalNumber(z.number().finite().nonnegative()),
    maxNetM2: optionalNumber(z.number().finite().nonnegative()),
    limit: optionalNumber(z.number().int().positive())
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
    customerPhone: z.string().trim().min(1),
    customerEmail: z.email().optional(),
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
      "Search active office-scoped listings with structured filters and optional free-text intent. Only use returned listings.",
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
            "Optional residual caller intent such as metroya yakin or aile icin uygun. Backend decides whether hybrid search is used."
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
      "Get a single active office-scoped listing by reference code. Use the returned fields as source of truth.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["referenceCode"],
      properties: {
        referenceCode: {
          type: "string",
          description: "Listing reference code, such as KD-102."
        }
      }
    }
  },
  {
    name: "create_showing_request",
    description:
      "Create a showing request for an office-scoped listing after collecting the required customer details.",
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
          description: "Listing identifier returned by another backend tool."
        },
        customerName: { type: "string", description: "Customer full name." },
        customerPhone: { type: "string", description: "Customer phone number." },
        customerEmail: {
          type: "string",
          description: "Customer email address if available."
        },
        preferredDatetime: {
          type: "string",
          format: "date-time",
          description: "Preferred showing time in ISO-8601 format with offset."
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
