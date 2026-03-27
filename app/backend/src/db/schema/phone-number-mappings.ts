import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { offices } from "./offices.js";

export const phoneNumberMappings = pgTable(
  "phone_number_mappings",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("retell"),
    externalPhoneId: text("external_phone_id"),
    phoneNumber: text("phone_number").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    officeIdx: index("phone_number_mappings_office_idx").on(table.officeId),
    phoneUniqueIdx: uniqueIndex("phone_number_mappings_phone_unique").on(
      table.phoneNumber
    )
  })
);
