CREATE TABLE "document_crdt_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"update" "bytea" NOT NULL,
	"authored_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_crdt_updates" ADD CONSTRAINT "document_crdt_updates_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_crdt_updates" ADD CONSTRAINT "document_crdt_updates_authored_by_user_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_crdt_updates_document_id_idx" ON "document_crdt_updates" USING btree ("document_id","created_at");