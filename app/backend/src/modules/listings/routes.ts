import type { FastifyPluginAsync } from "fastify";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { secretsMatch } from "../../lib/secrets.js";
import {
  createGeminiListingEmbeddingGeneratorFromEnv,
  createGeminiListingQueryEmbeddingGeneratorFromEnv,
  type ListingEmbeddingGenerator,
  type ListingQueryEmbeddingGenerator
} from "./embeddings.js";
import { createListingsRepository } from "./repository.js";
import {
  createGeminiListingSearchRouterFromEnv,
  type ListingSearchRouter
} from "./router.js";
import {
  createListingSearchDocumentsRepository,
  createListingSearchDocumentsService
} from "./search-documents.js";
import {
  createListingsService,
  type ListingsService
} from "./service.js";
import {
  parseListingByReferenceParams,
  parseListingOfficeParams,
  parseListingSearchDocumentRefreshParams,
  parseSearchListingsQuery
} from "./types.js";

interface ListingsRouteOptions {
  service?: ListingsService;
  embeddingGenerator?: ListingEmbeddingGenerator;
  queryEmbeddingGenerator?: ListingQueryEmbeddingGenerator;
  searchRouter?: ListingSearchRouter;
  searchDocumentRefreshSecret?: string;
}

const SEARCH_DOCUMENT_REFRESH_HEADER = "x-search-document-refresh-secret";

export const registerListingsRoutes: FastifyPluginAsync<ListingsRouteOptions> = async (
  app,
  options
) => {
  const searchDocumentRefreshSecret =
    options.searchDocumentRefreshSecret ?? env.SEARCH_DOCUMENT_REFRESH_SECRET;
  const service =
    options.service ??
    (() => {
      const defaultEmbeddingGenerator =
        options.embeddingGenerator ??
        (env.GEMINI_API_KEY
          ? createGeminiListingEmbeddingGeneratorFromEnv()
          : undefined);
      const defaultQueryEmbeddingGenerator =
        options.queryEmbeddingGenerator ??
        (env.GEMINI_API_KEY
          ? createGeminiListingQueryEmbeddingGeneratorFromEnv()
          : undefined);
      const defaultSearchRouter =
        options.searchRouter ??
        (env.GEMINI_API_KEY
          ? createGeminiListingSearchRouterFromEnv()
          : undefined);
      const searchDocumentsService =
        defaultEmbeddingGenerator === undefined
          ? undefined
          : createListingSearchDocumentsService(
              createListingSearchDocumentsRepository(app.db),
              {
                embeddingGenerator: defaultEmbeddingGenerator
              }
            );

      return createListingsService(
        createListingsRepository(app.db),
        searchDocumentsService || defaultQueryEmbeddingGenerator
          ? {
              logger: app.log,
              ...(searchDocumentsService ? { searchDocumentsService } : {}),
              ...(defaultQueryEmbeddingGenerator
                ? {
                    queryEmbeddingGenerator: defaultQueryEmbeddingGenerator
                  }
                : {}),
              ...(defaultSearchRouter
                ? {
                    searchRouter: defaultSearchRouter
                  }
                : {})
            }
          : undefined
      );
    })();

  app.get("/v1/offices/:officeId/listings/search", async (request) => {
    const { officeId } = parseListingOfficeParams(request.params);
    const query = parseSearchListingsQuery(request.query);

    return ok(
      await service.searchListings({
        officeId,
        ...query
      })
    );
  });

  app.get(
    "/v1/offices/:officeId/listings/by-reference/:referenceCode",
    async (request) => {
      const params = parseListingByReferenceParams(request.params);

      return ok(await service.getListingByReference(params));
    }
  );

  app.post(
    "/v1/offices/:officeId/listings/:listingId/search-documents/main/refresh",
    async (request) => {
      if (!searchDocumentRefreshSecret) {
        throw new AppError(
          "Listing search document refresh is unavailable.",
          503,
          "SEARCH_DOCUMENT_REFRESH_UNAVAILABLE"
        );
      }

      const providedSecret = request.headers[SEARCH_DOCUMENT_REFRESH_HEADER];

      if (
        typeof providedSecret !== "string" ||
        !secretsMatch(providedSecret, searchDocumentRefreshSecret)
      ) {
        throw new AppError(
          "Invalid listing search document refresh secret.",
          401,
          "SEARCH_DOCUMENT_REFRESH_FORBIDDEN"
        );
      }

      const params = parseListingSearchDocumentRefreshParams(request.params);

      return ok(await service.refreshMainSearchDocument(params));
    }
  );
};
