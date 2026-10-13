-- Audit 2026-10, DATA-7 and DATA-8. The GST split checks are added NOT VALID, so the deploy
-- scans no quote or order under its lock; the lead session validates them after the deploy
-- (`alter table … validate constraint …`, DATABASE §8). The company index of `files` is a prefix
-- of `files_entity_purpose_created_idx`, which serves every read the dropped one did.
DROP INDEX "files_entity_idx";--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_gst_split_check" CHECK ("quote_lines"."igst" = 0 or ("quote_lines"."cgst" = 0 and "quote_lines"."sgst" = 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_gst_split_check" CHECK (("quotes"."supply_kind" = 'intra' and "quotes"."igst" = 0) or ("quotes"."supply_kind" = 'inter' and "quotes"."cgst" = 0 and "quotes"."sgst" = 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_gst_split_check" CHECK ("sales_order_lines"."igst" = 0 or ("sales_order_lines"."cgst" = 0 and "sales_order_lines"."sgst" = 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_gst_split_check" CHECK (("sales_orders"."supply_kind" = 'intra' and "sales_orders"."igst" = 0) or ("sales_orders"."supply_kind" = 'inter' and "sales_orders"."cgst" = 0 and "sales_orders"."sgst" = 0)) NOT VALID;
