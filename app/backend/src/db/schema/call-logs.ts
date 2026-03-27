import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { boolean } from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn } from "./_shared.js";
import { offices } from "./offices.js";

export const callLogs = pgTable(
  "call_logs",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    providerCallId: text("provider_call_id").notNull(),
    direction: text("direction").notNull().default("inbound"),
    status: text("status").notNull(),
    summary: text("summary"),
    leadIntent: text("lead_intent"),
    leadTemperature: text("lead_temperature"),
    handoffRecommended: boolean("handoff_recommended"),
    budgetKnown: boolean("budget_known"),
    locationKnown: boolean("location_known"),
    timelineKnown: boolean("timeline_known"),
    payload: jsonb("payload"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAtColumn()
  },
  (table) => ({
    officeIdx: index("call_logs_office_idx").on(table.officeId),
    providerCallUniqueIdx: index("call_logs_provider_call_idx").on(
      table.providerCallId
    )
  })
);
