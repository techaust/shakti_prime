CREATE TABLE "item_vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"vendor_item_code" text,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "item_vendors_item_vendor_unique" UNIQUE("item_id","vendor_id"),
	CONSTRAINT "item_vendors_code_check" CHECK ("item_vendors"."vendor_item_code" is null or length(btrim("item_vendors"."vendor_item_code")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "vendor_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone_e164" text,
	"email" text,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "vendor_contacts_vendor_position_unique" UNIQUE("vendor_id","position"),
	CONSTRAINT "vendor_contacts_name_check" CHECK (length(btrim("vendor_contacts"."name")) between 2 and 120),
	CONSTRAINT "vendor_contacts_role_check" CHECK ("vendor_contacts"."role" is null or length("vendor_contacts"."role") <= 80),
	CONSTRAINT "vendor_contacts_phone_check" CHECK ("vendor_contacts"."phone_e164" is null or "vendor_contacts"."phone_e164" ~ '^\+[1-9]\d{6,14}$'),
	CONSTRAINT "vendor_contacts_email_check" CHECK ("vendor_contacts"."email" is null or (length("vendor_contacts"."email") <= 254 and "vendor_contacts"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
	CONSTRAINT "vendor_contacts_position_check" CHECK ("vendor_contacts"."position" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "vendor_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"entity_id" smallint,
	"rate" numeric(14, 4) NOT NULL,
	"moq" numeric(12, 3),
	"lead_time_days" smallint,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"file_id" uuid,
	"recorded_by" uuid NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_quotes_rate_check" CHECK ("vendor_quotes"."rate" > 0),
	CONSTRAINT "vendor_quotes_moq_check" CHECK ("vendor_quotes"."moq" is null or "vendor_quotes"."moq" > 0),
	CONSTRAINT "vendor_quotes_lead_time_check" CHECK ("vendor_quotes"."lead_time_days" is null or "vendor_quotes"."lead_time_days" between 0 and 365),
	CONSTRAINT "vendor_quotes_validity_check" CHECK ("vendor_quotes"."valid_until" >= "vendor_quotes"."valid_from"),
	CONSTRAINT "vendor_quotes_withdrawn_check" CHECK (("vendor_quotes"."withdrawn_at" is null) = ("vendor_quotes"."withdrawn_by" is null))
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"state_code" text,
	"pan" text,
	"address_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_terms_days" smallint,
	"lead_time_days" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "vendors_name_check" CHECK (length(btrim("vendors"."name")) between 2 and 160),
	CONSTRAINT "vendors_gstin_check" CHECK ("vendors"."gstin" is null or ("vendors"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
          and "vendors"."state_code" = left("vendors"."gstin", 2))),
	CONSTRAINT "vendors_state_code_check" CHECK ("vendors"."state_code" is null or "vendors"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "vendors_pan_check" CHECK ("vendors"."pan" is null or ("vendors"."pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
          and ("vendors"."gstin" is null or "vendors"."pan" = substr("vendors"."gstin", 3, 10)))),
	CONSTRAINT "vendors_address_object_check" CHECK (jsonb_typeof("vendors"."address_json") = 'object'),
	CONSTRAINT "vendors_payment_terms_check" CHECK ("vendors"."payment_terms_days" is null or "vendors"."payment_terms_days" between 0 and 365),
	CONSTRAINT "vendors_lead_time_check" CHECK ("vendors"."lead_time_days" is null or "vendors"."lead_time_days" between 0 and 365),
	CONSTRAINT "vendors_notes_check" CHECK ("vendors"."notes" is null or length("vendors"."notes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_recorded_by_principals_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotes" ADD CONSTRAINT "vendor_quotes_withdrawn_by_principals_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_vendors_one_preferred" ON "item_vendors" USING btree ("item_id") WHERE "item_vendors"."is_preferred";--> statement-breakpoint
CREATE INDEX "item_vendors_vendor_idx" ON "item_vendors" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_quotes_item_idx" ON "vendor_quotes" USING btree ("item_id","vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_quotes_vendor_idx" ON "vendor_quotes" USING btree ("vendor_id","valid_until");--> statement-breakpoint
CREATE INDEX "vendor_quotes_entity_idx" ON "vendor_quotes" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "vendor_quotes_file_idx" ON "vendor_quotes" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_gstin_unique" ON "vendors" USING btree ("gstin") WHERE "vendors"."gstin" is not null;--> statement-breakpoint
CREATE INDEX "vendors_name_trgm_idx" ON "vendors" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vendors_active_name_idx" ON "vendors" USING btree ("is_active","name","id");