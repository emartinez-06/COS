CREATE TYPE "public"."join_link_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "club_join_links" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"token" text NOT NULL,
	"role" "club_role" DEFAULT 'member' NOT NULL,
	"position" "club_position",
	"status" "join_link_status" DEFAULT 'active' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_join_links" ADD CONSTRAINT "club_join_links_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_join_links" ADD CONSTRAINT "club_join_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_join_links_token_idx" ON "club_join_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "club_join_links_club_idx" ON "club_join_links" USING btree ("club_id");