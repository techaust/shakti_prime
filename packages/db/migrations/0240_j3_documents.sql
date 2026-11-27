CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"flow" text NOT NULL,
	"step_key" text NOT NULL,
	"requirement_key" text NOT NULL,
	"mandatory" boolean NOT NULL,
	"accepted_kinds" text[] NOT NULL,
	"position" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "document_requirements_step_key_unique" UNIQUE("entity_id","flow","step_key","requirement_key"),
	CONSTRAINT "document_requirements_flow_check" CHECK ("document_requirements"."flow" in ('standard', 'surya_ghar')),
	CONSTRAINT "document_requirements_step_key_check" CHECK ("document_requirements"."step_key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "document_requirements_requirement_key_check" CHECK ("document_requirements"."requirement_key" in ('electricity_bill', 'identity_proof', 'property_papers', 'site_photos', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof')),
	CONSTRAINT "document_requirements_accepted_kinds_check" CHECK (cardinality("document_requirements"."accepted_kinds") between 1 and 9
          and "document_requirements"."accepted_kinds" <@ array['electricity_bill', 'identity_proof', 'property_papers', 'site_photo', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof']::text[]),
	CONSTRAINT "document_requirements_position_check" CHECK ("document_requirements"."position" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"requirement_key" text,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"sensitive" boolean NOT NULL,
	"filed_by_kind" text NOT NULL,
	"filed_by" uuid NOT NULL,
	"confidence" numeric(4, 3),
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unfiled_at" timestamp with time zone,
	"unfiled_by" uuid,
	"unfiled_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "documents_requirement_key_check" CHECK ("documents"."requirement_key" is null or "documents"."requirement_key" in ('electricity_bill', 'identity_proof', 'property_papers', 'site_photos', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof')),
	CONSTRAINT "documents_kind_check" CHECK ("documents"."kind" in ('electricity_bill', 'identity_proof', 'property_papers', 'site_photo', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof')),
	CONSTRAINT "documents_sensitive_check" CHECK ("documents"."sensitive" or "documents"."kind" not in ('identity_proof', 'bank_proof')),
	CONSTRAINT "documents_filed_by_kind_check" CHECK ("documents"."filed_by_kind" in ('person', 'classifier')),
	CONSTRAINT "documents_confidence_check" CHECK (("documents"."filed_by_kind" = 'person' and "documents"."confidence" is null)
          or ("documents"."filed_by_kind" = 'classifier' and "documents"."confidence" between 0 and 1)),
	CONSTRAINT "documents_unfiled_check" CHECK (("documents"."unfiled_at" is null and "documents"."unfiled_by" is null and "documents"."unfiled_reason" is null)
          or ("documents"."unfiled_at" is not null and "documents"."unfiled_by" is not null
              and length(btrim("documents"."unfiled_reason")) between 3 and 300))
);
--> statement-breakpoint
CREATE TABLE "identity_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last4" text NOT NULL,
	"masked_file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "identity_documents_document_number_unique" UNIQUE("document_id","kind","last4"),
	CONSTRAINT "identity_documents_kind_check" CHECK ("identity_documents"."kind" in ('aadhaar', 'pan', 'bank_proof')),
	CONSTRAINT "identity_documents_last4_check" CHECK ("identity_documents"."last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_filed_by_principals_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_unfiled_by_principals_id_fk" FOREIGN KEY ("unfiled_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_entity_fk" FOREIGN KEY ("file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_document_entity_fk" FOREIGN KEY ("document_id","entity_id") REFERENCES "public"."documents"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_file_entity_fk" FOREIGN KEY ("masked_file_id","entity_id") REFERENCES "public"."files"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_file_filed_unique" ON "documents" USING btree ("file_id") WHERE "documents"."unfiled_at" is null;--> statement-breakpoint
CREATE INDEX "documents_account_filed_idx" ON "documents" USING btree ("entity_id","account_id","filed_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id","requirement_key") WHERE "documents"."project_id" is not null and "documents"."unfiled_at" is null;--> statement-breakpoint
CREATE INDEX "documents_account_idx" ON "documents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "identity_documents_account_idx" ON "identity_documents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "identity_documents_file_idx" ON "identity_documents" USING btree ("masked_file_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_account_idx" ON "files" USING btree ("account_id") WHERE "files"."account_id" is not null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_account_check" CHECK (("files"."purpose" = 'customer_document') = ("files"."account_id" is not null)) NOT VALID;