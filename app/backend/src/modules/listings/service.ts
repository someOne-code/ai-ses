import { AppError } from "../../lib/errors.js";

import type { ListingQueryEmbeddingGenerator } from "./embeddings.js";
import type { ListingSearchDocumentsService } from "./search-documents.js";
import type { ListingsRepository } from "./repository.js";
import type {
  ListingDetail,
  ListingSearchDocumentRefreshParams,
  MainListingSearchDocumentRefreshResult,
  ListingSearchResult,
  ListingSearchItem,
  ListingByReferenceParams,
  SearchListingsFilters
} from "./types.js";

function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

interface ListingsLogger {
  warn(bindings: Record<string, unknown>, message: string): void;
}

export function createListingsService(
  repository: ListingsRepository,
  options?: {
    logger?: ListingsLogger;
    queryEmbeddingGenerator?: ListingQueryEmbeddingGenerator;
    searchDocumentsService?: ListingSearchDocumentsService;
  }
) {
  const logger = options?.logger;
  const queryEmbeddingGenerator = options?.queryEmbeddingGenerator;
  const searchDocumentsService = options?.searchDocumentsService;

  function toListingSearchItem(
    listing: Awaited<ReturnType<ListingsRepository["search"]>>["listings"][number]
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
    filters: SearchListingsFilters
  ): Promise<ListingSearchResult> {
    let queryEmbedding: number[] | undefined;

    if (
      filters.searchMode === "hybrid" &&
      filters.queryText &&
      queryEmbeddingGenerator
    ) {
      try {
        const embedding = await queryEmbeddingGenerator.generateQueryEmbedding(
          filters.queryText
        );

        queryEmbedding = embedding.values;
      } catch (error) {
        logger?.warn(
          {
            event: "hybrid_search_query_embedding_failed",
            officeId: filters.officeId,
            searchMode: filters.searchMode,
            queryTextLength: filters.queryText.length,
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

    const searchResult = await repository.search(
      filters,
      queryEmbedding ? { queryEmbedding } : undefined
    );

    return {
      listings: searchResult.listings.map(toListingSearchItem),
      matchInterpretation: searchResult.matchInterpretation
    };
  }

  return {
    searchListingsDetailed,

    async searchListings(filters: SearchListingsFilters): Promise<ListingSearchItem[]> {
      const searchResult = await searchListingsDetailed(filters);

      return searchResult.listings;
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
