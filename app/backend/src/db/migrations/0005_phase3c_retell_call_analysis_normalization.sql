ALTER TABLE "call_logs" ADD COLUMN "lead_intent" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "lead_temperature" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "handoff_recommended" boolean;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "budget_known" boolean;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "location_known" boolean;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "timeline_known" boolean;