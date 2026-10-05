-- Duplicate customers and leads (PRD CRM-03, docs/design/phase1.md §7.4). The timeline check names
-- the column alone: the table is partitioned, and each partition takes the check under its own name.
-- app.match_text() is how the duplicate search compares a name or a village, whatever its case and
-- spacing (matchText() in packages/domain, kept equal by a test); it is made first, for the indexes.
create or replace function app.match_text(p_value text) returns text
  language sql immutable parallel safe set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p_value, '\s+', ' ', 'g')))
$$;
--> statement-breakpoint
CREATE TABLE "customer_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"kept_account_id" uuid NOT NULL,
	"merged_account_id" uuid NOT NULL,
	"candidate_id" uuid,
	"moved_json" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "customer_merges_pair_check" CHECK ("customer_merges"."kept_account_id" <> "customer_merges"."merged_account_id"),
	CONSTRAINT "customer_merges_undone_check" CHECK (("customer_merges"."undone_at" is null) = ("customer_merges"."undone_by" is null)),
	CONSTRAINT "customer_merges_moved_check" CHECK (jsonb_typeof("customer_merges"."moved_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid,
	"other_account_id" uuid,
	"opportunity_id" uuid,
	"other_opportunity_id" uuid,
	"reason" text NOT NULL,
	"signals_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" smallint NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "duplicate_candidates_kind_check" CHECK ("duplicate_candidates"."kind" in ('customer', 'lead')),
	CONSTRAINT "duplicate_candidates_reason_check" CHECK ("duplicate_candidates"."reason" in ('phone', 'name_village')),
	CONSTRAINT "duplicate_candidates_state_check" CHECK ("duplicate_candidates"."state" in ('open', 'merged', 'dismissed')),
	CONSTRAINT "duplicate_candidates_confidence_check" CHECK ("duplicate_candidates"."confidence" between 1 and 100),
	CONSTRAINT "duplicate_candidates_signals_check" CHECK (jsonb_typeof("duplicate_candidates"."signals_json") = 'array' and jsonb_array_length("duplicate_candidates"."signals_json") <= 4),
	CONSTRAINT "duplicate_candidates_pair_check" CHECK (("duplicate_candidates"."kind" = 'customer' and "duplicate_candidates"."account_id" < "duplicate_candidates"."other_account_id"
            and "duplicate_candidates"."opportunity_id" is null and "duplicate_candidates"."other_opportunity_id" is null)
        or ("duplicate_candidates"."kind" = 'lead' and "duplicate_candidates"."opportunity_id" < "duplicate_candidates"."other_opportunity_id"
            and "duplicate_candidates"."account_id" is null and "duplicate_candidates"."other_account_id" is null)),
	CONSTRAINT "duplicate_candidates_decided_check" CHECK (("duplicate_candidates"."state" = 'open') = ("duplicate_candidates"."decided_by" is null) and ("duplicate_candidates"."decided_by" is null) = ("duplicate_candidates"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_type_check";--> statement-breakpoint
ALTER TABLE "opportunity_tags" DROP CONSTRAINT "opportunity_tags_opportunity_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_opportunity_fk";
--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_kept_account_id_accounts_id_fk" FOREIGN KEY ("kept_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_merged_account_id_accounts_id_fk" FOREIGN KEY ("merged_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_candidate_id_duplicate_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."duplicate_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_undone_by_principals_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_other_account_id_accounts_id_fk" FOREIGN KEY ("other_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_other_opportunity_fk" FOREIGN KEY ("other_opportunity_id","entity_id") REFERENCES "public"."opportunities"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_merges_live_unique" ON "customer_merges" USING btree ("merged_account_id") WHERE "customer_merges"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "customer_merges_kept_idx" ON "customer_merges" USING btree ("kept_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_merges_candidate_idx" ON "customer_merges" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "customer_merges_undone_by_idx" ON "customer_merges" USING btree ("undone_by");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_customer_pair_unique" ON "duplicate_candidates" USING btree ("entity_id","account_id","other_account_id") WHERE "duplicate_candidates"."kind" = 'customer';--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_lead_pair_unique" ON "duplicate_candidates" USING btree ("opportunity_id","other_opportunity_id") WHERE "duplicate_candidates"."kind" = 'lead';--> statement-breakpoint
CREATE INDEX "duplicate_candidates_account_idx" ON "duplicate_candidates" USING btree ("account_id","state");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_other_account_idx" ON "duplicate_candidates" USING btree ("other_account_id","state");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_other_opportunity_idx" ON "duplicate_candidates" USING btree ("other_opportunity_id");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_open_idx" ON "duplicate_candidates" USING btree ("confidence" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "duplicate_candidates"."state" = 'open';--> statement-breakpoint
CREATE INDEX "duplicate_candidates_decided_by_idx" ON "duplicate_candidates" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "opportunity_tags" ADD CONSTRAINT "opportunity_tags_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_fk" FOREIGN KEY ("opportunity_id","entity_id","account_id") REFERENCES "public"."opportunities"("id","entity_id","account_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "accounts_match_name_idx" ON "accounts" USING btree (app.match_text("name"));--> statement-breakpoint
CREATE INDEX "customer_sites_match_village_idx" ON "customer_sites" USING btree (app.match_text("village")) WHERE "customer_sites"."village" is not null and "customer_sites"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_type_check" CHECK ("type" in ('lead_created', 'stage_moved', 'assigned', 'nurtured', 'reopened', 'won', 'lost', 'task_created', 'task_done', 'task_rescheduled', 'task_cancelled', 'note', 'customer_updated', 'site_updated', 'consent_recorded', 'consent_withdrawn', 'tagged', 'untagged', 'sizing_recorded', 'enquiry_repeated', 'customers_merged', 'customer_unmerged', 'leads_merged'));