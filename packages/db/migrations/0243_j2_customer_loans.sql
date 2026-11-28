ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_id_entity_account_unique" UNIQUE("id","entity_id","account_id");--> statement-breakpoint
CREATE TABLE "customer_loans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"account_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"lender_id" uuid,
	"lender_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"state" text DEFAULT 'applied' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sanctioned_amount" numeric(14, 2),
	"sanctioned_at" timestamp with time zone,
	"disbursed_at" timestamp with time zone,
	"reference" text,
	"rejected_reason" text,
	"gates_json" jsonb DEFAULT '{"dispatch":"disbursed"}'::jsonb NOT NULL,
	"gates_waived_at" timestamp with time zone,
	"gates_waived_by" uuid,
	"gates_waived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "customer_loans_state_check" CHECK ("customer_loans"."state" in ('applied', 'sanctioned', 'disbursed', 'rejected')),
	CONSTRAINT "customer_loans_lender_check" CHECK (("customer_loans"."lender_id" is null) <> ("customer_loans"."lender_name" is null)
       and ("customer_loans"."lender_name" is null or length(btrim("customer_loans"."lender_name")) between 2 and 120)),
	CONSTRAINT "customer_loans_amounts_check" CHECK ("customer_loans"."amount" > 0 and ("customer_loans"."sanctioned_amount" is null or "customer_loans"."sanctioned_amount" > 0)),
	CONSTRAINT "customer_loans_sanction_check" CHECK (("customer_loans"."sanctioned_amount" is null) = ("customer_loans"."sanctioned_at" is null)
       and ("customer_loans"."state" not in ('sanctioned', 'disbursed') or "customer_loans"."sanctioned_at" is not null)
       and ("customer_loans"."state" <> 'applied' or "customer_loans"."sanctioned_at" is null)),
	CONSTRAINT "customer_loans_disbursed_check" CHECK (("customer_loans"."state" = 'disbursed') = ("customer_loans"."disbursed_at" is not null)),
	CONSTRAINT "customer_loans_rejected_check" CHECK (("customer_loans"."state" = 'rejected') = ("customer_loans"."rejected_reason" is not null)
       and ("customer_loans"."rejected_reason" is null or length(btrim("customer_loans"."rejected_reason")) between 1 and 300)),
	CONSTRAINT "customer_loans_reference_check" CHECK ("customer_loans"."reference" is null or length(btrim("customer_loans"."reference")) between 1 and 60),
	CONSTRAINT "customer_loans_gates_check" CHECK (jsonb_typeof("customer_loans"."gates_json") = 'object' and "customer_loans"."gates_json" - 'dispatch' = '{}'::jsonb),
	CONSTRAINT "customer_loans_gates_dispatch_check" CHECK (coalesce("customer_loans"."gates_json" ->> 'dispatch', '') in ('disbursed', 'sanctioned', 'none')),
	CONSTRAINT "customer_loans_waiver_check" CHECK (("customer_loans"."gates_waived_at" is null) = ("customer_loans"."gates_waived_by" is null)
       and ("customer_loans"."gates_waived_at" is null) = ("customer_loans"."gates_waived_reason" is null)
       and ("customer_loans"."gates_waived_at" is null or "customer_loans"."state" = 'rejected')
       and ("customer_loans"."gates_waived_reason" is null or length(btrim("customer_loans"."gates_waived_reason")) between 1 and 300))
);
--> statement-breakpoint
CREATE TABLE "lenders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "lenders_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "lenders_name_check" CHECK (length(btrim("lenders"."name")) between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_gates_waived_by_principals_id_fk" FOREIGN KEY ("gates_waived_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_order_fk" FOREIGN KEY ("sales_order_id","entity_id","account_id") REFERENCES "public"."sales_orders"("id","entity_id","account_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "customer_loans" ADD CONSTRAINT "customer_loans_lender_fk" FOREIGN KEY ("lender_id","entity_id") REFERENCES "public"."lenders"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lenders" ADD CONSTRAINT "lenders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lenders" ADD CONSTRAINT "lenders_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lenders" ADD CONSTRAINT "lenders_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_loans_active_unique" ON "customer_loans" USING btree ("sales_order_id") WHERE "customer_loans"."state" in ('applied', 'sanctioned', 'disbursed');--> statement-breakpoint
CREATE INDEX "customer_loans_order_idx" ON "customer_loans" USING btree ("sales_order_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_loans_account_idx" ON "customer_loans" USING btree ("account_id","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_loans_lender_idx" ON "customer_loans" USING btree ("lender_id");--> statement-breakpoint
CREATE INDEX "customer_loans_entity_created_idx" ON "customer_loans" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lenders_entity_name_unique" ON "lenders" USING btree ("entity_id",lower(btrim("name")));
