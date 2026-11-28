DROP INDEX "projects_entity_state_updated_idx";--> statement-breakpoint
CREATE INDEX "projects_entity_updated_idx" ON "projects" USING btree ("entity_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "projects_entity_state_updated_idx" ON "projects" USING btree ("entity_id","state","updated_at","id");