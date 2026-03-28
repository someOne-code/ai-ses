import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn } from "./_shared.js";
import { listings } from "./listings.js";
import { offices } from "./offices.js";

export const showingRequests = pgTable(
  "showing_requests",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      ,
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    preferredTimeWindow: text("preferred_time_window"),
    preferredDatetime: timestamp("preferred_datetime", {
      withTimezone: true
    }).notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAtColumn()
  },
  (table) => ({
    officeIdx: index("showing_requests_office_idx").on(table.officeId),
    listingIdx: index("showing_requests_listing_idx").on(table.listingId),
    listingOfficeFk: foreignKey({
      columns: [table.listingId, table.officeId],
      foreignColumns: [listings.id, listings.officeId],
      name: "showing_requests_listing_office_fk"
    }).onDelete("cascade")
  })
);
