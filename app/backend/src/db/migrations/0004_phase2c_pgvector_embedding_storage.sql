CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "listing_search_documents" DROP CONSTRAINT IF EXISTS "listing_search_documents_embedding_dimension_check";--> statement-breakpoint
ALTER TABLE "listing_search_documents" ALTER COLUMN "embedding" SET DATA TYPE vector(1536) USING CASE
  WHEN "embedding" IS NULL THEN NULL
  ELSE ('[' || array_to_string("embedding", ',') || ']')::vector(1536)
END;
