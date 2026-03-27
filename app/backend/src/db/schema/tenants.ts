import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";

export const tenants = pgTable("tenants", {
  id: idColumn(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
