ALTER TABLE "quotes" DROP CONSTRAINT "quotes_acceptance_check";--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_acceptance_check" CHECK (("quotes"."state" <> 'accepted' or "quotes"."accepted_via" is not null)
       and ("quotes"."accepted_via" is null or "quotes"."state" in ('accepted', 'withdrawn'))
       and ("quotes"."signed_file_id" is not null) = ("quotes"."accepted_via" is not distinct from 'signed_upload'));