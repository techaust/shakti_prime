CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid,
	"kit_id" uuid,
	"sku" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"hsn" text,
	"works_contract" boolean DEFAULT false NOT NULL,
	"tax_rate_id" uuid,
	"tax_rate_pct" numeric(5, 2),
	"composite_rule_id" uuid,
	"goods_rate_pct" numeric(5, 2),
	"services_rate_pct" numeric(5, 2),
	"taxable_value" numeric(14, 2) NOT NULL,
	"goods_taxable" numeric(14, 2),
	"services_taxable" numeric(14, 2),
	"cgst" numeric(14, 2) NOT NULL,
	"sgst" numeric(14, 2) NOT NULL,
	"igst" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_quote_position_unique" UNIQUE("quote_id","position"),
	CONSTRAINT "quote_lines_target_check" CHECK (("quote_lines"."item_id" is null) <> ("quote_lines"."kit_id" is null)),
	CONSTRAINT "quote_lines_position_check" CHECK ("quote_lines"."position" >= 1),
	CONSTRAINT "quote_lines_qty_check" CHECK ("quote_lines"."qty" > 0),
	CONSTRAINT "quote_lines_unit_check" CHECK ("quote_lines"."unit" in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')),
	CONSTRAINT "quote_lines_hsn_check" CHECK ("quote_lines"."hsn" is null or "quote_lines"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
	CONSTRAINT "quote_lines_tax_check" CHECK (("quote_lines"."tax_rate_id" is not null and "quote_lines"."tax_rate_pct" is not null and "quote_lines"."composite_rule_id" is null and "quote_lines"."goods_rate_pct" is null and "quote_lines"."services_rate_pct" is null and "quote_lines"."goods_taxable" is null and "quote_lines"."services_taxable" is null)
       or ("quote_lines"."tax_rate_id" is null and "quote_lines"."tax_rate_pct" is null and "quote_lines"."composite_rule_id" is not null and "quote_lines"."works_contract" and "quote_lines"."goods_rate_pct" is not null and "quote_lines"."services_rate_pct" is not null and "quote_lines"."goods_taxable" is not null and "quote_lines"."services_taxable" is not null)),
	CONSTRAINT "quote_lines_amounts_check" CHECK ("quote_lines"."unit_price" >= 0 and "quote_lines"."taxable_value" >= 0 and "quote_lines"."cgst" >= 0 and "quote_lines"."sgst" >= 0 and "quote_lines"."igst" >= 0 and "quote_lines"."line_total" = "quote_lines"."taxable_value" + "quote_lines"."cgst" + "quote_lines"."sgst" + "quote_lines"."igst")
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "quote_versions_quote_version_unique" UNIQUE("quote_id","version"),
	CONSTRAINT "quote_versions_version_check" CHECK ("quote_versions"."version" >= 1),
	CONSTRAINT "quote_versions_snapshot_check" CHECK (jsonb_typeof("quote_versions"."snapshot_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"quote_no" text NOT NULL,
	"fy" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"site_id" uuid,
	"sizing_id" uuid,
	"tier_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"place_of_supply_state" text NOT NULL,
	"supply_kind" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) NOT NULL,
	"sgst" numeric(14, 2) NOT NULL,
	"igst" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"round_off" numeric(14, 2) NOT NULL,
	"grand_total" numeric(14, 2) NOT NULL,
	"pdf_file_id" uuid,
	"supersedes_id" uuid,
	"withdrawn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "quotes_entity_quote_no_unique" UNIQUE("entity_id","quote_no"),
	CONSTRAINT "quotes_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "quotes_state_check" CHECK ("quotes"."state" in ('draft', 'sent', 'accepted', 'expired', 'superseded', 'withdrawn')),
	CONSTRAINT "quotes_scheme_check" CHECK ("quotes"."scheme" in ('none', 'pm_surya_ghar', 'pm_kusum')),
	CONSTRAINT "quotes_supply_kind_check" CHECK ("quotes"."supply_kind" in ('intra', 'inter')),
	CONSTRAINT "quotes_place_of_supply_check" CHECK ("quotes"."place_of_supply_state" ~ '^[0-9]{2}$'),
	CONSTRAINT "quotes_fy_check" CHECK ("quotes"."fy" ~ '^[0-9]{4}-[0-9]{2}$' and right("quotes"."fy", 2)::int = (left("quotes"."fy", 4)::int + 1) % 100),
	CONSTRAINT "quotes_totals_check" CHECK ("quotes"."subtotal" >= 0 and "quotes"."cgst" >= 0 and "quotes"."sgst" >= 0 and "quotes"."igst" >= 0 and "quotes"."tax_total" = "quotes"."cgst" + "quotes"."sgst" + "quotes"."igst" and "quotes"."grand_total" = "quotes"."subtotal" + "quotes"."tax_total" + "quotes"."round_off"),
	CONSTRAINT "quotes_round_off_check" CHECK ("quotes"."round_off" between -0.49 and 0.50),
	CONSTRAINT "quotes_withdrawn_reason_check" CHECK (("quotes"."state" = 'withdrawn') = ("quotes"."withdrawn_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_kit_id_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_composite_rule_id_composite_supply_rules_id_fk" FOREIGN KEY ("composite_rule_id") REFERENCES "public"."composite_supply_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_entity_fk" FOREIGN KEY ("quote_id","entity_id") REFERENCES "public"."quotes"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_entity_fk" FOREIGN KEY ("quote_id","entity_id") REFERENCES "public"."quotes"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sizing_id_sizings_id_fk" FOREIGN KEY ("sizing_id") REFERENCES "public"."sizings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_supersedes_fk" FOREIGN KEY ("supersedes_id","entity_id") REFERENCES "public"."quotes"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_supersedes_unique" ON "quotes" USING btree ("supersedes_id") WHERE "quotes"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "quotes_entity_created_idx" ON "quotes" USING btree ("entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "quotes_created_idx" ON "quotes" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "quotes_opportunity_idx" ON "quotes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "quotes_account_idx" ON "quotes" USING btree ("account_id","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "quotes_quote_no_trgm_idx" ON "quotes" USING gin ("quote_no" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_open_valid_until_idx" ON "quotes" USING btree ("entity_id","valid_until") WHERE "quotes"."state" in ('draft', 'sent');--> statement-breakpoint
CREATE INDEX "quotes_pdf_file_idx" ON "quotes" USING btree ("pdf_file_id");