-- +goose Up
-- Whether a person has named the crew (#1151's day-one placeholder is the
-- owner's display name). Three surfaces guessed it by comparing the name to
-- the owner's CURRENT display name, so renaming yourself retired the "name
-- your crew" step and naming the crew after yourself never did (audit
-- 2026-09-09). Nullable (expand, ADR-0019); backfilled where the name already
-- differs from the owner's, which is the only evidence there was.
alter table crews add column renamed_at timestamptz;
update crews c set renamed_at = c.created_at
  from users u
 where u.id = c.owner_id and c.name <> u.display_name and c.renamed_at is null;

-- +goose Down
alter table crews drop column renamed_at;
