-- +goose Up
-- The invite is the crew's (ADR-0038, amended 2026-09-08; #1236): a room's
-- own code opens nothing since 2026.09.51, and this release stops minting
-- one. Expand/contract (ADR-0019): the column only relaxes here so the
-- release before this one, which still writes a code, keeps working under
-- it; the column and its index go one release later.
alter table rooms alter column code drop not null;

-- +goose Down
-- Rows opened since this release carry no code; the reverse cannot invent
-- one without a collision, so it leaves the column nullable.
select 1;
