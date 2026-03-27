import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { offices } from "./offices.js";

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("voice"),
    version: integer("version").notNull().default(1),
    content: text("content").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    officeIdx: index("prompt_versions_office_idx").on(table.officeId),
    versionUniqueIdx: uniqueIndex("prompt_versions_office_name_version_unique")
      .on(table.officeId, table.name, table.version)
  })
);
