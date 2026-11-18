-- One person per dial phone in a company (T4 fix round, docs/03-roadmap-appendix/phase2.md §7.4);
-- the previous migration cleared any phone two people held.
CREATE UNIQUE INDEX "caller_profiles_entity_dial_phone_unique" ON "caller_profiles" USING btree ("entity_id","dial_phone_e164") WHERE "caller_profiles"."dial_phone_e164" is not null;