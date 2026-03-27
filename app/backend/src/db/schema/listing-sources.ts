import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn } from "./_shared.js";
import { offices } from "./offices.js";

export const listingSources = pgTable(
  "listing_sources",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    syncMode: text("sync_mode").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAtColumn()
  },
  (table) => ({
    officeIdx: index("listing_sources_office_idx").on(table.officeId)
  })
);
