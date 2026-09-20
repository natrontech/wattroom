-- +goose Up
-- What the rider says about a ride, as opposed to what the trainer recorded
-- (#2328): one Borg CR10 session rating and one sentence. Both optional, both
-- clearable — NULL is the normal state of these columns and always will be,
-- so neither gets a default and nothing backfills them.
--
-- The CHECK carries the scale's bounds, not its meaning: docs/SPEC.md "How a
-- ride felt" is where 1-10 is decided and the anchor words live. 0 is CR10's
-- "rest" and no saved ride is one, so the floor is 1 — the same rule as
-- ftp_watts, where the product number lives in SPEC and the column refuses
-- only what is not a number of that kind at all.
--
-- `note` takes no length CHECK. The 500-character bound is counted in RUNES
-- at the boundary (#1986: characters, not bytes) and a `char_length` CHECK
-- would be a second, differently-spelled answer to the same question that
-- silently disagrees with the first on any multi-byte note.
--
-- Privacy is structural here, not enforced by this file: ADR-0055 keeps the
-- note off every non-owner read, and the projections that would carry it name
-- their columns explicitly, so a leak takes an edit rather than an oversight.
--
-- Expand/contract (ADR-0019): a release only ADDS — two nullable columns, no
-- default, no table rewrite.
alter table rides add column rpe smallint check (rpe between 1 and 10);
alter table rides add column note text;

-- +goose Down
alter table rides drop column note;
alter table rides drop column rpe;
