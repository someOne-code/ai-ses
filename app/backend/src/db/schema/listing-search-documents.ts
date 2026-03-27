import { sql } from "drizzle-orm";
import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from "drizzle-orm/pg-core";

import { createdAtColumn, idColumn, updatedAtColumn } from "./_shared.js";
import { listings } from "./listings.js";
import { offices } from "./offices.js";

export const LISTING_SEARCH_EMBEDDING_DIMENSION = 1536;
export const LISTING_SEARCH_TSVECTOR_CONFIG = "simple";

const tsvector = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return "tsvector";
  }
});

export const listingSearchDocuments = pgTable(
  "listing_search_documents",
  {
    id: idColumn(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull().default("main"),
    content: text("content").notNull(),
    contentTsv: tsvector("content_tsv")
      .generatedAlwaysAs(
        sql`to_tsvector(${LISTING_SEARCH_TSVECTOR_CONFIG}, coalesce("content", ''))`
      )
      .notNull(),
    embedding: vector("embedding", {
      dimensions: LISTING_SEARCH_EMBEDDING_DIMENSION
    }),
    embeddingModel: text("embedding_model"),
    embeddingUpdatedAt: timestamp("embedding_updated_at", {
      withTimezone: true
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => ({
    officeListingIdx: index("listing_search_documents_office_listing_idx").on(
      table.officeId,
      table.listingId
    ),
    documentTypeIdx: index("listing_search_documents_type_idx").on(
      table.documentType
    ),
    contentTsvIdx: index("listing_search_documents_content_tsv_idx").using(
      "gin",
      table.contentTsv
    ),
    listingDocumentUniqueIdx: uniqueIndex(
      "listing_search_documents_listing_type_unique"
    ).on(table.listingId, table.documentType)
  })
);
