import type { FastifyPluginAsync } from "fastify";

import { env } from "../../config/env.js";
import { ok } from "../../lib/http.js";
import { createGeminiListingQueryEmbeddingGeneratorFromEnv } from "../listings/embeddings.js";
import { createListingsRepository } from "../listings/repository.js";
import { createListingsService } from "../listings/service.js";
import { createShowingRequestsRepository } from "../showing-requests/repository.js";
import { createShowingRequestsService } from "../showing-requests/service.js";
import { createRetellRepository } from "./repository.js";
import { createRetellService, type RetellService } from "./service.js";

interface RetellRouteOptions {
  service?: RetellService;
}

export const registerRetellRoutes: FastifyPluginAsync<RetellRouteOptions> = async (
  app,
  options
) => {
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
        createShowingRequestsRepository(app.db)
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
        body: request.body
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
        body: request.body
      })
    );
  });
};
