CREATE TABLE "commission_accruals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"partner_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"commission_rule_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"measure" numeric(14, 3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"state" text DEFAULT 'accrued' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "commission_accruals_order_unique" UNIQUE("sales_order_id"),
	CONSTRAINT "commission_accruals_basis_check" CHECK ("commission_accruals"."basis" in ('fixed', 'percent', 'per_kw', 'per_hp')),
	CONSTRAINT "commission_accruals_state_check" CHECK ("commission_accruals"."state" in ('accrued', 'cancelled')),
	CONSTRAINT "commission_accruals_amounts_check" CHECK ("commission_accruals"."rate" > 0 and "commission_accruals"."measure" >= 0 and "commission_accruals"."amount" >= 0),
	CONSTRAINT "commission_accruals_cancel_check" CHECK (("commission_accruals"."state" = 'cancelled') = ("commission_accruals"."cancelled_at" is not null)
       and ("commission_accruals"."cancelled_at" is null) = ("commission_accruals"."cancelled_by" is null))
);
--> statement-breakpoint
CREATE TABLE "dealer_outstanding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"outstanding" numeric(14, 2) NOT NULL,
	"oldest_overdue_days" integer,
	"oldest_overdue_invoice_no" text,
	"as_of" date NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_outstanding_amount_check" CHECK ("dealer_outstanding"."outstanding" >= 0),
	CONSTRAINT "dealer_outstanding_overdue_check" CHECK (("dealer_outstanding"."oldest_overdue_days" is null) = ("dealer_outstanding"."oldest_overdue_invoice_no" is null)
       and ("dealer_outstanding"."oldest_overdue_days" is null or "dealer_outstanding"."oldest_overdue_days" between 0 and 3650)
       and ("dealer_outstanding"."oldest_overdue_invoice_no" is null or length(btrim("dealer_outstanding"."oldest_overdue_invoice_no")) between 1 and 60))
);
--> statement-breakpoint
CREATE TABLE "dealer_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"credit_limit" numeric(14, 2),
	"credit_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "dealer_terms_credit_limit_check" CHECK ("dealer_terms"."credit_limit" is null or "dealer_terms"."credit_limit" >= 0),
	CONSTRAINT "dealer_terms_credit_days_check" CHECK ("dealer_terms"."credit_days" is null or "dealer_terms"."credit_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"sales_order_id" uuid NOT NULL,
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
	CONSTRAINT "sales_order_lines_order_position_unique" UNIQUE("sales_order_id","position"),
	CONSTRAINT "sales_order_lines_target_check" CHECK (("sales_order_lines"."item_id" is null) <> ("sales_order_lines"."kit_id" is null)),
	CONSTRAINT "sales_order_lines_position_check" CHECK ("sales_order_lines"."position" >= 1),
	CONSTRAINT "sales_order_lines_qty_check" CHECK ("sales_order_lines"."qty" > 0),
	CONSTRAINT "sales_order_lines_unit_check" CHECK ("sales_order_lines"."unit" in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')),
	CONSTRAINT "sales_order_lines_hsn_check" CHECK ("sales_order_lines"."hsn" is null or "sales_order_lines"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
	CONSTRAINT "sales_order_lines_tax_check" CHECK (("sales_order_lines"."tax_rate_id" is not null and "sales_order_lines"."tax_rate_pct" is not null and "sales_order_lines"."composite_rule_id" is null and "sales_order_lines"."goods_rate_pct" is null and "sales_order_lines"."services_rate_pct" is null and "sales_order_lines"."goods_taxable" is null and "sales_order_lines"."services_taxable" is null)
       or ("sales_order_lines"."tax_rate_id" is null and "sales_order_lines"."tax_rate_pct" is null and "sales_order_lines"."composite_rule_id" is not null and "sales_order_lines"."works_contract" and "sales_order_lines"."goods_rate_pct" is not null and "sales_order_lines"."services_rate_pct" is not null and "sales_order_lines"."goods_taxable" is not null and "sales_order_lines"."services_taxable" is not null)),
	CONSTRAINT "sales_order_lines_amounts_check" CHECK ("sales_order_lines"."unit_price" >= 0 and "sales_order_lines"."taxable_value" >= 0 and "sales_order_lines"."cgst" >= 0 and "sales_order_lines"."sgst" >= 0 and "sales_order_lines"."igst" >= 0 and "sales_order_lines"."line_total" = "sales_order_lines"."taxable_value" + "sales_order_lines"."cgst" + "sales_order_lines"."sgst" + "sales_order_lines"."igst")
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"so_no" text NOT NULL,
	"fy" text NOT NULL,
	"quote_id" uuid,
	"opportunity_id" uuid,
	"account_id" uuid NOT NULL,
	"site_id" uuid,
	"tier_id" uuid NOT NULL,
	"price_list_id" uuid,
	"place_of_supply_state" text NOT NULL,
	"supply_kind" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"cgst" numeric(14, 2) NOT NULL,
	"sgst" numeric(14, 2) NOT NULL,
	"igst" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"round_off" numeric(14, 2) NOT NULL,
	"grand_total" numeric(14, 2) NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"credit_held_at" timestamp with time zone,
	"credit_hold_reason" text,
	"credit_hold_json" jsonb,
	"credit_release_by" uuid,
	"credit_release_reason" text,
	"credit_released_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "sales_orders_entity_so_no_unique" UNIQUE("entity_id","so_no"),
	CONSTRAINT "sales_orders_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "sales_orders_source_check" CHECK (("sales_orders"."quote_id" is null) = ("sales_orders"."opportunity_id" is null)),
	CONSTRAINT "sales_orders_state_check" CHECK ("sales_orders"."state" in ('draft', 'confirmed', 'partially_dispatched', 'dispatched', 'invoiced', 'closed', 'cancelled')),
	CONSTRAINT "sales_orders_supply_kind_check" CHECK ("sales_orders"."supply_kind" in ('intra', 'inter')),
	CONSTRAINT "sales_orders_place_of_supply_check" CHECK ("sales_orders"."place_of_supply_state" ~ '^[0-9]{2}$'),
	CONSTRAINT "sales_orders_fy_check" CHECK ("sales_orders"."fy" ~ '^[0-9]{4}-[0-9]{2}$' and right("sales_orders"."fy", 2)::int = (left("sales_orders"."fy", 4)::int + 1) % 100),
	CONSTRAINT "sales_orders_totals_check" CHECK ("sales_orders"."subtotal" >= 0 and "sales_orders"."cgst" >= 0 and "sales_orders"."sgst" >= 0 and "sales_orders"."igst" >= 0 and "sales_orders"."tax_total" = "sales_orders"."cgst" + "sales_orders"."sgst" + "sales_orders"."igst" and "sales_orders"."grand_total" = "sales_orders"."subtotal" + "sales_orders"."tax_total" + "sales_orders"."round_off"),
	CONSTRAINT "sales_orders_round_off_check" CHECK ("sales_orders"."round_off" between -0.49 and 0.50),
	CONSTRAINT "sales_orders_confirmed_check" CHECK (("sales_orders"."state" <> 'draft' or ("sales_orders"."confirmed_at" is null and "sales_orders"."confirmed_by" is null))
       and ("sales_orders"."state" not in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced', 'closed')
            or ("sales_orders"."confirmed_at" is not null and "sales_orders"."confirmed_by" is not null))),
	CONSTRAINT "sales_orders_credit_hold_check" CHECK (("sales_orders"."credit_held_at" is null) = ("sales_orders"."credit_hold_reason" is null)
       and ("sales_orders"."credit_held_at" is null) = ("sales_orders"."credit_hold_json" is null)
       and ("sales_orders"."credit_hold_reason" is null or "sales_orders"."credit_hold_reason" in ('credit_limit_exceeded', 'credit_overdue', 'credit_limit_missing'))),
	CONSTRAINT "sales_orders_credit_hold_json_check" CHECK ("sales_orders"."credit_hold_json" is null or jsonb_typeof("sales_orders"."credit_hold_json") = 'object'),
	CONSTRAINT "sales_orders_credit_release_check" CHECK (("sales_orders"."credit_release_by" is null) = ("sales_orders"."credit_release_reason" is null)
       and ("sales_orders"."credit_release_by" is null) = ("sales_orders"."credit_released_at" is null)
       and ("sales_orders"."credit_release_reason" is null or length(btrim("sales_orders"."credit_release_reason")) between 1 and 300)),
	CONSTRAINT "sales_orders_cancel_reason_check" CHECK (("sales_orders"."state" = 'cancelled') = ("sales_orders"."cancel_reason" is not null)
       and ("sales_orders"."cancel_reason" is null or length(btrim("sales_orders"."cancel_reason")) between 1 and 300))
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "accepted_via" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "signed_file_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_partner_id_referral_partners_account_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_cancelled_by_principals_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_order_entity_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_outstanding" ADD CONSTRAINT "dealer_outstanding_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_outstanding" ADD CONSTRAINT "dealer_outstanding_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_outstanding" ADD CONSTRAINT "dealer_outstanding_entered_by_principals_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_terms" ADD CONSTRAINT "dealer_terms_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_terms" ADD CONSTRAINT "dealer_terms_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_terms" ADD CONSTRAINT "dealer_terms_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_kit_id_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_composite_rule_fk" FOREIGN KEY ("composite_rule_id") REFERENCES "public"."composite_supply_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_entity_fk" FOREIGN KEY ("sales_order_id","entity_id") REFERENCES "public"."sales_orders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tier_id_price_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_confirmed_by_principals_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_credit_release_by_principals_id_fk" FOREIGN KEY ("credit_release_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_fk" FOREIGN KEY ("quote_id","entity_id") REFERENCES "public"."quotes"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_accruals_entity_created_idx" ON "commission_accruals" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_accruals_partner_idx" ON "commission_accruals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "commission_accruals_opportunity_idx" ON "commission_accruals" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "commission_accruals_rule_idx" ON "commission_accruals" USING btree ("commission_rule_id");--> statement-breakpoint
CREATE INDEX "dealer_outstanding_account_idx" ON "dealer_outstanding" USING btree ("account_id","entity_id","as_of","created_at");--> statement-breakpoint
CREATE INDEX "dealer_outstanding_entity_idx" ON "dealer_outstanding" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "dealer_terms_account_idx" ON "dealer_terms" USING btree ("account_id","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "dealer_terms_entity_idx" ON "dealer_terms" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_item_idx" ON "sales_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_kit_idx" ON "sales_order_lines" USING btree ("kit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_quote_unique" ON "sales_orders" USING btree ("quote_id") WHERE "sales_orders"."quote_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_orders_entity_created_idx" ON "sales_orders" USING btree ("entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "sales_orders_created_idx" ON "sales_orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "sales_orders_opportunity_idx" ON "sales_orders" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sales_orders_account_idx" ON "sales_orders" USING btree ("account_id","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_exposure_idx" ON "sales_orders" USING btree ("entity_id","account_id","confirmed_at") WHERE "sales_orders"."state" in ('confirmed', 'partially_dispatched', 'dispatched', 'invoiced');--> statement-breakpoint
CREATE INDEX "sales_orders_tier_idx" ON "sales_orders" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "sales_orders_price_list_idx" ON "sales_orders" USING btree ("price_list_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_signed_file_id_files_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_dealer_name_idx" ON "accounts" USING btree ("name","id") WHERE "accounts"."type" = 'dealer' and "accounts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "quotes_signed_file_idx" ON "quotes" USING btree ("signed_file_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_via_check" CHECK ("quotes"."accepted_via" is null or "quotes"."accepted_via" in ('whatsapp_reply', 'whatsapp_otp', 'signed_upload'));--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_acceptance_check" CHECK (("quotes"."state" = 'accepted') = ("quotes"."accepted_via" is not null)
       and ("quotes"."signed_file_id" is not null) = ("quotes"."accepted_via" is not distinct from 'signed_upload'));