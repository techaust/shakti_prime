-- Item categories become a fixed list with specifications per category (docs/DATABASE.md §6.3).
-- Items were never seeded, and no hosted environment holds any today (checked read-only), so a
-- row with a category outside the list or specifications that are not an object is refused rather
-- than changed: it needs a person to look at it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "items" WHERE "category" NOT IN ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other')) THEN
    RAISE EXCEPTION 'An item has a category outside the fixed list; give it one of the listed categories before this migration runs';
  END IF;
  IF EXISTS (SELECT 1 FROM "items" WHERE jsonb_typeof("specs_json") <> 'object') THEN
    RAISE EXCEPTION 'An item has specifications that are not an object; correct them before this migration runs';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "price_lists" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_check" CHECK ("items"."category" in ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_specs_object_check" CHECK (jsonb_typeof("items"."specs_json") = 'object');--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_approval_check" CHECK (("price_lists"."approved_by" is null) = ("price_lists"."approved_at" is null));