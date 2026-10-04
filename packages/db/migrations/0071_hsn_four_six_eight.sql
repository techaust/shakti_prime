-- HSN codes have 4, 6 or 8 digits (the contracts' `HsnSchema`), on items and GST rates alike. A
-- row with 5 or 7 digits is refused rather than changed: it needs a person to look at it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "items" WHERE "hsn" !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$')
     OR EXISTS (SELECT 1 FROM "tax_rates" WHERE "hsn" IS NOT NULL AND "hsn" !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$') THEN
    RAISE EXCEPTION 'An item or a GST rate has an HSN code that is not 4, 6 or 8 digits; correct it before this migration runs';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_hsn_check";--> statement-breakpoint
ALTER TABLE "tax_rates" DROP CONSTRAINT "tax_rates_hsn_check";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_hsn_check" CHECK ("items"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_hsn_check" CHECK ("tax_rates"."hsn" is null or "tax_rates"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');