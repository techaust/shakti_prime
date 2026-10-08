CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"knowledge_file_id" uuid NOT NULL,
	"entity_id" smallint,
	"sensitivity" text NOT NULL,
	"position" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_file_position_unique" UNIQUE("knowledge_file_id","position"),
	CONSTRAINT "knowledge_chunks_sensitivity_check" CHECK ("knowledge_chunks"."sensitivity" in ('staff_ai_ok', 'management', 'exec_only')),
	CONSTRAINT "knowledge_chunks_position_check" CHECK ("knowledge_chunks"."position" >= 0),
	CONSTRAINT "knowledge_chunks_text_check" CHECK (char_length("knowledge_chunks"."chunk_text") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "knowledge_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sensitivity" text NOT NULL,
	"source_type" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp with time zone,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "knowledge_files_file_unique" UNIQUE("file_id"),
	CONSTRAINT "knowledge_files_sensitivity_check" CHECK ("knowledge_files"."sensitivity" in ('staff_ai_ok', 'management', 'exec_only')),
	CONSTRAINT "knowledge_files_source_type_check" CHECK ("knowledge_files"."source_type" in ('pdf', 'photo', 'word', 'excel')),
	CONSTRAINT "knowledge_files_state_check" CHECK ("knowledge_files"."state" in ('waiting', 'indexed', 'failed', 'unavailable', 'archived')),
	CONSTRAINT "knowledge_files_error_reason_check" CHECK ("knowledge_files"."error_reason" in ('knowledge_file_rejected', 'knowledge_unreadable', 'knowledge_empty', 'knowledge_too_long', 'knowledge_spend_cap_reached', 'knowledge_service_missing', 'knowledge_timed_out')),
	CONSTRAINT "knowledge_files_title_check" CHECK (char_length("knowledge_files"."title") between 1 and 200),
	CONSTRAINT "knowledge_files_chunks_check" CHECK ("knowledge_files"."chunks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledge_file_id_knowledge_files_id_fk" FOREIGN KEY ("knowledge_file_id") REFERENCES "public"."knowledge_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_files_entity_created_idx" ON "knowledge_files" USING btree ("entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);