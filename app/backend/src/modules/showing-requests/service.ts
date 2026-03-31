import { AppError } from "../../lib/errors.js";
import type { IntegrationsService } from "../integrations/service.js";

import type { ShowingRequestsRepository } from "./repository.js";
import type {
  CreateShowingRequestInput,
  ShowingRequestRecord
} from "./types.js";
import { asPreferredTimeWindow } from "./types.js";

function toIsoString(value: Date): string {
  return value.toISOString();
}

export function createShowingRequestsService(
  repository: ShowingRequestsRepository,
  options: {
    integrationsService?: Pick<IntegrationsService, "dispatchShowingRequestCreated">;
  } = {}
) {
  return {
    async createShowingRequest(
      input: CreateShowingRequestInput
    ): Promise<ShowingRequestRecord> {
      const listing = await repository.findOfficeListing(
        input.officeId,
        input.listingId
      );

      if (!listing) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      const showingRequest = await repository.create({
        ...input,
        customerEmail: input.customerEmail ?? undefined
      });

      if (!showingRequest) {
        throw new AppError("Failed to create showing request.", 500);
      }

      const record = {
        id: showingRequest.id,
        officeId: showingRequest.officeId,
        listingId: showingRequest.listingId,
        customerName: showingRequest.customerName,
        customerPhone: showingRequest.customerPhone,
        customerEmail: showingRequest.customerEmail,
        preferredTimeWindow: asPreferredTimeWindow(
          showingRequest.preferredTimeWindow
        ),
        preferredDatetime: toIsoString(showingRequest.preferredDatetime),
        status: showingRequest.status,
        createdAt: toIsoString(showingRequest.createdAt)
      };

      if (options.integrationsService) {
        try {
          await options.integrationsService.dispatchShowingRequestCreated({
            officeId: record.officeId,
            showingRequestId: record.id
          });
        } catch {
          // Persistence already succeeded; downstream booking fan-out must not
          // turn a stored showing request into a false creation failure.
        }
      }

      return record;
    }
  };
}

export type ShowingRequestsService = ReturnType<
  typeof createShowingRequestsService
>;
