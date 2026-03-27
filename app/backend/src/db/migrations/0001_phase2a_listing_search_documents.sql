CREATE TABLE "listing_search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"document_type" text DEFAULT 'main' NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "listing_search_documents" ADD CONSTRAINT "listing_search_documents_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_search_documents" ADD CONSTRAINT "listing_search_documents_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_search_documents_office_listing_idx" ON "listing_search_documents" USING btree ("office_id","listing_id");--> statement-breakpoint
CREATE INDEX "listing_search_documents_type_idx" ON "listing_search_documents" USING btree ("document_type");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_search_documents_listing_type_unique" ON "listing_search_documents" USING btree ("listing_id","document_type");
