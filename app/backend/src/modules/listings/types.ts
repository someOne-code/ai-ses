import { z } from "zod";

import { AppError } from "../../lib/errors.js";

const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 5;
const searchModeSchema = z.enum(["structured", "hybrid"]);

const officeParamsSchema = z.object({
  officeId: z.string().uuid()
});

const listingByReferenceParamsSchema = officeParamsSchema.extend({
  referenceCode: z.string().trim().min(1)
});

const listingSearchDocumentRefreshParamsSchema = officeParamsSchema.extend({
  listingId: z.string().uuid()
});

function optionalNumberQuery(schema: z.ZodNumber) {
  return z.preprocess((value) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "string" && value.trim() === "") {
      return Number.NaN;
    }

    return value;
  }, z.coerce.number().pipe(schema).optional());
}

const searchListingsQuerySchema = z
  .object({
    district: z.string().trim().min(1).optional(),
    neighborhood: z.string().trim().min(1).optional(),
    listingType: z.string().trim().min(1).optional(),
    propertyType: z.string().trim().min(1).optional(),
    queryText: z.string().trim().min(1).max(1000).optional(),
    searchMode: searchModeSchema.optional(),
    minPrice: optionalNumberQuery(z.number().finite().nonnegative()),
    maxPrice: optionalNumberQuery(z.number().finite().nonnegative()),
    minBedrooms: optionalNumberQuery(z.number().int().nonnegative()),
    minBathrooms: optionalNumberQuery(z.number().int().nonnegative()),
    minNetM2: optionalNumberQuery(z.number().finite().nonnegative()),
    maxNetM2: optionalNumberQuery(z.number().finite().nonnegative()),
    limit: optionalNumberQuery(z.number().int().positive())
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

    if (value.searchMode === "hybrid" && value.queryText === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "queryText is required when searchMode is hybrid.",
        path: ["queryText"]
      });
    }
  })
  .transform((value) => ({
    ...value,
    searchMode:
      value.searchMode ??
      (value.queryText !== undefined ? "hybrid" : "structured"),
    limit: Math.min(Math.max(value.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
  }));

export interface ListingSearchItem {
  id: string;
  referenceCode: string;
  title: string;
  listingType: string | null;
  propertyType: string | null;
  price: number | null;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  netM2: number | null;
  district: string | null;
  neighborhood: string | null;
  status: string;
}

export interface ListingDetail extends ListingSearchItem {
  description: string | null;
  grossM2: number | null;
  floorNumber: number | null;
  buildingAge: number | null;
  dues: number | null;
  addressText: string | null;
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
}

export interface MainListingSearchDocumentRefreshResult {
  id: string;
  officeId: string;
  listingId: string;
  documentType: "main";
  hasEmbedding: boolean;
  embeddingModel: string | null;
  embeddingUpdatedAt: string | null;
  updatedAt: string;
}

export type ListingSearchMode = z.infer<typeof searchModeSchema>;
export type ListingOfficeParams = z.infer<typeof officeParamsSchema>;
export type ListingByReferenceParams = z.infer<typeof listingByReferenceParamsSchema>;
export type ListingSearchDocumentRefreshParams = z.infer<
  typeof listingSearchDocumentRefreshParamsSchema
>;
export type SearchListingsQuery = z.output<typeof searchListingsQuerySchema>;
export type SearchListingsFilters = ListingOfficeParams & SearchListingsQuery;
export type HybridListingSearchInput = SearchListingsFilters;

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

export function parseListingOfficeParams(input: unknown): ListingOfficeParams {
  return parseWithSchema(
    officeParamsSchema,
    input,
    "Invalid office identifier."
  );
}

export function parseListingByReferenceParams(
  input: unknown
): ListingByReferenceParams {
  return parseWithSchema(
    listingByReferenceParamsSchema,
    input,
    "Invalid listing reference lookup."
  );
}

export function parseListingSearchDocumentRefreshParams(
  input: unknown
): ListingSearchDocumentRefreshParams {
  return parseWithSchema(
    listingSearchDocumentRefreshParamsSchema,
    input,
    "Invalid listing search document refresh request."
  );
}

export function parseSearchListingsQuery(input: unknown): SearchListingsQuery {
  return parseWithSchema(
    searchListingsQuerySchema,
    input,
    "Invalid listings search query."
  );
}
