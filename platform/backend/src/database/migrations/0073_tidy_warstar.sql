ALTER TABLE "tools" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "category_auto_assigned" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "categorized_at" timestamp;