ALTER TABLE "listing_search_documents" ADD COLUMN "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "listing_search_documents_content_tsv_idx" ON "listing_search_documents" USING gin ("content_tsv");
