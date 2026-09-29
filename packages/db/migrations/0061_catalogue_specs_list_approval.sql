-- Item categories become a fixed list with specifications per category (docs/DATABASE.md §6.3).
-- Rows written before the list existed take the nearest category first: a panel is a solar
-- module, anything else unknown is `other`, and specifications that are not an object are empty.
UPDATE "items" SET "category" = 'solar_module' WHERE "category" = 'panel';--> statement-breakpoint
UPDATE "items" SET "category" = 'other' WHERE "category" not in ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other');--> statement-breakpoint
UPDATE "items" SET "specs_json" = '{}'::jsonb WHERE jsonb_typeof("specs_json") <> 'object';--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_check" CHECK ("items"."category" in ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_specs_object_check" CHECK (jsonb_typeof("items"."specs_json") = 'object');--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_approval_check" CHECK (("price_lists"."approved_by" is null) = ("price_lists"."approved_at" is null));