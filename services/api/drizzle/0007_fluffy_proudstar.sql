CREATE TYPE "public"."canvas_accent_color" AS ENUM('red', 'orange', 'green', 'teal', 'purple', 'pink');--> statement-breakpoint
CREATE TYPE "public"."canvas_embed_entity_type" AS ENUM('calendar', 'documents', 'expenses');--> statement-breakpoint
CREATE TYPE "public"."canvas_node_type" AS ENUM('sticky_note', 'link', 'image', 'entity_embed');--> statement-breakpoint
CREATE TYPE "public"."canvas_sticky_note_color" AS ENUM('yellow', 'pink', 'blue', 'green', 'purple');--> statement-breakpoint
CREATE TABLE "canvas_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"club_id" text NOT NULL,
	"viewport_x" integer DEFAULT 0 NOT NULL,
	"viewport_y" integer DEFAULT 0 NOT NULL,
	"viewport_zoom" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"node_type" "canvas_node_type" NOT NULL,
	"position_x" integer NOT NULL,
	"position_y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"accent_color" "canvas_accent_color",
	"sticky_note_text" text,
	"sticky_note_color" "canvas_sticky_note_color",
	"link_url" text,
	"link_title" text,
	"image_storage_key" text,
	"embed_entity_type" "canvas_embed_entity_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_boards" ADD CONSTRAINT "canvas_boards_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_board_id_canvas_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."canvas_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_board_id_canvas_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."canvas_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_source_node_id_canvas_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_target_node_id_canvas_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_boards_club_idx" ON "canvas_boards" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "canvas_nodes_board_idx" ON "canvas_nodes" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "canvas_edges_board_idx" ON "canvas_edges" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_edges_unique_pair_idx" ON "canvas_edges" USING btree ("board_id","source_node_id","target_node_id");