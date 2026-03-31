import { AppError } from "../../lib/errors.js";
import {
  asLeadIntent,
  asLeadTemperature
} from "../retell/post-call-analysis.js";
import { asPreferredTimeWindow } from "../showing-requests/types.js";

import type {
  BookingWorkflowDispatcher,
  CrmWorkflowDispatcher
} from "./dispatcher.js";
import type { IntegrationsRepository } from "./repository.js";
import {
  BOOKING_RESULT_CALLBACK_PATH,
  BOOKING_WORKFLOW_CONNECTION_KIND,
  CRM_DELIVERY_CALLBACK_PATH,
  CRM_WEBHOOK_CONNECTION_KIND,
  N8N_CALLBACK_SECRET_HEADER,
  type BookingResultCallbackBody,
  type BookingResultCallbackResult,
  type BookingWorkflowContractParams,
  type BookingWorkflowDispatchContract,
  type CrmDeliveryCallbackBody,
  type CrmDeliveryCallbackResult,
  type CrmWebhookContractParams,
  type CrmWebhookDispatchContract,
  type IntegrationConnectionRecord
} from "./types.js";

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

type IntegrationsServiceOptions = {
  repository: IntegrationsRepository;
  bookingWorkflowDispatcher?: BookingWorkflowDispatcher;
  crmWorkflowDispatcher?: CrmWorkflowDispatcher;
};

async function requireOfficeContext(
  repository: IntegrationsRepository,
  officeId: string
) {
  const office = await repository.findOfficeContextById(officeId);

  if (!office) {
    throw new AppError("Office not found.", 404, "OFFICE_NOT_FOUND");
  }

  return office;
}

async function requireActiveConnection(
  repository: IntegrationsRepository,
  officeId: string,
  kind: string
): Promise<IntegrationConnectionRecord> {
  const connections = await repository.findActiveConnectionByKind(officeId, kind);

  if (connections.length === 0) {
    throw new AppError(
      "Active integration connection not found.",
      404,
      "INTEGRATION_CONNECTION_NOT_FOUND"
    );
  }

  if (connections.length > 1) {
    throw new AppError(
      "Multiple active integration connections found for the office and kind.",
      409,
      "INTEGRATION_CONNECTION_AMBIGUOUS"
    );
  }

  return connections[0]!;
}

async function requireConnectionById(
  repository: IntegrationsRepository,
  officeId: string,
  kind: string,
  connectionId: string
): Promise<IntegrationConnectionRecord> {
  const connection = await repository.findConnectionById(
    officeId,
    kind,
    connectionId
  );

  if (!connection) {
    throw new AppError(
      "Integration connection not found.",
      404,
      "INTEGRATION_CONNECTION_NOT_FOUND"
    );
  }

  return connection;
}

function getCrmEventTypeForBookingResult(
  status: BookingResultCallbackBody["status"]
) {
  if (status === "confirmed") {
    return "showing_booking_confirmed" as const;
  }

  return "showing_booking_failed" as const;
}

function getRecordedString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function getRecordedBookingStatus(
  payload: unknown
): BookingResultCallbackBody["status"] | null {
  const value = getRecordedString(payload, "status");

  return value === "confirmed" || value === "failed" || value === "canceled"
    ? value
    : null;
}

function getRecordedDeliveryStatus(
  payload: unknown
): CrmDeliveryCallbackBody["deliveryStatus"] | null {
  const value = getRecordedString(payload, "deliveryStatus");

  return value === "delivered" || value === "failed" || value === "skipped"
    ? value
    : null;
}

function matchesRecordedBookingCallback(
  payload: unknown,
  input: BookingResultCallbackBody
) {
  return (
    getRecordedString(payload, "connectionId") === input.connectionId &&
    getRecordedString(payload, "showingRequestId") === input.showingRequestId &&
    getRecordedBookingStatus(payload) === input.status
  );
}

function matchesRecordedCrmDeliveryCallback(
  payload: unknown,
  input: CrmDeliveryCallbackBody
) {
  return (
    getRecordedString(payload, "connectionId") === input.connectionId &&
    getRecordedString(payload, "entityType") === input.entityType &&
    getRecordedString(payload, "entityId") === input.entityId &&
    getRecordedString(payload, "eventType") === input.eventType &&
    getRecordedDeliveryStatus(payload) === input.deliveryStatus
  );
}

export function createIntegrationsService(options: IntegrationsServiceOptions) {
  const repository = options.repository;

  async function recordBookingDispatchFailure(input: {
    officeId: string;
    showingRequestId: string;
    error: unknown;
  }) {
    const office = await repository.findOfficeContextById(input.officeId);

    await repository.createAuditEvent({
      tenantId: office?.tenantId ?? null,
      officeId: input.officeId,
      actorType: "backend",
      actorId: null,
      action: "booking_dispatch_failed",
      payload: {
        sourceAction: "showing_request_created",
        showingRequestId: input.showingRequestId,
        errorCode:
          input.error instanceof AppError ? input.error.code : null,
        error:
          input.error instanceof Error
            ? input.error.message
            : "Unknown booking dispatch error."
      }
    });
  }

  return {
    async getBookingWorkflowContract(
      params: BookingWorkflowContractParams
    ): Promise<BookingWorkflowDispatchContract> {
      const office = await requireOfficeContext(repository, params.officeId);
      const connection = await requireActiveConnection(
        repository,
        params.officeId,
        BOOKING_WORKFLOW_CONNECTION_KIND
      );
      const showingRequest = await repository.findShowingRequestById(
        params.officeId,
        params.showingRequestId
      );

      if (!showingRequest) {
        throw new AppError(
          "Showing request not found.",
          404,
          "SHOWING_REQUEST_NOT_FOUND"
        );
      }

      return {
        kind: BOOKING_WORKFLOW_CONNECTION_KIND,
        connection: {
          id: connection.id,
          config: connection.config
        },
        office: {
          officeId: office.officeId,
          tenantId: office.tenantId,
          name: office.officeName,
          timezone: office.officeTimezone
        },
        showingRequest: {
          id: showingRequest.id,
          listingId: showingRequest.listingId,
          listingReferenceCode: showingRequest.listingReferenceCode,
          listingTitle: showingRequest.listingTitle,
          listingType: showingRequest.listingType,
          propertyType: showingRequest.propertyType,
          customerName: showingRequest.customerName,
          customerPhone: showingRequest.customerPhone,
          customerEmail: showingRequest.customerEmail,
          preferredTimeWindow: asPreferredTimeWindow(
            showingRequest.preferredTimeWindow
          ),
          preferredDatetime: showingRequest.preferredDatetime.toISOString(),
          status: showingRequest.status,
          createdAt: showingRequest.createdAt.toISOString()
        },
        callback: {
          path: BOOKING_RESULT_CALLBACK_PATH,
          secretHeader: N8N_CALLBACK_SECRET_HEADER,
          secretEnvName: "N8N_BOOKING_CALLBACK_SECRET"
        }
      };
    },

    async dispatchShowingRequestCreated(
      params: BookingWorkflowContractParams
    ): Promise<void> {
      if (!options.bookingWorkflowDispatcher) {
        await recordBookingDispatchFailure({
          officeId: params.officeId,
          showingRequestId: params.showingRequestId,
          error: new AppError(
            "Booking workflow dispatch is unavailable.",
            503,
            "BOOKING_WORKFLOW_DISPATCH_UNAVAILABLE"
          )
        });

        return;
      }

      try {
        const contract = await this.getBookingWorkflowContract(params);

        await options.bookingWorkflowDispatcher.dispatchBookingWorkflow(contract);
      } catch (error) {
        await recordBookingDispatchFailure({
          officeId: params.officeId,
          showingRequestId: params.showingRequestId,
          error
        });
      }
    },

    async getCrmWebhookContract(
      params: CrmWebhookContractParams
    ): Promise<CrmWebhookDispatchContract> {
      const office = await requireOfficeContext(repository, params.officeId);
      const connection = await requireActiveConnection(
        repository,
        params.officeId,
        CRM_WEBHOOK_CONNECTION_KIND
      );

      let entity: CrmWebhookDispatchContract["entity"];

      if (params.entityType === "showing_request") {
        const showingRequest = await repository.findShowingRequestById(
          params.officeId,
          params.entityId
        );

        if (!showingRequest) {
          throw new AppError(
            "CRM sync entity not found.",
            404,
            "CRM_SYNC_ENTITY_NOT_FOUND"
          );
        }

        entity = {
          entityType: "showing_request",
          id: showingRequest.id,
          showingRequestId: showingRequest.id,
          listingId: showingRequest.listingId,
          listingReferenceCode: showingRequest.listingReferenceCode,
          customerName: showingRequest.customerName,
          customerPhone: showingRequest.customerPhone,
          customerEmail: showingRequest.customerEmail,
          preferredTimeWindow: asPreferredTimeWindow(
            showingRequest.preferredTimeWindow
          ),
          preferredDatetime: showingRequest.preferredDatetime.toISOString(),
          status: showingRequest.status
        };
      } else {
        const callLog = await repository.findCallLogById(
          params.officeId,
          params.entityId
        );

        if (!callLog) {
          throw new AppError(
            "CRM sync entity not found.",
            404,
            "CRM_SYNC_ENTITY_NOT_FOUND"
          );
        }

        entity = {
          entityType: "call_log",
          id: callLog.id,
          providerCallId: callLog.providerCallId,
          direction: callLog.direction,
          status: callLog.status,
          summary: callLog.summary,
          leadIntent: asLeadIntent(callLog.leadIntent),
          leadTemperature: asLeadTemperature(callLog.leadTemperature),
          handoffRecommended: callLog.handoffRecommended,
          budgetKnown: callLog.budgetKnown,
          locationKnown: callLog.locationKnown,
          timelineKnown: callLog.timelineKnown,
          startedAt: toIsoString(callLog.startedAt),
          endedAt: toIsoString(callLog.endedAt)
        };
      }

      return {
        kind: CRM_WEBHOOK_CONNECTION_KIND,
        connection: {
          id: connection.id,
          config: connection.config
        },
        office: {
          officeId: office.officeId,
          tenantId: office.tenantId,
          name: office.officeName,
          timezone: office.officeTimezone
        },
        entity,
        event: {
          eventType: params.eventType
        },
        callback: {
          path: CRM_DELIVERY_CALLBACK_PATH,
          secretHeader: N8N_CALLBACK_SECRET_HEADER,
          secretEnvName: "N8N_CRM_CALLBACK_SECRET"
        }
      };
    },

    async handleBookingResultCallback(
      input: BookingResultCallbackBody
    ): Promise<BookingResultCallbackResult> {
      const office = await requireOfficeContext(repository, input.officeId);

      const connection = await requireConnectionById(
        repository,
        input.officeId,
        BOOKING_WORKFLOW_CONNECTION_KIND,
        input.connectionId
      );
      const showingRequest = await repository.findShowingRequestById(
        input.officeId,
        input.showingRequestId
      );

      if (!showingRequest) {
        throw new AppError(
          "Showing request not found.",
          404,
          "SHOWING_REQUEST_NOT_FOUND"
        );
      }

      const bookingAuditPayload = {
        connectionId: connection.id,
        kind: BOOKING_WORKFLOW_CONNECTION_KIND,
        showingRequestId: input.showingRequestId,
        listingId: showingRequest.listingId,
        status: input.status,
        externalBookingId: input.externalBookingId ?? null,
        scheduledDatetime: input.scheduledDatetime ?? null,
        note: input.note ?? null,
        payload: input.payload
      };
      if (input.workflowRunId === undefined) {
        await repository.updateShowingRequestStatus(
          input.officeId,
          input.showingRequestId,
          input.status
        );
        await repository.createAuditEvent({
          tenantId: office.tenantId,
          officeId: input.officeId,
          actorType: "n8n",
          actorId: null,
          action: "booking_result_recorded",
          payload: bookingAuditPayload
        });
      } else {
        const claimResult =
          await repository.claimBookingCallbackRunAndUpdateShowingRequest({
            tenantId: office.tenantId,
            officeId: input.officeId,
            showingRequestId: input.showingRequestId,
            workflowRunId: input.workflowRunId,
            status: input.status,
            payload: bookingAuditPayload
          });

        if (!claimResult.inserted) {
          if (!matchesRecordedBookingCallback(claimResult.recordedPayload, input)) {
            throw new AppError(
              "Booking callback workflow run id was already used for a different payload.",
              409,
              "BOOKING_CALLBACK_WORKFLOW_RUN_CONFLICT"
            );
          }

          return {
            received: true,
            officeId: input.officeId,
            showingRequestId: input.showingRequestId,
            status:
              getRecordedBookingStatus(claimResult.recordedPayload) ?? input.status,
            connectionId:
              getRecordedString(claimResult.recordedPayload, "connectionId") ??
              input.connectionId
          };
        }
      }

      if (options.crmWorkflowDispatcher) {
        try {
          const crmContract = await this.getCrmWebhookContract({
            officeId: input.officeId,
            entityType: "showing_request",
            entityId: input.showingRequestId,
            eventType: getCrmEventTypeForBookingResult(input.status)
          });

          await options.crmWorkflowDispatcher.dispatchCrmWebhook(crmContract);
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === "INTEGRATION_CONNECTION_NOT_FOUND"
          ) {
            return {
              received: true,
              officeId: input.officeId,
              showingRequestId: input.showingRequestId,
              status: input.status,
              connectionId: connection.id
            };
          }

          await repository.createAuditEvent({
            tenantId: office.tenantId,
            officeId: input.officeId,
            actorType: "backend",
            actorId: null,
            action: "crm_dispatch_failed",
            payload: {
              sourceAction: "booking_result_recorded",
              showingRequestId: input.showingRequestId,
              bookingStatus: input.status,
              eventType: getCrmEventTypeForBookingResult(input.status),
              error:
                error instanceof Error ? error.message : "Unknown CRM dispatch error."
            }
          });
        }
      }

      return {
        received: true,
        officeId: input.officeId,
        showingRequestId: input.showingRequestId,
        status: input.status,
        connectionId: connection.id
      };
    },

    async handleCrmDeliveryCallback(
      input: CrmDeliveryCallbackBody
    ): Promise<CrmDeliveryCallbackResult> {
      const office = await requireOfficeContext(repository, input.officeId);

      if (input.workflowRunId) {
        const recordedEvent = await repository.findAuditEventByActor({
          officeId: input.officeId,
          actorType: "n8n",
          actorId: input.workflowRunId,
          action: "crm_delivery_result_recorded"
        });

        if (recordedEvent) {
          if (!matchesRecordedCrmDeliveryCallback(recordedEvent.payload, input)) {
            throw new AppError(
              "CRM callback workflow run id was already used for a different payload.",
              409,
              "CRM_CALLBACK_WORKFLOW_RUN_CONFLICT"
            );
          }

          return {
            received: true,
            officeId: input.officeId,
            entityType: input.entityType,
            entityId: input.entityId,
            deliveryStatus:
              getRecordedDeliveryStatus(recordedEvent.payload) ??
              input.deliveryStatus,
            connectionId:
              getRecordedString(recordedEvent.payload, "connectionId") ??
              input.connectionId
          };
        }
      }

      const connection = await requireConnectionById(
        repository,
        input.officeId,
        CRM_WEBHOOK_CONNECTION_KIND,
        input.connectionId
      );
      const entity =
        input.entityType === "showing_request"
          ? await repository.findShowingRequestById(input.officeId, input.entityId)
          : await repository.findCallLogById(input.officeId, input.entityId);

      if (!entity) {
        throw new AppError(
          "CRM sync entity not found.",
          404,
          "CRM_SYNC_ENTITY_NOT_FOUND"
        );
      }

      const crmAuditPayload = {
        connectionId: connection.id,
        kind: CRM_WEBHOOK_CONNECTION_KIND,
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        deliveryStatus: input.deliveryStatus,
        externalRecordId: input.externalRecordId ?? null,
        note: input.note ?? null,
        payload: input.payload
      };
      const insertedCrmAudit =
        input.workflowRunId === undefined
          ? (await repository.createAuditEvent({
              tenantId: office.tenantId,
              officeId: input.officeId,
              actorType: "n8n",
              actorId: null,
              action: "crm_delivery_result_recorded",
              payload: crmAuditPayload
            }),
            true)
          : Boolean(
              await repository.createAuditEventIfAbsent({
                tenantId: office.tenantId,
                officeId: input.officeId,
                actorType: "n8n",
                actorId: input.workflowRunId,
                action: "crm_delivery_result_recorded",
                payload: crmAuditPayload
              })
            );

      if (!insertedCrmAudit) {
        const recordedEvent = await repository.findAuditEventByActor({
          officeId: input.officeId,
          actorType: "n8n",
          actorId: input.workflowRunId!,
          action: "crm_delivery_result_recorded"
        });

        if (!matchesRecordedCrmDeliveryCallback(recordedEvent?.payload, input)) {
          throw new AppError(
            "CRM callback workflow run id was already used for a different payload.",
            409,
            "CRM_CALLBACK_WORKFLOW_RUN_CONFLICT"
          );
        }

        return {
          received: true,
          officeId: input.officeId,
          entityType: input.entityType,
          entityId: input.entityId,
          deliveryStatus: input.deliveryStatus,
          connectionId: connection.id
        };
      }

      return {
        received: true,
        officeId: input.officeId,
        entityType: input.entityType,
        entityId: input.entityId,
        deliveryStatus: input.deliveryStatus,
        connectionId: connection.id
      };
    }
  };
}

export type IntegrationsService = ReturnType<typeof createIntegrationsService>;
