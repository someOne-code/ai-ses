CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"phone_number" text,
	"human_transfer_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_number_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"provider" text DEFAULT 'retell' NOT NULL,
	"external_phone_id" text,
	"phone_number" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'voice' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"sync_mode" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"source_id" uuid,
	"external_listing_id" text,
	"reference_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"property_type" text,
	"listing_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"price" numeric(14, 2),
	"currency" text DEFAULT 'TRY' NOT NULL,
	"bedrooms" numeric(4, 0),
	"bathrooms" numeric(4, 0),
	"net_m2" numeric(10, 2),
	"gross_m2" numeric(10, 2),
	"floor_number" numeric(4, 0),
	"building_age" numeric(4, 0),
	"dues" numeric(12, 2),
	"district" text,
	"neighborhood" text,
	"address_text" text,
	"has_balcony" boolean,
	"has_parking" boolean,
	"has_elevator" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_id_office_unique" UNIQUE("id","office_id")
);
--> statement-breakpoint
CREATE TABLE "showing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"preferred_datetime" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"provider_call_id" text NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"payload" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"office_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_number_mappings" ADD CONSTRAINT "phone_number_mappings_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_sources" ADD CONSTRAINT "listing_sources_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source_id_listing_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."listing_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showing_requests" ADD CONSTRAINT "showing_requests_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showing_requests" ADD CONSTRAINT "showing_requests_listing_office_fk" FOREIGN KEY ("listing_id","office_id") REFERENCES "public"."listings"("id","office_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offices_tenant_idx" ON "offices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "phone_number_mappings_office_idx" ON "phone_number_mappings" USING btree ("office_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_number_mappings_phone_unique" ON "phone_number_mappings" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "prompt_versions_office_idx" ON "prompt_versions" USING btree ("office_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_office_name_version_unique" ON "prompt_versions" USING btree ("office_id","name","version");--> statement-breakpoint
CREATE INDEX "integration_connections_office_idx" ON "integration_connections" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "listing_sources_office_idx" ON "listing_sources" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "listings_office_idx" ON "listings" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "listings_office_active_created_idx" ON "listings" USING btree ("office_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_office_reference_unique" ON "listings" USING btree ("office_id","reference_code");--> statement-breakpoint
CREATE INDEX "showing_requests_office_idx" ON "showing_requests" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "showing_requests_listing_idx" ON "showing_requests" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "call_logs_office_idx" ON "call_logs" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "call_logs_provider_call_idx" ON "call_logs" USING btree ("provider_call_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_events_office_idx" ON "audit_events" USING btree ("office_id");
