CREATE TABLE "warranty_claim_costs" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"replacement_cost" numeric(14, 2),
	"supplier_credit_amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_claim_costs_replacement_cost_check" CHECK ("warranty_claim_costs"."replacement_cost" is null or "warranty_claim_costs"."replacement_cost" >= 0),
	CONSTRAINT "warranty_claim_costs_credit_check" CHECK ("warranty_claim_costs"."supplier_credit_amount" is null or "warranty_claim_costs"."supplier_credit_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" smallint NOT NULL,
	"claim_no" text NOT NULL,
	"account_id" uuid NOT NULL,
	"site_id" uuid,
	"item_id" uuid,
	"serial_id" uuid,
	"reported_fault" text NOT NULL,
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replacement_serial_id" uuid,
	"vendor_id" uuid,
	"supplier_rma_ref" text,
	"settlement" text,
	"supplier_serial_id" uuid,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "warranty_claims_entity_claim_no_unique" UNIQUE("entity_id","claim_no"),
	CONSTRAINT "warranty_claims_id_entity_unique" UNIQUE("id","entity_id"),
	CONSTRAINT "warranty_claims_state_check" CHECK ("warranty_claims"."state" in ('raised', 'serial_identified', 'replacement_issued', 'rma_raised', 'closed', 'rejected')),
	CONSTRAINT "warranty_claims_settlement_check" CHECK ("warranty_claims"."settlement" in ('credit', 'replacement')),
	CONSTRAINT "warranty_claims_reported_fault_check" CHECK (char_length(btrim("warranty_claims"."reported_fault")) between 1 and 1000),
	CONSTRAINT "warranty_claims_rma_ref_check" CHECK ("warranty_claims"."supplier_rma_ref" is null or char_length(btrim("warranty_claims"."supplier_rma_ref")) between 1 and 100),
	CONSTRAINT "warranty_claims_rejected_reason_check" CHECK ("warranty_claims"."rejected_reason" is null or char_length(btrim("warranty_claims"."rejected_reason")) between 1 and 300),
	CONSTRAINT "warranty_claims_item_check" CHECK (("warranty_claims"."serial_id" is null and "warranty_claims"."replacement_serial_id" is null and "warranty_claims"."supplier_serial_id" is null)
          or "warranty_claims"."item_id" is not null),
	CONSTRAINT "warranty_claims_steps_check" CHECK (("warranty_claims"."state" in ('raised', 'rejected') or "warranty_claims"."serial_id" is not null)
          and ("warranty_claims"."state" not in ('replacement_issued', 'rma_raised', 'closed') or "warranty_claims"."replacement_serial_id" is not null)
          and ("warranty_claims"."state" not in ('rma_raised', 'closed') or ("warranty_claims"."vendor_id" is not null and "warranty_claims"."supplier_rma_ref" is not null))
          and (("warranty_claims"."state" = 'closed') = ("warranty_claims"."settlement" is not null))
          and (("warranty_claims"."state" = 'rejected') = ("warranty_claims"."rejected_reason" is not null))
          and (("warranty_claims"."settlement" = 'replacement') = ("warranty_claims"."supplier_serial_id" is not null))),
	CONSTRAINT "warranty_claims_serials_differ_check" CHECK ("warranty_claims"."replacement_serial_id" is distinct from "warranty_claims"."serial_id"
          and "warranty_claims"."supplier_serial_id" is distinct from "warranty_claims"."serial_id"
          and "warranty_claims"."supplier_serial_id" is distinct from "warranty_claims"."replacement_serial_id")
);
--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_doc_type_check";--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" ADD CONSTRAINT "warranty_claim_costs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" ADD CONSTRAINT "warranty_claim_costs_claim_fk" FOREIGN KEY ("claim_id","entity_id") REFERENCES "public"."warranty_claims"("id","entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_site_id_customer_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."customer_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_updated_by_principals_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_serial_fk" FOREIGN KEY ("serial_id","entity_id","item_id") REFERENCES "public"."serials"("id","entity_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_replacement_serial_fk" FOREIGN KEY ("replacement_serial_id","entity_id","item_id") REFERENCES "public"."serials"("id","entity_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_supplier_serial_fk" FOREIGN KEY ("supplier_serial_id","entity_id","item_id") REFERENCES "public"."serials"("id","entity_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "warranty_claims_open_serial_unique" ON "warranty_claims" USING btree ("serial_id") WHERE "warranty_claims"."serial_id" is not null and "warranty_claims"."state" not in ('closed', 'rejected');--> statement-breakpoint
CREATE INDEX "warranty_claims_list_idx" ON "warranty_claims" USING btree ("entity_id","state","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "warranty_claims_account_idx" ON "warranty_claims" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "warranty_claims_serial_idx" ON "warranty_claims" USING btree ("serial_id") WHERE "warranty_claims"."serial_id" is not null;--> statement-breakpoint
CREATE INDEX "warranty_claims_replacement_serial_idx" ON "warranty_claims" USING btree ("replacement_serial_id") WHERE "warranty_claims"."replacement_serial_id" is not null;--> statement-breakpoint
CREATE INDEX "warranty_claims_supplier_serial_idx" ON "warranty_claims" USING btree ("supplier_serial_id") WHERE "warranty_claims"."supplier_serial_id" is not null;--> statement-breakpoint
CREATE INDEX "warranty_claims_vendor_idx" ON "warranty_claims" USING btree ("vendor_id") WHERE "warranty_claims"."vendor_id" is not null;--> statement-breakpoint
CREATE INDEX "warranty_claims_site_idx" ON "warranty_claims" USING btree ("site_id") WHERE "warranty_claims"."site_id" is not null;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_doc_type_check" CHECK ("document_sequences"."doc_type" in ('quote', 'sales_order', 'proforma', 'challan', 'purchase_order', 'warranty_claim')) NOT VALID;