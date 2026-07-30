CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TABLE "club_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "club_role" DEFAULT 'member' NOT NULL,
	"position" "club_position",
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_invitations" ADD CONSTRAINT "club_invitations_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_invitations" ADD CONSTRAINT "club_invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_invitations_email_idx" ON "club_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "club_invitations_club_idx" ON "club_invitations" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_invitations_pending_idx" ON "club_invitations" USING btree ("club_id","email") WHERE "club_invitations"."status" = 'pending';