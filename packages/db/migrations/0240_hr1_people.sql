CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"manager_id" uuid,
	"shift_id" uuid,
	"office" text,
	"joined_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "employees_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "employees_name_check" CHECK (char_length("employees"."name") between 1 and 120),
	CONSTRAINT "employees_phone_check" CHECK ("employees"."phone" is null or "employees"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "employees_office_check" CHECK ("employees"."office" is null or char_length("employees"."office") between 1 and 80),
	CONSTRAINT "employees_manager_check" CHECK ("employees"."manager_id" is null or "employees"."manager_id" <> "employees"."id"),
	CONSTRAINT "employees_active_check" CHECK ("employees"."active" = ("employees"."left_on" is null)),
	CONSTRAINT "employees_left_check" CHECK ("employees"."left_on" is null or "employees"."left_on" >= "employees"."joined_on")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"on_date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "holidays_name_check" CHECK (char_length("holidays"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"leave_request_id" uuid,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balances_kind_check" CHECK ("leave_balances"."kind" in ('grant', 'use', 'adjust')),
	CONSTRAINT "leave_balances_days_check" CHECK ("leave_balances"."days" <> 0 and abs("leave_balances"."days") <= 366 and "leave_balances"."days" * 2 = trunc("leave_balances"."days" * 2)
          and ("leave_balances"."kind" <> 'grant' or "leave_balances"."days" > 0) and ("leave_balances"."kind" <> 'use' or "leave_balances"."days" < 0)),
	CONSTRAINT "leave_balances_source_check" CHECK (("leave_balances"."kind" = 'use') = ("leave_balances"."leave_request_id" is not null)
          and ("leave_balances"."kind" = 'use' or "leave_balances"."reason" is not null)),
	CONSTRAINT "leave_balances_reason_check" CHECK ("leave_balances"."reason" is null or char_length("leave_balances"."reason") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"note" text,
	"state" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "leave_requests_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "leave_requests_state_check" CHECK ("leave_requests"."state" in ('requested', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_span_check" CHECK ("leave_requests"."to_date" >= "leave_requests"."from_date"),
	CONSTRAINT "leave_requests_days_check" CHECK ("leave_requests"."days" > 0 and "leave_requests"."days" <= 366 and "leave_requests"."days" * 2 = trunc("leave_requests"."days" * 2)),
	CONSTRAINT "leave_requests_decided_check" CHECK (("leave_requests"."state" = 'requested') = ("leave_requests"."decided_by" is null and "leave_requests"."decided_at" is null)),
	CONSTRAINT "leave_requests_note_check" CHECK ("leave_requests"."note" is null or char_length("leave_requests"."note") <= 500),
	CONSTRAINT "leave_requests_decision_note_check" CHECK ("leave_requests"."decision_note" is null or char_length("leave_requests"."decision_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"name" text NOT NULL,
	"days_per_year" numeric(5, 1) NOT NULL,
	"carries_forward" boolean NOT NULL,
	"is_paid" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "leave_types_name_check" CHECK (char_length("leave_types"."name") between 1 and 120),
	CONSTRAINT "leave_types_days_check" CHECK ("leave_types"."days_per_year" between 0 and 366 and "leave_types"."days_per_year" * 2 = trunc("leave_types"."days_per_year" * 2))
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"lunch_min" smallint NOT NULL,
	"grace_min" smallint NOT NULL,
	"weekly_off_days" smallint[] DEFAULT '{}' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "shifts_name_check" CHECK (char_length("shifts"."name") between 1 and 120),
	CONSTRAINT "shifts_times_check" CHECK ("shifts"."start_time" <> "shifts"."end_time"),
	CONSTRAINT "shifts_lunch_check" CHECK ("shifts"."lunch_min" between 0 and 240),
	CONSTRAINT "shifts_grace_check" CHECK ("shifts"."grace_min" between 0 and 120),
	CONSTRAINT "shifts_weekly_off_check" CHECK ("shifts"."weekly_off_days" <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality("shifts"."weekly_off_days") <= 6)
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_fk" FOREIGN KEY ("manager_id","entity_id") REFERENCES "public"."employees"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_fk" FOREIGN KEY ("employee_id","entity_id") REFERENCES "public"."employees"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_request_fk" FOREIGN KEY ("leave_request_id","entity_id") REFERENCES "public"."leave_requests"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_principals_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_fk" FOREIGN KEY ("employee_id","entity_id") REFERENCES "public"."employees"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_entity_unique" ON "employees" USING btree ("user_id","entity_id") WHERE "employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_entity_name_idx" ON "employees" USING btree ("entity_id",lower("name"),"id");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employees_shift_idx" ON "employees" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_entity_date_unique" ON "holidays" USING btree (coalesce("entity_id", 0),"on_date");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("on_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_use_unique" ON "leave_balances" USING btree ("leave_request_id") WHERE "leave_balances"."kind" = 'use';--> statement-breakpoint
CREATE INDEX "leave_balances_employee_idx" ON "leave_balances" USING btree ("employee_id","leave_type_id","created_at");--> statement-breakpoint
CREATE INDEX "leave_balances_type_idx" ON "leave_balances" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","from_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leave_requests_waiting_idx" ON "leave_requests" USING btree ("entity_id","created_at") WHERE "leave_requests"."state" = 'requested';--> statement-breakpoint
CREATE INDEX "leave_requests_type_idx" ON "leave_requests" USING btree ("leave_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_entity_name_unique" ON "leave_types" USING btree (coalesce("entity_id", 0),lower("name")) WHERE "leave_types"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_entity_name_unique" ON "shifts" USING btree (coalesce("entity_id", 0),lower("name")) WHERE "shifts"."archived_at" is null;