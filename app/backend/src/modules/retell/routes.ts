import type { FastifyPluginAsync } from "fastify";

import { env } from "../../config/env.js";
import { ok } from "../../lib/http.js";
import {
  createN8nBookingWorkflowDispatcherFromEnv
} from "../integrations/dispatcher.js";
import { createIntegrationsRepository } from "../integrations/repository.js";
import { createIntegrationsService, type IntegrationsService } from "../integrations/service.js";
import { createGeminiListingQueryEmbeddingGeneratorFromEnv } from "../listings/embeddings.js";
import { createListingsRepository } from "../listings/repository.js";
import { createListingsService } from "../listings/service.js";
import { createShowingRequestsRepository } from "../showing-requests/repository.js";
import { createShowingRequestsService } from "../showing-requests/service.js";
import { createRetellRepository } from "./repository.js";
import { createRetellService, type RetellService } from "./service.js";

interface RetellRouteOptions {
  service?: RetellService;
  integrationsService?: IntegrationsService;
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export const registerRetellRoutes: FastifyPluginAsync<RetellRouteOptions> = async (
  app,
  options
) => {
  const defaultJsonParser = app.getDefaultJsonParser("ignore", "ignore");

  if (app.hasContentTypeParser("application/json")) {
    app.removeContentTypeParser("application/json");
  }

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = rawBody;
      defaultJsonParser(request, rawBody, done);
    }
  );

  const defaultBookingWorkflowDispatcher =
    createN8nBookingWorkflowDispatcherFromEnv({ logger: app.log });
  const integrationsService =
    options.integrationsService ??
    createIntegrationsService({
      repository: createIntegrationsRepository(app.db),
      ...(defaultBookingWorkflowDispatcher
        ? { bookingWorkflowDispatcher: defaultBookingWorkflowDispatcher }
        : {})
    });
  const service =
    options.service ??
    createRetellService({
      repository: createRetellRepository(app.db),
      listingsService: createListingsService(createListingsRepository(app.db), {
        logger: app.log,
        ...(env.GEMINI_API_KEY
          ? {
              queryEmbeddingGenerator:
                createGeminiListingQueryEmbeddingGeneratorFromEnv()
            }
          : {})
      }),
      showingRequestsService: createShowingRequestsService(
        createShowingRequestsRepository(app.db),
        {
          ...(integrationsService ? { integrationsService } : {})
        }
      )
    });

  app.post("/v1/retell/tools", async (request, reply) => {
    const signature =
      typeof request.headers["x-retell-signature"] === "string"
        ? request.headers["x-retell-signature"]
        : undefined;

    return reply.send(
      await service.executeTool({
        signature,
        body: request.body,
        rawBody: request.rawBody ?? ""
      })
    );
  });

  app.post("/v1/webhooks/retell", async (request) => {
    const signature =
      typeof request.headers["x-retell-signature"] === "string"
        ? request.headers["x-retell-signature"]
        : undefined;

    return ok(
      await service.handleWebhook({
        signature,
        body: request.body,
        rawBody: request.rawBody ?? ""
      })
    );
  });
};
