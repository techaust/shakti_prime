-- The targets (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06 and RPT-01), and the indexes the
-- progress of a target reads: a person's stage moves and the orders a person confirmed.
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"scope" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"starts_on" date NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_scope_check" CHECK ("targets"."scope" in ('caller', 'team')),
	CONSTRAINT "targets_metric_check" CHECK ("targets"."metric" in ('calls', 'qualified', 'orders', 'kw')),
	CONSTRAINT "targets_period_check" CHECK ("targets"."period" in ('day', 'week', 'month')),
	CONSTRAINT "targets_value_check" CHECK ("targets"."value" >= 0),
	CONSTRAINT "targets_starts_on_check" CHECK (("targets"."period" = 'day')
        or ("targets"."period" = 'week' and extract(isodow from "targets"."starts_on") = 1)
        or ("targets"."period" = 'month' and extract(day from "targets"."starts_on") = 1)),
	CONSTRAINT "targets_team_subject_check" CHECK ("targets"."scope" <> 'team' or "targets"."subject_id" = "targets"."team_id")
);
--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_set_by_principals_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "targets_subject_idx" ON "targets" USING btree ("entity_id","scope","subject_id","metric","period","starts_on" DESC NULLS LAST,"set_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "targets_team_idx" ON "targets" USING btree ("team_id","set_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "targets_set_by_idx" ON "targets" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "activities_stage_actor_idx" ON "activities" USING btree ("actor_principal_id","created_at") WHERE "activities"."type" = 'stage_moved';--> statement-breakpoint
CREATE INDEX "sales_orders_confirmed_by_idx" ON "sales_orders" USING btree ("confirmed_by","confirmed_at") WHERE "sales_orders"."confirmed_at" is not null;