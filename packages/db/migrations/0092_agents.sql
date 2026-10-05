CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"run_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"action_type" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"autonomy" text NOT NULL,
	"state" text NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"decided_input_json" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "agent_actions_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "agent_actions_agent_check" CHECK ("agent_actions"."agent" like 'agent:%'),
	CONSTRAINT "agent_actions_autonomy_check" CHECK ("agent_actions"."autonomy" in ('suggest', 'needs_approval', 'automatic')),
	CONSTRAINT "agent_actions_state_check" CHECK ("agent_actions"."state" in ('proposed', 'executed', 'approved', 'rejected', 'dismissed')),
	CONSTRAINT "agent_actions_decided_check" CHECK (("agent_actions"."decided_at" is null and "agent_actions"."decided_by" is null) = ("agent_actions"."state" in ('proposed', 'executed'))),
	CONSTRAINT "agent_actions_input_size_check" CHECK (pg_column_size("agent_actions"."input_json") <= 4000 and ("agent_actions"."decided_input_json" is null or pg_column_size("agent_actions"."decided_input_json") <= 4000))
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent" text,
	"action_type" text,
	"entity_id" smallint,
	"autonomy" text,
	"daily_spend_cap_paise" bigint,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "agent_configs_agent_check" CHECK ("agent_configs"."agent" like 'agent:%'),
	CONSTRAINT "agent_configs_autonomy_check" CHECK ("agent_configs"."autonomy" in ('suggest', 'needs_approval', 'automatic')),
	CONSTRAINT "agent_configs_cap_check" CHECK ("agent_configs"."daily_spend_cap_paise" >= 0),
	CONSTRAINT "agent_configs_every_agent_check" CHECK ("agent_configs"."agent" is not null or ("agent_configs"."action_type" is null and "agent_configs"."autonomy" is null and "agent_configs"."daily_spend_cap_paise" is null)),
	CONSTRAINT "agent_configs_cap_per_agent_check" CHECK ("agent_configs"."action_type" is null or "agent_configs"."daily_spend_cap_paise" is null)
);
--> statement-breakpoint
CREATE TABLE "agent_evals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"eval_set" text NOT NULL,
	"cases_total" integer NOT NULL,
	"cases_passed" integer NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "agent_evals_agent_check" CHECK ("agent_evals"."agent" like 'agent:%'),
	CONSTRAINT "agent_evals_cases_check" CHECK ("agent_evals"."cases_total" > 0 and "agent_evals"."cases_passed" between 0 and "agent_evals"."cases_total"),
	CONSTRAINT "agent_evals_score_check" CHECK ("agent_evals"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"agent" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"action_type" text NOT NULL,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_paise" bigint DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "agent_runs_agent_check" CHECK ("agent_runs"."agent" like 'agent:%'),
	CONSTRAINT "agent_runs_outcome_check" CHECK ("agent_runs"."outcome" in ('proposed', 'acted', 'nothing_to_do', 'switched_off', 'cap_reached', 'unavailable', 'failed')),
	CONSTRAINT "agent_runs_counts_check" CHECK ("agent_runs"."tokens_in" >= 0 and "agent_runs"."tokens_out" >= 0 and "agent_runs"."cost_paise" >= 0 and "agent_runs"."duration_ms" >= 0),
	CONSTRAINT "agent_runs_request_id_check" CHECK (char_length("agent_runs"."request_id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"kind" text NOT NULL,
	"assignee_id" uuid,
	"team_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"agent_action_id" uuid,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "inbox_items_action_unique" UNIQUE("agent_action_id"),
	CONSTRAINT "inbox_items_kind_check" CHECK ("inbox_items"."kind" in ('agent_suggestion', 'routed_work')),
	CONSTRAINT "inbox_items_state_check" CHECK ("inbox_items"."state" in ('open', 'done')),
	CONSTRAINT "inbox_items_subject_type_check" CHECK ("inbox_items"."subject_type" in ('opportunity', 'account')),
	CONSTRAINT "inbox_items_suggestion_check" CHECK (("inbox_items"."kind" <> 'agent_suggestion') = ("inbox_items"."agent_action_id" is null)),
	CONSTRAINT "inbox_items_done_check" CHECK (("inbox_items"."state" <> 'done') = ("inbox_items"."done_at" is null and "inbox_items"."done_by" is null))
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_run_fk" FOREIGN KEY ("run_id","entity_id") REFERENCES "public"."agent_runs"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evals" ADD CONSTRAINT "agent_evals_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evals" ADD CONSTRAINT "agent_evals_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_assignee_id_principals_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_done_by_principals_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_action_fk" FOREIGN KEY ("agent_action_id","entity_id") REFERENCES "public"."agent_actions"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_run_idx" ON "agent_actions" USING btree ("run_id","entity_id");--> statement-breakpoint
CREATE INDEX "agent_actions_record_idx" ON "agent_actions" USING btree ("entity_id","agent","action_type","decided_at") WHERE "agent_actions"."autonomy" = 'needs_approval' and "agent_actions"."state" in ('approved', 'rejected');--> statement-breakpoint
CREATE INDEX "agent_evals_agent_ran_idx" ON "agent_evals" USING btree ("agent","ran_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_day_idx" ON "agent_runs" USING btree ("agent","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_entity_created_idx" ON "agent_runs" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_items_assignee_open_idx" ON "inbox_items" USING btree ("assignee_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "inbox_items_team_open_idx" ON "inbox_items" USING btree ("team_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "inbox_items_entity_open_idx" ON "inbox_items" USING btree ("entity_id","state","created_at","id");