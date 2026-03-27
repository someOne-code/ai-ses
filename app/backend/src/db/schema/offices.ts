import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { tenants } from "./tenants.js";

export const offices = pgTable(
  "offices",
  {
    id: idColumn(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Europe/Istanbul"),
    phoneNumber: text("phone_number"),
    humanTransferNumber: text("human_transfer_number"),
    status: text("status").notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    tenantIdx: index("offices_tenant_idx").on(table.tenantId)
  })
);
