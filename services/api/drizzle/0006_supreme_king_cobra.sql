CREATE TYPE "public"."manual_presence_status" AS ENUM('active', 'idle', 'dnd');--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"manual_status" "manual_presence_status",
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;