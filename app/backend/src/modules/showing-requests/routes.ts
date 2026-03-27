import type { FastifyPluginAsync } from "fastify";

import { ok } from "../../lib/http.js";
import { createShowingRequestsRepository } from "./repository.js";
import {
  createShowingRequestsService,
  type ShowingRequestsService
} from "./service.js";
import {
  parseCreateShowingRequestBody,
  parseShowingRequestOfficeParams
} from "./types.js";

interface ShowingRequestsRouteOptions {
  service?: ShowingRequestsService;
}

export const registerShowingRequestsRoutes: FastifyPluginAsync<
  ShowingRequestsRouteOptions
> = async (app, options) => {
  const service =
    options.service ??
    createShowingRequestsService(createShowingRequestsRepository(app.db));

  app.post("/v1/offices/:officeId/showing-requests", async (request, reply) => {
    const { officeId } = parseShowingRequestOfficeParams(request.params);
    const body = parseCreateShowingRequestBody(request.body);

    return reply.status(201).send(
      ok(
        await service.createShowingRequest({
          officeId,
          ...body
        })
      )
    );
  });
};
