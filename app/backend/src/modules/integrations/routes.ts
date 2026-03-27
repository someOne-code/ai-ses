import type { FastifyPluginAsync } from "fastify";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import { secretsMatch } from "../../lib/secrets.js";
import {
  createN8nCrmWorkflowDispatcherFromEnv,
  type CrmWorkflowDispatcher
} from "./dispatcher.js";
import { createIntegrationsRepository } from "./repository.js";
import {
  createIntegrationsService,
  type IntegrationsService
} from "./service.js";
import {
  N8N_CALLBACK_SECRET_HEADER,
  parseBookingResultCallbackBody,
  parseCrmDeliveryCallbackBody
} from "./types.js";

interface IntegrationsRouteOptions {
  service?: IntegrationsService;
  bookingCallbackSecret?: string;
  crmCallbackSecret?: string;
  crmWorkflowDispatcher?: CrmWorkflowDispatcher;
}

function ensureCallbackSecret(
  providedSecret: unknown,
  expectedSecret: string | undefined,
  unavailableCode: string,
  forbiddenCode: string,
  unavailableMessage: string,
  forbiddenMessage: string
) {
  if (!expectedSecret) {
    throw new AppError(unavailableMessage, 503, unavailableCode);
  }

  if (
    typeof providedSecret !== "string" ||
    !secretsMatch(providedSecret, expectedSecret)
  ) {
    throw new AppError(forbiddenMessage, 401, forbiddenCode);
  }
}

export const registerIntegrationsRoutes: FastifyPluginAsync<
  IntegrationsRouteOptions
> = async (app, options) => {
  if (!options.service && !app.hasDecorator("db")) {
    return;
  }

  const crmWorkflowDispatcher =
    options.crmWorkflowDispatcher ??
    createN8nCrmWorkflowDispatcherFromEnv({ logger: app.log });

  const service =
    options.service ??
    createIntegrationsService({
      repository: createIntegrationsRepository(app.db),
      ...(crmWorkflowDispatcher ? { crmWorkflowDispatcher } : {})
    });
  const bookingCallbackSecret =
    options.bookingCallbackSecret ?? env.N8N_BOOKING_CALLBACK_SECRET;
  const crmCallbackSecret =
    options.crmCallbackSecret ?? env.N8N_CRM_CALLBACK_SECRET;

  app.post("/v1/webhooks/n8n/booking-results", async (request) => {
    ensureCallbackSecret(
      request.headers[N8N_CALLBACK_SECRET_HEADER],
      bookingCallbackSecret,
      "N8N_BOOKING_CALLBACK_UNAVAILABLE",
      "N8N_BOOKING_CALLBACK_FORBIDDEN",
      "Booking callback is unavailable.",
      "Invalid booking callback secret."
    );

    const body = parseBookingResultCallbackBody(request.body);

    return ok(await service.handleBookingResultCallback(body));
  });

  app.post("/v1/webhooks/n8n/crm-deliveries", async (request) => {
    ensureCallbackSecret(
      request.headers[N8N_CALLBACK_SECRET_HEADER],
      crmCallbackSecret,
      "N8N_CRM_CALLBACK_UNAVAILABLE",
      "N8N_CRM_CALLBACK_FORBIDDEN",
      "CRM callback is unavailable.",
      "Invalid CRM callback secret."
    );

    const body = parseCrmDeliveryCallbackBody(request.body);

    return ok(await service.handleCrmDeliveryCallback(body));
  });
};
