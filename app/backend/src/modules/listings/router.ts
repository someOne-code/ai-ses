import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { decomposeListingSearchPlan } from "./decomposition.js";
import type {
  DecomposedListingSearchPlan,
  ListingSearchRouterState,
  SearchListingsFilters,
  StructuredFilterPatch,
  StructuredSearchCriteria
} from "./types.js";

export const GEMINI_LISTING_SEARCH_ROUTER_MODEL = "gemini-3.1-flash-lite-preview";
export const LISTING_SEARCH_ROUTER_TIMEOUT_MS = 700;

const STRUCTURED_FILTER_FIELDS = [
  "district",
  "neighborhood",
  "listingType",
  "propertyType",
  "minPrice",
  "maxPrice",
  "minBedrooms",
  "minBathrooms",
  "minNetM2",
  "maxNetM2"
] as const satisfies Array<keyof StructuredFilterPatch>;

const routerAnchorSchema = z
  .object({
    canonical: z.string().trim().min(1),
    raw: z.string().trim().min(1)
  })
  .strict();

const routerStructuredPatchSchema = z
  .object({
    district: z.string().trim().min(1).optional(),
    neighborhood: z.string().trim().min(1).optional(),
    listingType: z.string().trim().min(1).optional(),
    propertyType: z.string().trim().min(1).optional(),
    minPrice: z.number().finite().nonnegative().optional(),
    maxPrice: z.number().finite().nonnegative().optional(),
    minBedrooms: z.number().int().nonnegative().optional(),
    minBathrooms: z.number().int().nonnegative().optional(),
    minNetM2: z.number().finite().nonnegative().optional(),
    maxNetM2: z.number().finite().nonnegative().optional()
  })
  .strict();

const routerOutputSchema = z
  .object({
    intentMode: z.enum([
      "new_search",
      "refine_search",
      "replace_failed_free_text",
      "next_page"
    ]),
    structuredFiltersPatch: routerStructuredPatchSchema,
    structuredFiltersAction: z.enum(["replace", "append", "clear"]),
    semanticIntent: z.string().trim().min(1).nullable(),
    mustAnchorTerms: z.array(routerAnchorSchema),
    negatedTerms: z.array(routerAnchorSchema),
    clearSelectedListingContext: z.boolean(),
    paginationAction: z.enum(["none", "next_page"])
  })
  .strict();

const ROUTER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: [
    "intentMode",
    "structuredFiltersPatch",
    "structuredFiltersAction",
    "semanticIntent",
    "mustAnchorTerms",
    "negatedTerms",
    "clearSelectedListingContext",
    "paginationAction"
  ],
  propertyOrdering: [
    "intentMode",
    "structuredFiltersPatch",
    "structuredFiltersAction",
    "semanticIntent",
    "mustAnchorTerms",
    "negatedTerms",
    "clearSelectedListingContext",
    "paginationAction"
  ],
  properties: {
    intentMode: {
      type: Type.STRING,
      format: "enum",
      enum: ["new_search", "refine_search", "replace_failed_free_text", "next_page"]
    },
    structuredFiltersPatch: {
      type: Type.OBJECT,
      properties: {
        district: { type: Type.STRING },
        neighborhood: { type: Type.STRING },
        listingType: { type: Type.STRING },
        propertyType: { type: Type.STRING },
        minPrice: { type: Type.NUMBER },
        maxPrice: { type: Type.NUMBER },
        minBedrooms: { type: Type.INTEGER },
        minBathrooms: { type: Type.INTEGER },
        minNetM2: { type: Type.NUMBER },
        maxNetM2: { type: Type.NUMBER }
      }
    },
    structuredFiltersAction: {
      type: Type.STRING,
      format: "enum",
      enum: ["replace", "append", "clear"]
    },
    semanticIntent: {
      anyOf: [{ type: Type.STRING }, { type: Type.NULL }]
    },
    mustAnchorTerms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["canonical", "raw"],
        properties: {
          canonical: { type: Type.STRING },
          raw: { type: Type.STRING }
        }
      }
    },
    negatedTerms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["canonical", "raw"],
        properties: {
          canonical: { type: Type.STRING },
          raw: { type: Type.STRING }
        }
      }
    },
    clearSelectedListingContext: {
      type: Type.BOOLEAN
    },
    paginationAction: {
      type: Type.STRING,
      format: "enum",
      enum: ["none", "next_page"]
    }
  }
} as const;

interface ListingSearchRouterClient {
  models: {
    generateContent(input: {
      model: string;
      contents: string;
      config: {
        abortSignal: AbortSignal;
        responseMimeType: "application/json";
        responseSchema: typeof ROUTER_RESPONSE_SCHEMA;
        temperature: number;
      };
    }): Promise<{
      text?: string | undefined;
    }>;
  };
}

export interface ListingSearchRouter {
  decompose(
    filters: SearchListingsFilters,
    input?: {
      state?: ListingSearchRouterState;
    }
  ): Promise<DecomposedListingSearchPlan>;
}

interface CreateListingSearchRouterInput {
  client: ListingSearchRouterClient;
  model?: string;
  timeoutMs?: number;
}

function trimOptional(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function mergeStructuredFilters(
  base: StructuredSearchCriteria,
  patch: StructuredFilterPatch,
  action: "replace" | "append" | "clear"
): StructuredSearchCriteria {
  const next: StructuredSearchCriteria = { ...base };
  const mutableNext = next as Record<
    (typeof STRUCTURED_FILTER_FIELDS)[number],
    string | number | undefined
  >;

  for (const field of STRUCTURED_FILTER_FIELDS) {
    const patchValue = patch[field];

    if (patchValue === undefined) {
      continue;
    }

    if (action === "clear") {
      delete next[field];
      continue;
    }

    // This phase only supports scalar filters; append behaves as replace.
    mutableNext[field] = patchValue;
  }

  return next;
}

function toRouterPrompt(input: {
  queryText: string;
  state: ListingSearchRouterState;
  fallbackPlan: DecomposedListingSearchPlan;
}): string {
  return [
    "You are a strict JSON router for listing search intent decomposition.",
    "Return only valid JSON. Do not add markdown.",
    "Decide intent and filter patch from the current user text and current search state.",
    "Do not use transcript history. Use only provided state.",
    "Do not invent unsupported enum values.",
    "",
    `CurrentUserText: ${JSON.stringify(input.queryText)}`,
    `CurrentSearchState: ${JSON.stringify(input.state)}`,
    `RuleBasedFallbackPlan: ${JSON.stringify({
      intentMode: input.fallbackPlan.intentMode,
      semanticIntent: input.fallbackPlan.semanticIntent,
      mustAnchorTerms: input.fallbackPlan.mustAnchorTerms,
      negatedTerms: input.fallbackPlan.negatedTerms,
      structuredFiltersPatch: input.fallbackPlan.structuredFiltersPatch,
      structuredFiltersAction: input.fallbackPlan.structuredFiltersAction,
      clearSelectedListingContext: input.fallbackPlan.clearSelectedListingContext,
      paginationAction: input.fallbackPlan.paginationAction
    })}`
  ].join("\n");
}

function shouldUseMicroLlmRouter(input: {
  queryText: string | undefined;
  state: ListingSearchRouterState;
  fallbackPlan: DecomposedListingSearchPlan;
}): boolean {
  if (!input.queryText || input.queryText.trim() === "") {
    return false;
  }

  if (input.fallbackPlan.intentMode === "next_page") {
    return true;
  }

  if (
    input.state.hasActiveSearch ||
    input.state.lastSearchOutcome === "no_match"
  ) {
    return true;
  }

  return (
    input.fallbackPlan.semanticIntent === null &&
    input.fallbackPlan.mustAnchorTerms.length === 0 &&
    input.fallbackPlan.negatedTerms.length === 0
  );
}

function toPlanFromRouterOutput(input: {
  fallbackPlan: DecomposedListingSearchPlan;
  routerOutput: z.infer<typeof routerOutputSchema>;
}): DecomposedListingSearchPlan {
  return {
    structuredFilters: mergeStructuredFilters(
      input.fallbackPlan.structuredFilters,
      input.routerOutput.structuredFiltersPatch,
      input.routerOutput.structuredFiltersAction
    ),
    semanticIntent: trimOptional(input.routerOutput.semanticIntent),
    mustAnchorTerms: input.routerOutput.mustAnchorTerms,
    negatedTerms: input.routerOutput.negatedTerms,
    intentMode: input.routerOutput.intentMode,
    structuredFiltersPatch: input.routerOutput.structuredFiltersPatch,
    structuredFiltersAction: input.routerOutput.structuredFiltersAction,
    clearSelectedListingContext: input.routerOutput.clearSelectedListingContext,
    paginationAction: input.routerOutput.paginationAction,
    appliedQueryText: input.fallbackPlan.appliedQueryText
  };
}

function parseRouterResponseText(
  text: string
): z.infer<typeof routerOutputSchema> | null {
  try {
    return routerOutputSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function createListingSearchRouter(
  input: CreateListingSearchRouterInput
): ListingSearchRouter {
  const timeoutMs = input.timeoutMs ?? LISTING_SEARCH_ROUTER_TIMEOUT_MS;
  const model = input.model ?? GEMINI_LISTING_SEARCH_ROUTER_MODEL;

  return {
    async decompose(filters, args) {
      const fallbackPlan = decomposeListingSearchPlan(filters, args?.state);
      const queryText = trimOptional(filters.queryText);
      const state: ListingSearchRouterState = {
        hasActiveSearch: args?.state?.hasActiveSearch ?? false,
        lastSearchOutcome: args?.state?.lastSearchOutcome ?? "none"
      };

      if (
        !shouldUseMicroLlmRouter({
          queryText: queryText ?? undefined,
          state,
          fallbackPlan
        })
      ) {
        return fallbackPlan;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await input.client.models.generateContent({
          model,
          contents: toRouterPrompt({
            queryText: queryText!,
            state,
            fallbackPlan
          }),
          config: {
            abortSignal: controller.signal,
            responseMimeType: "application/json",
            responseSchema: ROUTER_RESPONSE_SCHEMA,
            temperature: 0
          }
        });
        const text = trimOptional(response.text);

        if (!text) {
          return fallbackPlan;
        }

        const routerOutput = parseRouterResponseText(text);

        if (!routerOutput) {
          return fallbackPlan;
        }

        return toPlanFromRouterOutput({
          fallbackPlan,
          routerOutput
        });
      } catch (error) {
        console.error("[listing-search-router] gemini router call failed", {
          model,
          timeoutMs,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message
                }
              : "unknown_error"
        });
        return fallbackPlan;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function createGeminiListingSearchRouterFromEnv(): ListingSearchRouter {
  if (!env.GEMINI_API_KEY) {
    throw new AppError(
      "GEMINI_API_KEY is required for listing search router.",
      500,
      "GEMINI_API_KEY_MISSING"
    );
  }

  return createListingSearchRouter({
    client: new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY
    })
  });
}
