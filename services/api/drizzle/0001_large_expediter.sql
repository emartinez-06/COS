CREATE TYPE "public"."event_category" AS ENUM('meeting', 'social', 'service', 'workshop', 'fundraiser');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('members', 'public');--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"speaker" jsonb,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" "event_category" DEFAULT 'meeting' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'members' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_club_starts_idx" ON "events" USING btree ("club_id","starts_at");