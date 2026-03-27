import {
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

export const idColumn = () => uuid("id").primaryKey().defaultRandom();

export const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
