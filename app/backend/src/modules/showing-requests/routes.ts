import type { FastifyPluginAsync } from "fastify";

import { ok } from "../../lib/http.js";
import {
  createN8nBookingWorkflowDispatcherFromEnv
} from "../integrations/dispatcher.js";
import { createIntegrationsRepository } from "../integrations/repository.js";
import { createIntegrationsService, type IntegrationsService } from "../integrations/service.js";
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
  integrationsService?: IntegrationsService;
}

export const registerShowingRequestsRoutes: FastifyPluginAsync<
  ShowingRequestsRouteOptions
> = async (app, options) => {
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
    createShowingRequestsService(createShowingRequestsRepository(app.db), {
      ...(integrationsService ? { integrationsService } : {})
    });

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
