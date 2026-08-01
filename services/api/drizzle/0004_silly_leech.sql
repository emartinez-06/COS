CREATE TYPE "public"."document_kind" AS ENUM('text', 'file');--> statement-breakpoint
CREATE TYPE "public"."document_section" AS ENUM('rules', 'onboarding', 'meeting_notes', 'forms', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text,
	"storage_key" text,
	"file_name" text,
	"content_type" text,
	"byte_size" integer,
	"authored_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revisions_one_body" CHECK (("document_revisions"."content" is not null) <> ("document_revisions"."storage_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"section" "document_section" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"storage_key" text,
	"file_name" text,
	"content_type" text,
	"byte_size" integer,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_authored_by_user_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_version_idx" ON "document_revisions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_club_section_idx" ON "documents" USING btree ("club_id","section","title") WHERE "documents"."deleted_at" is null;