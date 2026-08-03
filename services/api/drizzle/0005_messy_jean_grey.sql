CREATE TYPE "public"."expense_category" AS ENUM('food', 'supplies', 'printing', 'travel', 'equipment', 'fees', 'other');--> statement-breakpoint
CREATE TYPE "public"."fund_source" AS ENUM('university', 'dues', 'fundraising', 'sponsorship', 'department', 'other');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'approved', 'purchased', 'settled', 'denied', 'cancelled');--> statement-breakpoint
CREATE TABLE "expense_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"fund_id" text NOT NULL,
	"title" text NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	"category" "expense_category" DEFAULT 'other' NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"requested_amount_cents" integer NOT NULL,
	"actual_amount_cents" integer,
	"needed_by" date,
	"event_id" text,
	"decision_note" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"fund_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"name" text NOT NULL,
	"source" "fund_source" DEFAULT 'university' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"restrictions" text DEFAULT '' NOT NULL,
	"expires_unspent" boolean DEFAULT true NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_requests_club_idx" ON "expense_requests" USING btree ("club_id","created_at");--> statement-breakpoint
CREATE INDEX "expense_requests_fund_idx" ON "expense_requests" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "fund_allocations_fund_idx" ON "fund_allocations" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "funds_club_idx" ON "funds" USING btree ("club_id","starts_on");