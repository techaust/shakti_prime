ALTER TABLE "import_rows" DROP CONSTRAINT "import_rows_created_type_check";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "warranty_months" smallint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "supplier_warranty_months" smallint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "purchase_unit" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "purchase_unit_factor" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "serial_pattern" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_stocked" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "items_barcode_unique" ON "items" USING btree ("barcode") WHERE "items"."barcode" is not null;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_type_check" CHECK ("import_rows"."created_type" in ('opportunity', 'account', 'account_link', 'pin_code', 'item')) NOT VALID;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_warranty_months_check" CHECK (("items"."warranty_months" is null or "items"."warranty_months" between 0 and 360) and ("items"."supplier_warranty_months" is null or "items"."supplier_warranty_months" between 0 and 360));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_barcode_check" CHECK ("items"."barcode" ~ '^[!-~]{4,64}$');--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_unit_check" CHECK ("items"."purchase_unit" in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_factor_check" CHECK (("items"."purchase_unit_factor" is null or "items"."purchase_unit_factor" >= 1) and ("items"."purchase_unit" is not null or "items"."purchase_unit_factor" is null) and ("items"."purchase_unit" is null or "items"."purchase_unit" = "items"."unit" or "items"."purchase_unit_factor" is not null) and ("items"."purchase_unit" is distinct from "items"."unit" or "items"."purchase_unit_factor" is null or "items"."purchase_unit_factor" = 1));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_serial_pattern_check" CHECK ("items"."serial_pattern" is null or ("items"."is_serial_tracked" and char_length("items"."serial_pattern") between 1 and 200));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_stocked_check" CHECK ("items"."is_stocked" or (not "items"."is_serial_tracked" and "items"."category" in ('other')));