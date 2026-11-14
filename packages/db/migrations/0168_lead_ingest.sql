CREATE TABLE "ingest_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"label" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ingest_keys_label_check" CHECK (char_length("ingest_keys"."label") between 1 and 80),
	CONSTRAINT "ingest_keys_key_hash_check" CHECK ("ingest_keys"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingest_keys_key_hint_check" CHECK ("ingest_keys"."key_hint" ~ '^[A-Za-z0-9_-]{4}$'),
	CONSTRAINT "ingest_keys_revoked_check" CHECK (("ingest_keys"."revoked_at" is null) = ("ingest_keys"."revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "ingest_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"field_map_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_question_key" text,
	"consent_text_version" text,
	"consent_channels" text[],
	"consent_purpose" text,
	"page_token_sealed" jsonb,
	"last_questions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_lead_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ingest_sources_provider_check" CHECK ("ingest_sources"."provider" in ('meta_leadgen', 'google_leadform', 'website')),
	CONSTRAINT "ingest_sources_external_id_check" CHECK ("ingest_sources"."external_id" ~ '^[A-Za-z0-9_.:-]{1,200}$'),
	CONSTRAINT "ingest_sources_name_check" CHECK (char_length("ingest_sources"."name") between 1 and 80),
	CONSTRAINT "ingest_sources_field_map_check" CHECK (jsonb_typeof("ingest_sources"."field_map_json") = 'object'),
	CONSTRAINT "ingest_sources_consent_check" CHECK (("ingest_sources"."consent_question_key" is null) = ("ingest_sources"."consent_text_version" is null)
          and ("ingest_sources"."consent_question_key" is null) = ("ingest_sources"."consent_channels" is null)
          and ("ingest_sources"."consent_question_key" is null) = ("ingest_sources"."consent_purpose" is null)),
	CONSTRAINT "ingest_sources_consent_question_check" CHECK ("ingest_sources"."consent_question_key" is null or char_length("ingest_sources"."consent_question_key") between 1 and 200),
	CONSTRAINT "ingest_sources_consent_text_version_check" CHECK ("ingest_sources"."consent_text_version" is null or char_length("ingest_sources"."consent_text_version") between 1 and 60),
	CONSTRAINT "ingest_sources_consent_channels_check" CHECK ("ingest_sources"."consent_channels" is null or (cardinality("ingest_sources"."consent_channels") between 1 and 4
          and "ingest_sources"."consent_channels" <@ array['whatsapp', 'call', 'sms', 'email']::text[])),
	CONSTRAINT "ingest_sources_consent_purpose_check" CHECK ("ingest_sources"."consent_purpose" is null or "ingest_sources"."consent_purpose" in ('service', 'promotional')),
	CONSTRAINT "ingest_sources_page_token_check" CHECK ("ingest_sources"."page_token_sealed" is null or "ingest_sources"."provider" = 'meta_leadgen'),
	CONSTRAINT "ingest_sources_last_questions_check" CHECK (jsonb_typeof("ingest_sources"."last_questions_json") = 'array')
);
--> statement-breakpoint
CREATE TABLE "lead_qualifications" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"pump_depth_ft" integer,
	"required_hp" numeric(6, 2),
	"monthly_bill_rupees" numeric(14, 2),
	"roof_area_sq_ft" integer,
	"sanctioned_load_kw" numeric(8, 2),
	"discom_consumer_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "lead_qualifications_pump_depth_check" CHECK ("lead_qualifications"."pump_depth_ft" is null or "lead_qualifications"."pump_depth_ft" between 1 and 5000),
	CONSTRAINT "lead_qualifications_required_hp_check" CHECK ("lead_qualifications"."required_hp" is null or "lead_qualifications"."required_hp" between 0.5 and 500),
	CONSTRAINT "lead_qualifications_monthly_bill_check" CHECK ("lead_qualifications"."monthly_bill_rupees" is null or "lead_qualifications"."monthly_bill_rupees" between 1 and 100000000),
	CONSTRAINT "lead_qualifications_roof_area_check" CHECK ("lead_qualifications"."roof_area_sq_ft" is null or "lead_qualifications"."roof_area_sq_ft" between 1 and 10000000),
	CONSTRAINT "lead_qualifications_sanctioned_load_check" CHECK ("lead_qualifications"."sanctioned_load_kw" is null or "lead_qualifications"."sanctioned_load_kw" between 0.1 and 100000),
	CONSTRAINT "lead_qualifications_discom_consumer_no_check" CHECK ("lead_qualifications"."discom_consumer_no" is null or "lead_qualifications"."discom_consumer_no" ~ '^[A-Za-z0-9/-]{4,30}$')
);
--> statement-breakpoint
ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_revoked_by_principals_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_keys_key_hash_unique" ON "ingest_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "ingest_keys_entity_idx" ON "ingest_keys" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_sources_external_unique" ON "ingest_sources" USING btree ("provider","external_id") WHERE "ingest_sources"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ingest_sources_entity_idx" ON "ingest_sources" USING btree ("entity_id","provider","name");--> statement-breakpoint
CREATE INDEX "ingest_sources_pipeline_idx" ON "ingest_sources" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "lead_qualifications_entity_idx" ON "lead_qualifications" USING btree ("entity_id");