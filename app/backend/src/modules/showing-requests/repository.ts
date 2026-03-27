import { and, eq } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { listings, showingRequests } from "../../db/schema/index.js";
import { AppError } from "../../lib/errors.js";
import type { CreateShowingRequestInput } from "./types.js";

export function createShowingRequestsRepository(db: Database) {
  return {
    async findOfficeListing(officeId: string, listingId: string) {
      const [listing] = await db
        .select({
          id: listings.id
        })
        .from(listings)
        .where(
          and(eq(listings.officeId, officeId), eq(listings.id, listingId))
        )
        .limit(1);

      return listing ?? null;
    },

    async create(input: CreateShowingRequestInput) {
      const [showingRequest] = await db
        .insert(showingRequests)
        .values({
          officeId: input.officeId,
          listingId: input.listingId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail ?? null,
          preferredDatetime: input.preferredDatetime,
          status: "pending"
        })
        .returning({
          id: showingRequests.id,
          officeId: showingRequests.officeId,
          listingId: showingRequests.listingId,
          customerName: showingRequests.customerName,
          customerPhone: showingRequests.customerPhone,
          customerEmail: showingRequests.customerEmail,
          preferredDatetime: showingRequests.preferredDatetime,
          status: showingRequests.status,
          createdAt: showingRequests.createdAt
        });

      if (!showingRequest) {
        throw new AppError("Failed to create showing request.", 500);
      }

      return showingRequest;
    }
  };
}

export type ShowingRequestsRepository = ReturnType<
  typeof createShowingRequestsRepository
>;
