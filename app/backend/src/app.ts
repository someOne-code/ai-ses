import Fastify from "fastify";

import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { dbPlugin } from "./plugins/db.js";
import { createLoggerOptions } from "./lib/logger.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerIntegrationsRoutes } from "./modules/integrations/routes.js";
import type { CrmWorkflowDispatcher } from "./modules/integrations/dispatcher.js";
import type { ListingEmbeddingGenerator } from "./modules/listings/embeddings.js";
import type { ListingQueryEmbeddingGenerator } from "./modules/listings/embeddings.js";
import { registerListingsRoutes } from "./modules/listings/routes.js";
import type { ListingsService } from "./modules/listings/service.js";
import { registerRetellRoutes } from "./modules/retell/routes.js";
import type { RetellService } from "./modules/retell/service.js";
import { registerShowingRequestsRoutes } from "./modules/showing-requests/routes.js";
import type { ShowingRequestsService } from "./modules/showing-requests/service.js";
import type { IntegrationsService } from "./modules/integrations/service.js";

export interface CreateAppOptions {
  bookingCallbackSecret?: string;
  crmCallbackSecret?: string;
  crmWorkflowDispatcher?: CrmWorkflowDispatcher;
  integrationsService?: IntegrationsService;
  registerDatabasePlugin?: boolean;
  readyCheck?: () => Promise<void>;
  listingEmbeddingGenerator?: ListingEmbeddingGenerator;
  listingQueryEmbeddingGenerator?: ListingQueryEmbeddingGenerator;
  listingSearchDocumentRefreshSecret?: string;
  listingsService?: ListingsService;
  retellService?: RetellService;
  showingRequestsService?: ShowingRequestsService;
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({
    logger: createLoggerOptions(env.NODE_ENV)
  });

  if (options.registerDatabasePlugin ?? true) {
    app.register(dbPlugin);
  }

  app.register(
    registerHealthRoutes,
    options.readyCheck ? { readyCheck: options.readyCheck } : {}
  );
  app.register(
    registerIntegrationsRoutes,
    {
      ...(options.integrationsService
        ? { service: options.integrationsService }
        : {}),
      ...(options.bookingCallbackSecret
        ? { bookingCallbackSecret: options.bookingCallbackSecret }
        : {}),
      ...(options.crmCallbackSecret
        ? { crmCallbackSecret: options.crmCallbackSecret }
        : {}),
      ...(options.crmWorkflowDispatcher
        ? { crmWorkflowDispatcher: options.crmWorkflowDispatcher }
        : {})
    }
  );
  app.register(
    registerListingsRoutes,
    {
      ...(options.listingsService
        ? { service: options.listingsService }
        : {}),
      ...(options.listingEmbeddingGenerator
        ? { embeddingGenerator: options.listingEmbeddingGenerator }
        : {}),
      ...(options.listingQueryEmbeddingGenerator
        ? { queryEmbeddingGenerator: options.listingQueryEmbeddingGenerator }
        : {}),
      ...(options.listingSearchDocumentRefreshSecret
        ? {
            searchDocumentRefreshSecret:
              options.listingSearchDocumentRefreshSecret
          }
        : {})
    }
  );
  app.register(
    registerShowingRequestsRoutes,
    {
      ...(options.showingRequestsService
        ? { service: options.showingRequestsService }
        : {})
    }
  );
  app.register(
    registerRetellRoutes,
    {
      ...(options.retellService ? { service: options.retellService } : {})
    }
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const statusCode =
      error instanceof AppError
        ? error.statusCode
        : typeof (error as { statusCode?: number }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
    const code =
      error instanceof AppError
        ? error.code
        : statusCode >= 500
          ? "INTERNAL_ERROR"
          : "REQUEST_ERROR";

    return reply.status(statusCode).send({
      error: {
        code,
        message:
          statusCode >= 500
            ? "Internal server error."
            : error instanceof Error
              ? error.message
              : "Request failed."
      }
    });
  });

  return app;
}
