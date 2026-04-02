import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type {
  RepairStep,
  VoiceFieldError,
  VoiceRepairDetails
} from "../retell/repair-types.js";

const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 5;
const searchModeSchema = z.enum(["structured", "hybrid"]);
const listingSearchValidationFields = [
  "district",
  "neighborhood",
  "listingType",
  "propertyType",
  "queryText",
  "minPrice",
  "maxPrice",
  "minBedrooms",
  "minBathrooms",
  "minNetM2",
  "maxNetM2",
  "limit"
] as const;

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

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
      isFiniteNonNegativeNumber(value.minPrice) &&
      isFiniteNonNegativeNumber(value.maxPrice) &&
      value.minPrice > value.maxPrice
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minPrice cannot be greater than maxPrice.",
        path: ["minPrice"]
      });
    }

    if (
      isFiniteNonNegativeNumber(value.minNetM2) &&
      isFiniteNonNegativeNumber(value.maxNetM2) &&
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

export interface ListingSearchShortlistItem extends ListingSearchItem {
  dues: number | null;
  buildingAge: number | null;
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
  matchSource: ListingSearchMatchSource;
  approximate: boolean;
  cosineDistance: number | null;
}

export type ListingSearchMatchSource =
  | "structured"
  | "lexical"
  | "vector"
  | "hybrid";

export type ListingSearchMatchInterpretation =
  | "verified_structured_match"
  | "hybrid_candidate"
  | "no_match";

export interface ListingSearchResult {
  listings: ListingSearchShortlistItem[];
  matchInterpretation: ListingSearchMatchInterpretation;
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

export type SearchIntentMode =
  | "new_search"
  | "refine_search"
  | "replace_failed_free_text"
  | "next_page";

export type FilterMergeAction = "replace" | "append" | "clear";

export interface SearchAnchorTerm {
  canonical: string;
  raw: string;
}

export interface SearchNegatedTerm {
  canonical: string;
  raw: string;
}

export interface StructuredSearchCriteria {
  district?: string | undefined;
  neighborhood?: string | undefined;
  listingType?: string | undefined;
  propertyType?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minBedrooms?: number | undefined;
  minBathrooms?: number | undefined;
  minNetM2?: number | undefined;
  maxNetM2?: number | undefined;
}

export interface StructuredFilterPatch {
  district?: string | undefined;
  neighborhood?: string | undefined;
  listingType?: string | undefined;
  propertyType?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minBedrooms?: number | undefined;
  minBathrooms?: number | undefined;
  minNetM2?: number | undefined;
  maxNetM2?: number | undefined;
}

export interface DecomposedListingSearchPlan {
  structuredFilters: StructuredSearchCriteria;
  semanticIntent: string | null;
  mustAnchorTerms: SearchAnchorTerm[];
  negatedTerms: SearchNegatedTerm[];
  intentMode: SearchIntentMode;
  structuredFiltersPatch: StructuredFilterPatch;
  structuredFiltersAction: FilterMergeAction;
  clearSelectedListingContext: boolean;
  paginationAction: "none" | "next_page";
  appliedQueryText: string | null;
}

export interface ListingSearchRouterState {
  hasActiveSearch: boolean;
  lastSearchOutcome?: "success" | "no_match" | "exhausted_results" | "none";
  activeStructuredCriteria?: StructuredSearchCriteria | undefined;
  activeSemanticIntent?: string | null | undefined;
  activeMustAnchorTerms?: SearchAnchorTerm[] | undefined;
  activeNegatedTerms?: SearchNegatedTerm[] | undefined;
  selectedListingReferenceCode?: string | null | undefined;
  selectedListingFactsForContext?:
    | ListingSelectedContextFacts
    | null
    | undefined;
  viewedListingIds?: string[] | undefined;
  lastUserSearchText?: string | null | undefined;
}

export interface ListingSelectedContextFacts {
  listingType?: string | undefined;
  district?: string | undefined;
  neighborhood?: string | undefined;
}

export type ListingSearchOutcome =
  | "success"
  | "no_match"
  | "exhausted_results"
  | "none";

export interface ListingSearchState {
  activeStructuredCriteria: StructuredSearchCriteria;
  activeSemanticIntent: string | null;
  activeMustAnchorTerms: SearchAnchorTerm[];
  activeNegatedTerms: SearchNegatedTerm[];
  lastSearchOutcome: ListingSearchOutcome;
  lastUserSearchText: string | null;
  selectedListingReferenceCode: string | null;
  selectedListingFactsForContext: ListingSelectedContextFacts | null;
  viewedListingIds: string[];
  updatedAt: string;
}

export interface ListingSearchRetrievalControls {
  mustAnchorTerms?: SearchAnchorTerm[] | undefined;
  negatedTerms?: SearchNegatedTerm[] | undefined;
  viewedListingIds?: string[] | undefined;
}

export type ListingSearchValidationField =
  (typeof listingSearchValidationFields)[number];

export interface ListingSearchValidationDetails
  extends VoiceRepairDetails<
    RepairStep,
    ListingSearchValidationField
  > {}

export interface ListingReferenceValidationDetails
  extends VoiceRepairDetails<RepairStep, "referenceCode"> {}

const listingSearchRepairOwners = {
  minPrice: "minPrice",
  maxPrice: "maxPrice"
} as const satisfies Partial<Record<ListingSearchValidationField, RepairStep>>;

type ListingSearchRepairOwnerField = keyof typeof listingSearchRepairOwners;

function isListingSearchRepairOwnerField(
  field: ListingSearchValidationField | "unknown"
): field is ListingSearchRepairOwnerField {
  return field === "minPrice" || field === "maxPrice";
}

function isListingSearchValidationField(
  value: unknown
): value is ListingSearchValidationField {
  return (
    typeof value === "string" &&
    listingSearchValidationFields.includes(value as ListingSearchValidationField)
  );
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

export function toListingSearchValidationDetails(
  error: z.ZodError
): ListingSearchValidationDetails {
  const fieldErrors: Array<VoiceFieldError<ListingSearchValidationField>> =
    error.issues.map((issue) => {
      const head = issue.path[0];
      const field = isListingSearchValidationField(head) ? head : "unknown";

      return {
        field,
        message: issue.message
      };
    });

  const repairOwnerField = fieldErrors
    .map((entry) => entry.field)
    .find(isListingSearchRepairOwnerField);

  const repairStep =
    repairOwnerField === undefined
      ? "unknown"
      : listingSearchRepairOwners[repairOwnerField];

  return {
    code: "VALIDATION_ERROR",
    repairStep,
    fieldErrors
  };
}

export function toListingReferenceValidationDetails(
  error: z.ZodError
): ListingReferenceValidationDetails {
  const fieldErrors: Array<VoiceFieldError<"referenceCode">> = error.issues.map((issue) => {
    const head = issue.path[0];
    const field: "referenceCode" | "unknown" =
      head === "referenceCode" ? "referenceCode" : "unknown";

    return {
      field,
      message: issue.message
    };
  });

  return {
    code: "VALIDATION_ERROR",
    repairStep: fieldErrors.some((entry) => entry.field === "referenceCode")
      ? "referenceCode"
      : "unknown",
    fieldErrors
  };
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
  const result = listingByReferenceParamsSchema.safeParse(input);

  if (!result.success) {
    throw new AppError(
      "Invalid listing reference lookup.",
      400,
      "VALIDATION_ERROR",
      toListingReferenceValidationDetails(result.error)
    );
  }

  return result.data;
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
  const result = searchListingsQuerySchema.safeParse(input);

  if (!result.success) {
    throw new AppError(
      "Invalid listings search query.",
      400,
      "VALIDATION_ERROR",
      toListingSearchValidationDetails(result.error)
    );
  }

  return result.data;
}
