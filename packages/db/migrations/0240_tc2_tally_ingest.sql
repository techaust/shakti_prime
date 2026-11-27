CREATE TABLE "tally_connector_companies" (
	"connector_id" uuid NOT NULL,
	"tally_company" text NOT NULL,
	"entity_id" smallint NOT NULL,
	"reachable" boolean,
	"reported_alter_id" bigint,
	"tally_last_alter_id" bigint,
	"problem" text,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "tally_connector_companies_connector_id_tally_company_pk" PRIMARY KEY("connector_id","tally_company"),
	CONSTRAINT "tally_connector_companies_entity_unique" UNIQUE("entity_id","tally_company"),
	CONSTRAINT "tally_connector_companies_problem_check" CHECK ("tally_connector_companies"."problem" is null or "tally_connector_companies"."problem" in ('no_books_from', 'tally_behind_bos', 'waiting_on_bos')),
	CONSTRAINT "tally_connector_companies_name_check" CHECK (char_length("tally_connector_companies"."tally_company") between 1 and 120 and "tally_connector_companies"."tally_company" = btrim("tally_connector_companies"."tally_company"))
);
--> statement-breakpoint
CREATE TABLE "tally_connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_sealed" jsonb NOT NULL,
	"key_hint" text NOT NULL,
	"next_key_sealed" jsonb,
	"next_key_hint" text,
	"key_rotated_at" timestamp with time zone,
	"connector_version" text,
	"tally_version" text,
	"queue_depth" integer,
	"held_rows" integer,
	"held_since" timestamp with time zone,
	"held_alerted_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"silence_alerted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tally_connectors_name_check" CHECK (char_length("tally_connectors"."name") between 1 and 80),
	CONSTRAINT "tally_connectors_next_key_check" CHECK (("tally_connectors"."next_key_sealed" is null) = ("tally_connectors"."next_key_hint" is null)),
	CONSTRAINT "tally_connectors_held_check" CHECK (("tally_connectors"."held_rows" is null or "tally_connectors"."held_rows" >= 0)
          and ("tally_connectors"."held_since" is null) = (coalesce("tally_connectors"."held_rows", 0) = 0)),
	CONSTRAINT "tally_connectors_revoked_check" CHECK (("tally_connectors"."revoked_at" is null) = ("tally_connectors"."revoked_by" is null)),
	CONSTRAINT "tally_connectors_queue_depth_check" CHECK ("tally_connectors"."queue_depth" is null or "tally_connectors"."queue_depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tally_cursors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"last_alter_id" bigint DEFAULT 0 NOT NULL,
	"connector_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_cursors_company_unique" UNIQUE("entity_id","tally_company"),
	CONSTRAINT "tally_cursors_alter_id_check" CHECK ("tally_cursors"."last_alter_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tally_ledgers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"alter_id" bigint NOT NULL,
	"name" text NOT NULL,
	"parent" text NOT NULL,
	"gstin" text,
	"opening_balance" numeric(14, 2) NOT NULL,
	"closing_balance" numeric(14, 2) NOT NULL,
	"as_of" date NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tally_ledgers_alter_id_check" CHECK ("tally_ledgers"."alter_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tally_purchase_vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"alter_id" bigint NOT NULL,
	"type" text NOT NULL,
	"type_name" text NOT NULL,
	"voucher_no" text NOT NULL,
	"voucher_date" date NOT NULL,
	"party_name" text,
	"party_gstin" text,
	"buyer_order_no" text,
	"amount" numeric(14, 2) NOT NULL,
	"is_cancelled" boolean NOT NULL,
	"is_optional" boolean NOT NULL,
	"payload_json" jsonb NOT NULL,
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"refused_at" timestamp with time zone,
	CONSTRAINT "tally_purchase_vouchers_type_check" CHECK ("tally_purchase_vouchers"."type" in ('purchase', 'debit_note')),
	CONSTRAINT "tally_purchase_vouchers_state_check" CHECK ("tally_purchase_vouchers"."state" in ('received', 'linked', 'unlinked', 'tombstoned', 'reversed')),
	CONSTRAINT "tally_purchase_vouchers_alter_id_check" CHECK ("tally_purchase_vouchers"."alter_id" >= 0),
	CONSTRAINT "tally_purchase_vouchers_deleted_check" CHECK (("tally_purchase_vouchers"."deleted_at" is not null) = ("tally_purchase_vouchers"."state" in ('tombstoned', 'reversed')))
);
--> statement-breakpoint
CREATE TABLE "tally_refused_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"guid" text NOT NULL,
	"alter_id" bigint NOT NULL,
	"field" text NOT NULL,
	"refused_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tally_refused_rows_guid_unique" UNIQUE("entity_id","tally_company","kind","guid"),
	CONSTRAINT "tally_refused_rows_kind_check" CHECK ("tally_refused_rows"."kind" in ('voucher', 'ledger')),
	CONSTRAINT "tally_refused_rows_alter_id_check" CHECK ("tally_refused_rows"."alter_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tally_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"from_date" date NOT NULL,
	"guid_count" integer NOT NULL,
	"live" integer NOT NULL,
	"tombstoned" integer NOT NULL,
	"missing" integer NOT NULL,
	"reappeared" integer NOT NULL,
	"state" text NOT NULL,
	"parts_of" uuid,
	"parts" smallint DEFAULT 1 NOT NULL,
	"parts_received" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"received_guids" text[] DEFAULT '{}'::text[] NOT NULL,
	"held_guids" text[] DEFAULT '{}'::text[] NOT NULL,
	"missing_guids" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tally_snapshots_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "tally_snapshots_state_check" CHECK ("tally_snapshots"."state" in ('receiving', 'applied', 'held', 'confirmed', 'superseded')),
	CONSTRAINT "tally_snapshots_counts_check" CHECK ("tally_snapshots"."guid_count" >= 0 and "tally_snapshots"."live" >= 0 and "tally_snapshots"."tombstoned" >= 0 and "tally_snapshots"."missing" >= 0
          and "tally_snapshots"."reappeared" >= 0),
	CONSTRAINT "tally_snapshots_confirmed_check" CHECK (("tally_snapshots"."confirmed_at" is null) = ("tally_snapshots"."confirmed_by" is null)
          and ("tally_snapshots"."confirmed_at" is null) = ("tally_snapshots"."state" <> 'confirmed')),
	CONSTRAINT "tally_snapshots_receiving_check" CHECK ("tally_snapshots"."state" = 'receiving' or cardinality("tally_snapshots"."received_guids") = 0),
	CONSTRAINT "tally_snapshots_parts_check" CHECK ("tally_snapshots"."parts" between 1 and 20),
	CONSTRAINT "tally_snapshots_missing_guids_check" CHECK (cardinality("tally_snapshots"."missing_guids") <= 1000),
	CONSTRAINT "tally_snapshots_held_check" CHECK ("tally_snapshots"."state" = 'held' or cardinality("tally_snapshots"."held_guids") = 0)
);
--> statement-breakpoint
CREATE TABLE "tally_voucher_tombstones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"voucher_guid" text NOT NULL,
	"voucher_type" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"reversal_applied_at" timestamp with time zone,
	CONSTRAINT "tally_voucher_tombstones_type_check" CHECK ("tally_voucher_tombstones"."voucher_type" in ('sales', 'receipt', 'credit_note', 'purchase', 'debit_note'))
);
--> statement-breakpoint
CREATE TABLE "tally_vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"tally_company" text NOT NULL,
	"connector_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"alter_id" bigint NOT NULL,
	"type" text NOT NULL,
	"type_name" text NOT NULL,
	"voucher_no" text NOT NULL,
	"voucher_date" date NOT NULL,
	"party_name" text,
	"party_gstin" text,
	"buyer_order_no" text,
	"amount" numeric(14, 2) NOT NULL,
	"is_cancelled" boolean NOT NULL,
	"is_optional" boolean NOT NULL,
	"payload_json" jsonb NOT NULL,
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"refused_at" timestamp with time zone,
	CONSTRAINT "tally_vouchers_type_check" CHECK ("tally_vouchers"."type" in ('sales', 'receipt', 'credit_note')),
	CONSTRAINT "tally_vouchers_state_check" CHECK ("tally_vouchers"."state" in ('received', 'linked', 'unlinked', 'tombstoned', 'reversed')),
	CONSTRAINT "tally_vouchers_alter_id_check" CHECK ("tally_vouchers"."alter_id" >= 0),
	CONSTRAINT "tally_vouchers_deleted_check" CHECK (("tally_vouchers"."deleted_at" is not null) = ("tally_vouchers"."state" in ('tombstoned', 'reversed')))
);
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_key_check";--> statement-breakpoint
ALTER TABLE "tally_connector_companies" ADD CONSTRAINT "tally_connector_companies_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connector_companies" ADD CONSTRAINT "tally_connector_companies_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connector_companies" ADD CONSTRAINT "tally_connector_companies_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connectors" ADD CONSTRAINT "tally_connectors_id_principals_id_fk" FOREIGN KEY ("id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connectors" ADD CONSTRAINT "tally_connectors_revoked_by_principals_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connectors" ADD CONSTRAINT "tally_connectors_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_connectors" ADD CONSTRAINT "tally_connectors_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_cursors" ADD CONSTRAINT "tally_cursors_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_cursors" ADD CONSTRAINT "tally_cursors_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_ledgers" ADD CONSTRAINT "tally_ledgers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_ledgers" ADD CONSTRAINT "tally_ledgers_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_purchase_vouchers" ADD CONSTRAINT "tally_purchase_vouchers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_purchase_vouchers" ADD CONSTRAINT "tally_purchase_vouchers_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_refused_rows" ADD CONSTRAINT "tally_refused_rows_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_refused_rows" ADD CONSTRAINT "tally_refused_rows_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_snapshots" ADD CONSTRAINT "tally_snapshots_confirmed_by_principals_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_tombstones" ADD CONSTRAINT "tally_voucher_tombstones_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_voucher_tombstones" ADD CONSTRAINT "tally_voucher_tombstones_snapshot_fk" FOREIGN KEY ("snapshot_id","entity_id") REFERENCES "public"."tally_snapshots"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_vouchers" ADD CONSTRAINT "tally_vouchers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_vouchers" ADD CONSTRAINT "tally_vouchers_connector_id_tally_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."tally_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tally_cursors_connector_idx" ON "tally_cursors" USING btree ("connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_ledgers_guid_unique" ON "tally_ledgers" USING btree ("guid");--> statement-breakpoint
CREATE INDEX "tally_ledgers_entity_name_idx" ON "tally_ledgers" USING btree ("entity_id","name");--> statement-breakpoint
CREATE INDEX "tally_ledgers_connector_idx" ON "tally_ledgers" USING btree ("connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_purchase_vouchers_guid_unique" ON "tally_purchase_vouchers" USING btree ("guid");--> statement-breakpoint
CREATE INDEX "tally_purchase_vouchers_entity_date_idx" ON "tally_purchase_vouchers" USING btree ("entity_id","voucher_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tally_purchase_vouchers_entity_state_idx" ON "tally_purchase_vouchers" USING btree ("entity_id","tally_company","state");--> statement-breakpoint
CREATE INDEX "tally_purchase_vouchers_connector_idx" ON "tally_purchase_vouchers" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "tally_refused_rows_open_idx" ON "tally_refused_rows" USING btree ("entity_id","refused_at" DESC NULLS LAST) WHERE "tally_refused_rows"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "tally_refused_rows_connector_idx" ON "tally_refused_rows" USING btree ("connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_snapshots_parts_of_unique" ON "tally_snapshots" USING btree ("connector_id","parts_of");--> statement-breakpoint
CREATE INDEX "tally_snapshots_entity_created_idx" ON "tally_snapshots" USING btree ("entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tally_snapshots_held_idx" ON "tally_snapshots" USING btree ("entity_id","tally_company") WHERE "tally_snapshots"."state" = 'held';--> statement-breakpoint
CREATE INDEX "tally_snapshots_connector_idx" ON "tally_snapshots" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "tally_voucher_tombstones_entity_detected_idx" ON "tally_voucher_tombstones" USING btree ("entity_id","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tally_voucher_tombstones_guid_idx" ON "tally_voucher_tombstones" USING btree ("voucher_guid");--> statement-breakpoint
CREATE INDEX "tally_voucher_tombstones_snapshot_idx" ON "tally_voucher_tombstones" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_vouchers_guid_unique" ON "tally_vouchers" USING btree ("guid");--> statement-breakpoint
CREATE INDEX "tally_vouchers_entity_date_idx" ON "tally_vouchers" USING btree ("entity_id","voucher_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tally_vouchers_entity_state_idx" ON "tally_vouchers" USING btree ("entity_id","tally_company","state");--> statement-breakpoint
CREATE INDEX "tally_vouchers_connector_idx" ON "tally_vouchers" USING btree ("connector_id");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_check" CHECK ("roles"."key" in ('executive', 'general_manager', 'sales_team_lead', 'tele_caller_cc', 'tele_caller_lc', 'store_manager', 'inventory_manager', 'project_manager', 'field_engineer', 'accounts', 'hr_admin', 'agent:triage', 'agent:concierge', 'agent:copilot', 'agent:sizing', 'agent:orchestrator', 'agent:chief', 'system:workers', 'system:tally_connector')) NOT VALID;