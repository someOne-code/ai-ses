import { AppError } from "../../lib/errors.js";

import { decomposeListingSearchPlan } from "./decomposition.js";
import type { ListingQueryEmbeddingGenerator } from "./embeddings.js";
import type { ListingSearchDocumentsService } from "./search-documents.js";
import type { ListingsRepository } from "./repository.js";
import type { ListingSearchRouter } from "./router.js";
import type {
  DecomposedListingSearchPlan,
  ListingDetail,
  ListingSearchDocumentRefreshParams,
  ListingSearchOutcome,
  ListingSearchState,
  ListingSelectedContextFacts,
  MainListingSearchDocumentRefreshResult,
  ListingSearchResult,
  ListingSearchItem,
  ListingSearchShortlistItem,
  ListingByReferenceParams,
  ListingSearchRouterState,
  SearchAnchorTerm,
  StructuredFilterPatch,
  StructuredSearchCriteria,
  SearchListingsFilters
} from "./types.js";

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

function toNullableNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === "number" ? value : Number(value);
}

interface ListingsLogger {
  warn(bindings: Record<string, unknown>, message: string): void;
}

export interface ListingSearchExecutionContext {
  routerState?: ListingSearchRouterState;
  searchState?: ListingSearchState;
  onSearchStateResolved?: ((state: ListingSearchState) => void) | undefined;
}

function compactStructuredCriteria(
  criteria: StructuredSearchCriteria
): StructuredSearchCriteria {
  const compacted: StructuredSearchCriteria = {};
  const mutable = compacted as Record<
    (typeof STRUCTURED_FILTER_FIELDS)[number],
    string | number | undefined
  >;

  for (const field of STRUCTURED_FILTER_FIELDS) {
    const value = criteria[field];

    if (value !== undefined) {
      mutable[field] = value;
    }
  }

  return compacted;
}

function mergeStructuredCriteria(
  base: StructuredSearchCriteria,
  patch: StructuredFilterPatch,
  action: "replace" | "append" | "clear"
): StructuredSearchCriteria {
  const merged = compactStructuredCriteria(base);
  const mutable = merged as Record<
    (typeof STRUCTURED_FILTER_FIELDS)[number],
    string | number | undefined
  >;

  for (const field of STRUCTURED_FILTER_FIELDS) {
    const patchValue = patch[field];

    if (patchValue === undefined) {
      continue;
    }

    if (action === "clear") {
      delete merged[field];
      continue;
    }

    // This phase keeps scalar overwrite semantics; append is intentionally
    // treated as replace for deterministic behavior on single-value filters.
    mutable[field] = patchValue;
  }

  return compactStructuredCriteria(merged);
}

function dedupeAnchors(anchors: SearchAnchorTerm[]): SearchAnchorTerm[] {
  const seen = new Set<string>();
  const deduped: SearchAnchorTerm[] = [];

  for (const anchor of anchors) {
    const key = anchor.canonical.trim().toLowerCase();

    if (key === "" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(anchor);
  }

  return deduped;
}

function normalizeViewedListingIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of ids) {
    const trimmed = id.trim();

    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function hasActiveSearchState(state: ListingSearchState): boolean {
  return (
    Object.keys(state.activeStructuredCriteria).length > 0 ||
    state.activeSemanticIntent !== null ||
    state.activeMustAnchorTerms.length > 0 ||
    state.activeNegatedTerms.length > 0
  );
}

export function createInitialListingSearchState(
  now: Date = new Date()
): ListingSearchState {
  return {
    activeStructuredCriteria: {},
    activeSemanticIntent: null,
    activeMustAnchorTerms: [],
    activeNegatedTerms: [],
    lastSearchOutcome: "none",
    lastUserSearchText: null,
    selectedListingReferenceCode: null,
    selectedListingFactsForContext: null,
    viewedListingIds: [],
    updatedAt: now.toISOString()
  };
}

export function deriveListingSearchRouterState(
  state?: ListingSearchState
): ListingSearchRouterState {
  const current = state ?? createInitialListingSearchState();

  return {
    hasActiveSearch: hasActiveSearchState(current),
    lastSearchOutcome: current.lastSearchOutcome,
    activeStructuredCriteria: current.activeStructuredCriteria,
    activeSemanticIntent: current.activeSemanticIntent,
    activeMustAnchorTerms: current.activeMustAnchorTerms,
    activeNegatedTerms: current.activeNegatedTerms,
    selectedListingReferenceCode: current.selectedListingReferenceCode,
    selectedListingFactsForContext: current.selectedListingFactsForContext,
    viewedListingIds: current.viewedListingIds,
    lastUserSearchText: current.lastUserSearchText
  };
}

function toSearchOutcome(input: {
  previous: ListingSearchState;
  plan: DecomposedListingSearchPlan;
  result: ListingSearchResult;
}): ListingSearchOutcome {
  if (input.result.matchInterpretation !== "no_match") {
    return "success";
  }

  if (
    input.plan.intentMode === "next_page" &&
    input.previous.viewedListingIds.length > 0
  ) {
    return "exhausted_results";
  }

  return "no_match";
}

function toSelectedListingContext(input: {
  previous: ListingSearchState;
  plan: DecomposedListingSearchPlan;
  semanticIntent: string | null;
  mustAnchorTerms: SearchAnchorTerm[];
  negatedTerms: SearchAnchorTerm[];
}): {
  selectedListingReferenceCode: string | null;
  selectedListingFactsForContext: ListingSelectedContextFacts | null;
} {
  const shouldClearContext =
    input.plan.intentMode === "new_search" ||
    input.plan.clearSelectedListingContext ||
    input.semanticIntent !== null ||
    input.mustAnchorTerms.length > 0 ||
    input.negatedTerms.length > 0;

  if (shouldClearContext) {
    return {
      selectedListingReferenceCode: null,
      selectedListingFactsForContext: null
    };
  }

  return {
    selectedListingReferenceCode: input.previous.selectedListingReferenceCode,
    selectedListingFactsForContext: input.previous.selectedListingFactsForContext
  };
}

export function mergeListingSearchState(input: {
  previousState?: ListingSearchState;
  plan: DecomposedListingSearchPlan;
  result: ListingSearchResult;
  now?: Date;
}): ListingSearchState {
  const previous = input.previousState ?? createInitialListingSearchState();
  let activeStructuredCriteria = previous.activeStructuredCriteria;
  let activeSemanticIntent = previous.activeSemanticIntent;
  let activeMustAnchorTerms = previous.activeMustAnchorTerms;
  let activeNegatedTerms = previous.activeNegatedTerms;

  switch (input.plan.intentMode) {
    case "new_search": {
      activeStructuredCriteria = compactStructuredCriteria(
        input.plan.structuredFilters
      );
      activeSemanticIntent = input.plan.semanticIntent;
      activeMustAnchorTerms = dedupeAnchors(input.plan.mustAnchorTerms);
      activeNegatedTerms = dedupeAnchors(input.plan.negatedTerms);
      break;
    }

    case "replace_failed_free_text": {
      activeStructuredCriteria = mergeStructuredCriteria(
        previous.activeStructuredCriteria,
        input.plan.structuredFiltersPatch,
        input.plan.structuredFiltersAction
      );
      activeSemanticIntent = input.plan.semanticIntent;
      activeMustAnchorTerms = dedupeAnchors(input.plan.mustAnchorTerms);
      activeNegatedTerms = dedupeAnchors(input.plan.negatedTerms);
      break;
    }

    case "refine_search": {
      activeStructuredCriteria = mergeStructuredCriteria(
        previous.activeStructuredCriteria,
        input.plan.structuredFiltersPatch,
        input.plan.structuredFiltersAction
      );
      activeSemanticIntent = input.plan.semanticIntent ?? previous.activeSemanticIntent;
      activeMustAnchorTerms =
        input.plan.mustAnchorTerms.length > 0
          ? dedupeAnchors(input.plan.mustAnchorTerms)
          : previous.activeMustAnchorTerms;
      activeNegatedTerms =
        input.plan.negatedTerms.length > 0
          ? dedupeAnchors(input.plan.negatedTerms)
          : previous.activeNegatedTerms;
      break;
    }

    case "next_page": {
      activeStructuredCriteria = previous.activeStructuredCriteria;
      activeSemanticIntent = previous.activeSemanticIntent;
      activeMustAnchorTerms = previous.activeMustAnchorTerms;
      activeNegatedTerms = previous.activeNegatedTerms;
      break;
    }
  }

  const outcome = toSearchOutcome({
    previous,
    plan: input.plan,
    result: input.result
  });
  const resultIds = input.result.listings.map((listing) => listing.id);
  const viewedListingIds =
    outcome === "success"
      ? input.plan.intentMode === "next_page"
        ? normalizeViewedListingIds([...previous.viewedListingIds, ...resultIds])
        : normalizeViewedListingIds(resultIds)
      : input.plan.intentMode === "next_page"
        ? previous.viewedListingIds
        : [];
  const selectedListingContext = toSelectedListingContext({
    previous,
    plan: input.plan,
    semanticIntent: activeSemanticIntent,
    mustAnchorTerms: activeMustAnchorTerms,
    negatedTerms: activeNegatedTerms
  });

  return {
    activeStructuredCriteria,
    activeSemanticIntent,
    activeMustAnchorTerms,
    activeNegatedTerms,
    lastSearchOutcome: outcome,
    lastUserSearchText: input.plan.appliedQueryText ?? previous.lastUserSearchText,
    selectedListingReferenceCode: selectedListingContext.selectedListingReferenceCode,
    selectedListingFactsForContext:
      selectedListingContext.selectedListingFactsForContext,
    viewedListingIds,
    updatedAt: (input.now ?? new Date()).toISOString()
  };
}

function toSearchPlanFilters(
  filters: SearchListingsFilters,
  plan: DecomposedListingSearchPlan
): SearchListingsFilters {
  const queryText = plan.appliedQueryText ?? filters.queryText ?? undefined;

  return {
    ...filters,
    district: plan.structuredFilters.district ?? undefined,
    neighborhood: plan.structuredFilters.neighborhood ?? undefined,
    listingType: plan.structuredFilters.listingType ?? undefined,
    propertyType: plan.structuredFilters.propertyType ?? undefined,
    minPrice: plan.structuredFilters.minPrice ?? undefined,
    maxPrice: plan.structuredFilters.maxPrice ?? undefined,
    minBedrooms: plan.structuredFilters.minBedrooms ?? undefined,
    minBathrooms: plan.structuredFilters.minBathrooms ?? undefined,
    minNetM2: plan.structuredFilters.minNetM2 ?? undefined,
    maxNetM2: plan.structuredFilters.maxNetM2 ?? undefined,
    queryText,
    searchMode: queryText ? "hybrid" : "structured"
  };
}

export function createListingsService(
  repository: ListingsRepository,
  options?: {
    logger?: ListingsLogger;
    queryEmbeddingGenerator?: ListingQueryEmbeddingGenerator;
    searchDocumentsService?: ListingSearchDocumentsService;
    searchRouter?: ListingSearchRouter;
  }
) {
  const logger = options?.logger;
  const queryEmbeddingGenerator = options?.queryEmbeddingGenerator;
  const searchDocumentsService = options?.searchDocumentsService;
  const searchRouter = options?.searchRouter;

  function toListingSearchShortlistItem(
    listing: Awaited<ReturnType<ListingsRepository["search"]>>["listings"][number]
  ): ListingSearchShortlistItem {
    return {
      ...toListingSearchItem(listing),
      dues: toNullableNumber(listing.dues),
      buildingAge: toNullableNumber(listing.buildingAge),
      hasBalcony: listing.hasBalcony,
      hasParking: listing.hasParking,
      hasElevator: listing.hasElevator,
      matchSource: listing.matchSource,
      approximate: listing.approximate,
      cosineDistance: listing.cosineDistance
    };
  }

  function toListingSearchItem(
    listing:
      | Awaited<ReturnType<ListingsRepository["search"]>>["listings"][number]
      | ListingSearchShortlistItem
  ): ListingSearchItem {
    return {
      id: listing.id,
      referenceCode: listing.referenceCode,
      title: listing.title,
      listingType: listing.listingType,
      propertyType: listing.propertyType,
      price: toNullableNumber(listing.price),
      currency: listing.currency,
      bedrooms: toNullableNumber(listing.bedrooms),
      bathrooms: toNullableNumber(listing.bathrooms),
      netM2: toNullableNumber(listing.netM2),
      district: listing.district,
      neighborhood: listing.neighborhood,
      status: listing.status
    };
  }

  async function searchListingsDetailed(
    filters: SearchListingsFilters,
    context?: ListingSearchExecutionContext
  ): Promise<ListingSearchResult> {
    const routerState =
      context?.routerState ?? deriveListingSearchRouterState(context?.searchState);
    const fallbackPlan = decomposeListingSearchPlan(filters, routerState);
    const plan = searchRouter
      ? await searchRouter.decompose(filters, { state: routerState })
      : fallbackPlan;
    const plannedFilters = toSearchPlanFilters(filters, plan);
    const viewedListingIdsForRequest =
      plan.intentMode === "next_page"
        ? context?.searchState?.viewedListingIds ?? []
        : [];
    let queryEmbedding: number[] | undefined;

    if (
      plannedFilters.searchMode === "hybrid" &&
      plannedFilters.queryText &&
      queryEmbeddingGenerator
    ) {
      try {
        const embedding = await queryEmbeddingGenerator.generateQueryEmbedding(
          plannedFilters.queryText
        );

        queryEmbedding = embedding.values;
      } catch (error) {
        logger?.warn(
          {
            event: "hybrid_search_query_embedding_failed",
            officeId: plannedFilters.officeId,
            searchMode: plannedFilters.searchMode,
            queryTextLength: plannedFilters.queryText.length,
            fallback: "continue_without_vector_retrieval",
            errorName:
              error instanceof Error ? error.name : "UnknownError",
            errorCode:
              error instanceof AppError ? error.code : undefined,
            errorMessage:
              error instanceof Error ? error.message : "Unknown error."
          },
          "Hybrid search query embedding failed; continuing without vector retrieval."
        );
        queryEmbedding = undefined;
      }
    }

    const searchResult = await repository.search(plannedFilters, {
      ...(queryEmbedding ? { queryEmbedding } : {}),
      retrievalControls: {
        mustAnchorTerms: plan.mustAnchorTerms,
        negatedTerms: plan.negatedTerms,
        viewedListingIds: viewedListingIdsForRequest
      }
    });

    const result: ListingSearchResult = {
      listings: searchResult.listings.map(toListingSearchShortlistItem),
      matchInterpretation: searchResult.matchInterpretation
    };
    const nextSearchState = mergeListingSearchState(
      context?.searchState
        ? {
            previousState: context.searchState,
            plan,
            result
          }
        : {
            plan,
            result
          }
    );

    context?.onSearchStateResolved?.(nextSearchState);

    return result;
  }

  return {
    searchListingsDetailed,

    async searchListings(
      filters: SearchListingsFilters,
      context?: ListingSearchExecutionContext
    ): Promise<ListingSearchItem[]> {
      const searchResult = await searchListingsDetailed(filters, context);

      return searchResult.listings.map(toListingSearchItem);
    },

    async getListingByReference(
      params: ListingByReferenceParams
    ): Promise<ListingDetail> {
      const lookup = await repository.findByReference(params);

      if (lookup.kind === "ambiguous") {
        throw new AppError(
          "Listing reference code is ambiguous. Please confirm the full code.",
          409,
          "LISTING_REFERENCE_AMBIGUOUS"
        );
      }

      if (lookup.kind === "not_found") {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      const { listing } = lookup;

      return {
        id: listing.id,
        referenceCode: listing.referenceCode,
        title: listing.title,
        listingType: listing.listingType,
        propertyType: listing.propertyType,
        price: toNullableNumber(listing.price),
        currency: listing.currency,
        bedrooms: toNullableNumber(listing.bedrooms),
        bathrooms: toNullableNumber(listing.bathrooms),
        netM2: toNullableNumber(listing.netM2),
        district: listing.district,
        neighborhood: listing.neighborhood,
        status: listing.status,
        description: listing.description,
        grossM2: toNullableNumber(listing.grossM2),
        floorNumber: toNullableNumber(listing.floorNumber),
        buildingAge: toNullableNumber(listing.buildingAge),
        dues: toNullableNumber(listing.dues),
        addressText: listing.addressText,
        hasBalcony: listing.hasBalcony,
        hasParking: listing.hasParking,
        hasElevator: listing.hasElevator
      };
    },

    async refreshMainSearchDocument(
      params: ListingSearchDocumentRefreshParams
    ): Promise<MainListingSearchDocumentRefreshResult> {
      if (!searchDocumentsService) {
        throw new AppError(
          "Listing search document refresh is unavailable.",
          503,
          "SEARCH_DOCUMENT_REFRESH_UNAVAILABLE"
        );
      }

      const listing = await repository.findActiveById(params);

      if (!listing) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      const document = await searchDocumentsService.syncMainDocumentForListing(
        listing.id
      );

      return {
        id: document.id,
        officeId: document.officeId,
        listingId: document.listingId,
        documentType: "main",
        hasEmbedding: document.hasEmbedding,
        embeddingModel: document.embeddingModel,
        embeddingUpdatedAt: document.embeddingUpdatedAt?.toISOString() ?? null,
        updatedAt: document.updatedAt.toISOString()
      };
    }
  };
}

export type ListingsService = ReturnType<typeof createListingsService>;
