-- Parent unique keys first: the composite foreign keys below reference them.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_entity_unique" UNIQUE("id","entity_id");
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_id_entity_unique" UNIQUE("id","entity_id");
--> statement-breakpoint
ALTER TABLE "customer_sites" ADD CONSTRAINT "customer_sites_id_entity_unique" UNIQUE("id","entity_id");
--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_account_entity_fk" FOREIGN KEY ("account_id","entity_id") REFERENCES "public"."accounts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_contacts" ADD CONSTRAINT "account_contacts_contact_entity_fk" FOREIGN KEY ("contact_id","entity_id") REFERENCES "public"."contacts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_entity_fk" FOREIGN KEY ("contact_id","entity_id") REFERENCES "public"."contacts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_phones" ADD CONSTRAINT "contact_phones_contact_entity_fk" FOREIGN KEY ("contact_id","entity_id") REFERENCES "public"."contacts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_sites" ADD CONSTRAINT "customer_sites_account_entity_fk" FOREIGN KEY ("account_id","entity_id") REFERENCES "public"."accounts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_entity_fk" FOREIGN KEY ("account_id","entity_id") REFERENCES "public"."accounts"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_site_entity_fk" FOREIGN KEY ("site_id","entity_id") REFERENCES "public"."customer_sites"("id","entity_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "account_contacts_contact_idx" ON "account_contacts" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX "accounts_entity_team_idx" ON "accounts" USING btree ("entity_id","team_id");
--> statement-breakpoint
CREATE INDEX "accounts_tier_idx" ON "accounts" USING btree ("tier_id");
--> statement-breakpoint
CREATE INDEX "contacts_entity_team_idx" ON "contacts" USING btree ("entity_id","team_id");
--> statement-breakpoint
CREATE INDEX "kit_components_item_idx" ON "kit_components" USING btree ("item_id");
--> statement-breakpoint
CREATE INDEX "opportunities_pipeline_stage_idx" ON "opportunities" USING btree ("pipeline_id","stage_id");
--> statement-breakpoint
CREATE INDEX "opportunities_site_idx" ON "opportunities" USING btree ("site_id");
--> statement-breakpoint
CREATE INDEX "opportunities_source_idx" ON "opportunities" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "price_change_log_item_idx" ON "price_change_log" USING btree ("price_list_item_id","created_at");
--> statement-breakpoint
CREATE INDEX "price_list_items_item_idx" ON "price_list_items" USING btree ("item_id");
--> statement-breakpoint
CREATE INDEX "price_list_items_kit_idx" ON "price_list_items" USING btree ("kit_id");
--> statement-breakpoint
CREATE INDEX "teams_entity_idx" ON "teams" USING btree ("entity_id");
