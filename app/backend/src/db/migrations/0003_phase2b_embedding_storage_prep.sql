ALTER TABLE "listing_search_documents" ADD COLUMN "embedding" real[];--> statement-breakpoint
ALTER TABLE "listing_search_documents" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "listing_search_documents" ADD COLUMN "embedding_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_search_documents" ADD CONSTRAINT "listing_search_documents_embedding_dimension_check" CHECK ("listing_search_documents"."embedding" is null or cardinality("listing_search_documents"."embedding") = 1536);
