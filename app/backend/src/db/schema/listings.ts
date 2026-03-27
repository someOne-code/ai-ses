import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { listingSources } from "./listing-sources.js";
import { offices } from "./offices.js";

export const listings = pgTable(
  "listings",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => listingSources.id, {
      onDelete: "set null"
    }),
    externalListingId: text("external_listing_id"),
    referenceCode: text("reference_code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    propertyType: text("property_type"),
    listingType: text("listing_type"),
    status: text("status").notNull().default("active"),
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("TRY"),
    bedrooms: numeric("bedrooms", { precision: 4, scale: 0 }),
    bathrooms: numeric("bathrooms", { precision: 4, scale: 0 }),
    netM2: numeric("net_m2", { precision: 10, scale: 2 }),
    grossM2: numeric("gross_m2", { precision: 10, scale: 2 }),
    floorNumber: numeric("floor_number", { precision: 4, scale: 0 }),
    buildingAge: numeric("building_age", { precision: 4, scale: 0 }),
    dues: numeric("dues", { precision: 12, scale: 2 }),
    district: text("district"),
    neighborhood: text("neighborhood"),
    addressText: text("address_text"),
    hasBalcony: boolean("has_balcony"),
    hasParking: boolean("has_parking"),
    hasElevator: boolean("has_elevator"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    officeIdx: index("listings_office_idx").on(table.officeId),
    officeActiveCreatedIdx: index("listings_office_active_created_idx").on(
      table.officeId,
      table.status,
      table.createdAt
    ),
    idOfficeUnique: unique("listings_id_office_unique").on(
      table.id,
      table.officeId
    ),
    referenceUniqueIdx: uniqueIndex("listings_office_reference_unique").on(
      table.officeId,
      table.referenceCode
    )
  })
);
