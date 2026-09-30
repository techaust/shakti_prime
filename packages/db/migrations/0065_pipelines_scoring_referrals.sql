CREATE TABLE "call_dispositions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"segment" text,
	"key" smallint NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"next_action" text NOT NULL,
	"position" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "call_dispositions_segment_check" CHECK ("call_dispositions"."segment" is null or "call_dispositions"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')),
	CONSTRAINT "call_dispositions_key_check" CHECK ("call_dispositions"."key" between 1 and 9),
	CONSTRAINT "call_dispositions_code_check" CHECK ("call_dispositions"."code" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "call_dispositions_label_check" CHECK (char_length("call_dispositions"."label") between 2 and 40),
	CONSTRAINT "call_dispositions_next_action_check" CHECK ("call_dispositions"."next_action" in ('callback', 'retry', 'qualified', 'not_interested', 'wrong_number', 'nurture')),
	CONSTRAINT "call_dispositions_position_check" CHECK ("call_dispositions"."position" between 1 and 9)
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid,
	"basis" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"trigger" text DEFAULT 'order_confirmed' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "commission_rules_basis_check" CHECK ("commission_rules"."basis" in ('fixed', 'percent', 'per_kw', 'per_hp')),
	CONSTRAINT "commission_rules_trigger_check" CHECK ("commission_rules"."trigger" in ('order_confirmed')),
	CONSTRAINT "commission_rules_amount_check" CHECK ("commission_rules"."amount" > 0 and ("commission_rules"."basis" <> 'percent' or "commission_rules"."amount" <= 100)),
	CONSTRAINT "commission_rules_effective_check" CHECK ("commission_rules"."effective_to" is null or "commission_rules"."effective_to" > "commission_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "lead_score_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"segment" text,
	"factor" text NOT NULL,
	"match_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points" smallint NOT NULL,
	"position" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "lead_score_rules_segment_check" CHECK ("lead_score_rules"."segment" is null or "lead_score_rules"."segment" in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')),
	CONSTRAINT "lead_score_rules_factor_check" CHECK ("lead_score_rules"."factor" in ('source', 'segment', 'district', 'system_size', 'age_days')),
	CONSTRAINT "lead_score_rules_points_check" CHECK ("lead_score_rules"."points" between -50 and 50 and "lead_score_rules"."points" <> 0),
	CONSTRAINT "lead_score_rules_position_check" CHECK ("lead_score_rules"."position" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "referral_partners" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "referral_partners_code_check" CHECK ("referral_partners"."code" ~ '^[A-Za-z0-9]{4,12}$')
);
--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "score" SET DEFAULT 50;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "score_reasons_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "score_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "score_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "referral_partner_id" uuid;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "first_contact_sla_minutes" integer;--> statement-breakpoint
ALTER TABLE "call_dispositions" ADD CONSTRAINT "call_dispositions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_dispositions" ADD CONSTRAINT "call_dispositions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_dispositions" ADD CONSTRAINT "call_dispositions_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_partner_id_referral_partners_account_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_rules" ADD CONSTRAINT "lead_score_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_rules" ADD CONSTRAINT "lead_score_rules_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_rules" ADD CONSTRAINT "lead_score_rules_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_partners" ADD CONSTRAINT "referral_partners_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_partners" ADD CONSTRAINT "referral_partners_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_partners" ADD CONSTRAINT "referral_partners_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_dispositions_scope_key_unique" ON "call_dispositions" USING btree (coalesce("entity_id", 0),coalesce("segment", ''),"key") WHERE "call_dispositions"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "call_dispositions_scope_code_unique" ON "call_dispositions" USING btree (coalesce("entity_id", 0),coalesce("segment", ''),"code") WHERE "call_dispositions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "call_dispositions_entity_idx" ON "call_dispositions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "commission_rules_partner_idx" ON "commission_rules" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "lead_score_rules_entity_idx" ON "lead_score_rules" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_partners_code_unique" ON "referral_partners" USING btree (upper("code"));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_score_changed_by_principals_id_fk" FOREIGN KEY ("score_changed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_referral_partner_fk" FOREIGN KEY ("referral_partner_id") REFERENCES "public"."referral_partners"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_referral_partner_idx" ON "opportunities" USING btree ("referral_partner_id");--> statement-breakpoint
CREATE INDEX "opportunities_entity_score_idx" ON "opportunities" USING btree ("entity_id","score","id");--> statement-breakpoint
CREATE INDEX "opportunities_score_keyset_idx" ON "opportunities" USING btree ("score","id");--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_first_contact_sla_check" CHECK ("pipelines"."first_contact_sla_minutes" is null or "pipelines"."first_contact_sla_minutes" between 1 and 10080);