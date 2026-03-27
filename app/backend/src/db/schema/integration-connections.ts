import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { offices } from "./offices.js";

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    config: jsonb("config"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    officeIdx: index("integration_connections_office_idx").on(table.officeId)
  })
);
