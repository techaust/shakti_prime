CREATE TABLE "playbook_conflict_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"directive_id" uuid NOT NULL,
	"other_id" uuid NOT NULL,
	"distance" real NOT NULL,
	"label" text,
	"reason" text,
	"resolution" text,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playbook_conflict_checks_pair_unique" UNIQUE("directive_id","other_id"),
	CONSTRAINT "playbook_conflict_checks_label_check" CHECK ("playbook_conflict_checks"."label" in ('conflict', 'overlap', 'none')),
	CONSTRAINT "playbook_conflict_checks_resolution_check" CHECK ("playbook_conflict_checks"."resolution" in ('not_a_conflict', 'other_retired')),
	CONSTRAINT "playbook_conflict_checks_pair_check" CHECK ("playbook_conflict_checks"."directive_id" <> "playbook_conflict_checks"."other_id"),
	CONSTRAINT "playbook_conflict_checks_distance_check" CHECK ("playbook_conflict_checks"."distance" between 0 and 2),
	CONSTRAINT "playbook_conflict_checks_reason_check" CHECK (("playbook_conflict_checks"."label" is null) = ("playbook_conflict_checks"."reason" is null) and char_length("playbook_conflict_checks"."reason") between 1 and 300),
	CONSTRAINT "playbook_conflict_checks_resolved_check" CHECK (("playbook_conflict_checks"."resolution" is null) = ("playbook_conflict_checks"."resolved_at" is null) and ("playbook_conflict_checks"."resolved_at" is null) = ("playbook_conflict_checks"."resolved_by" is null) and ("playbook_conflict_checks"."resolution" is null or coalesce("playbook_conflict_checks"."label", '') <> 'none')),
	CONSTRAINT "playbook_conflict_checks_note_check" CHECK ("playbook_conflict_checks"."resolution_note" is null or (char_length("playbook_conflict_checks"."resolution_note") between 1 and 300 and "playbook_conflict_checks"."resolution" is not null))
);
--> statement-breakpoint
CREATE TABLE "playbook_directives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"type" text NOT NULL,
	"audience" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"source_file_id" uuid,
	"source_position" integer,
	"state" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"retired_reason" text,
	"retired_at" timestamp with time zone,
	"conflicts_with" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"embedding" vector(1024),
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "playbook_directives_type_check" CHECK ("playbook_directives"."type" in ('policy', 'priority', 'target', 'sop', 'faq', 'tone')),
	CONSTRAINT "playbook_directives_audience_check" CHECK ("playbook_directives"."audience" in ('customer', 'staff', 'management')),
	CONSTRAINT "playbook_directives_state_check" CHECK ("playbook_directives"."state" in ('draft', 'approved', 'retired')),
	CONSTRAINT "playbook_directives_title_check" CHECK (char_length("playbook_directives"."title") between 1 and 120),
	CONSTRAINT "playbook_directives_text_check" CHECK (char_length("playbook_directives"."text") between 1 and 2000),
	CONSTRAINT "playbook_directives_source_check" CHECK ("playbook_directives"."source_position" is null or ("playbook_directives"."source_file_id" is not null and "playbook_directives"."source_position" >= 0)),
	CONSTRAINT "playbook_directives_approval_check" CHECK (("playbook_directives"."approved_by" is null) = ("playbook_directives"."approved_at" is null) and ("playbook_directives"."state" <> 'approved' or "playbook_directives"."approved_at" is not null) and ("playbook_directives"."state" <> 'draft' or "playbook_directives"."approved_at" is null)),
	CONSTRAINT "playbook_directives_retired_check" CHECK (("playbook_directives"."state" <> 'retired') = ("playbook_directives"."retired_at" is null) and ("playbook_directives"."retired_at" is null) = ("playbook_directives"."retired_reason" is null) and char_length("playbook_directives"."retired_reason") between 1 and 300),
	CONSTRAINT "playbook_directives_approved_checked" CHECK ("playbook_directives"."state" <> 'approved' or "playbook_directives"."checked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "playbook_conflict_checks" ADD CONSTRAINT "playbook_conflict_checks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_conflict_checks" ADD CONSTRAINT "playbook_conflict_checks_directive_id_playbook_directives_id_fk" FOREIGN KEY ("directive_id") REFERENCES "public"."playbook_directives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_conflict_checks" ADD CONSTRAINT "playbook_conflict_checks_other_id_playbook_directives_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."playbook_directives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_conflict_checks" ADD CONSTRAINT "playbook_conflict_checks_resolved_by_principals_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_directives" ADD CONSTRAINT "playbook_directives_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_directives" ADD CONSTRAINT "playbook_directives_source_file_id_knowledge_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."knowledge_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_directives" ADD CONSTRAINT "playbook_directives_approved_by_principals_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_directives" ADD CONSTRAINT "playbook_directives_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_directives" ADD CONSTRAINT "playbook_directives_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playbook_conflict_checks_other_idx" ON "playbook_conflict_checks" USING btree ("other_id");--> statement-breakpoint
CREATE INDEX "playbook_directives_state_type_idx" ON "playbook_directives" USING btree ("state","type","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "playbook_directives_source_file_idx" ON "playbook_directives" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "playbook_directives_embedding_idx" ON "playbook_directives" USING hnsw ("embedding" vector_cosine_ops);