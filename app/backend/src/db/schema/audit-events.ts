import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn } from "./_shared.js";
import { offices } from "./offices.js";
import { tenants } from "./tenants.js";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: idColumn(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null"
    }),
    officeId: uuid("office_id").references(() => offices.id, {
      onDelete: "set null"
    }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    payload: jsonb("payload"),
    createdAt: createdAtColumn()
  },
  (table) => ({
    tenantIdx: index("audit_events_tenant_idx").on(table.tenantId),
    officeIdx: index("audit_events_office_idx").on(table.officeId),
    n8nWorkflowRunDedupeIdx: uniqueIndex(
      "audit_events_n8n_workflow_run_dedupe_idx"
    )
      .on(table.officeId, table.action, table.actorType, table.actorId)
      .where(
        sql`${table.actorType} = 'n8n' and ${table.actorId} is not null and ${table.action} in ('booking_result_recorded', 'crm_delivery_result_recorded')`
      )
  })
);
