-- +goose Up
-- The contract half of #1353 (ADR-0019): #1354 stopped every read and
-- write of the preset in 2026.09.65, so the column goes one release later.
alter table users drop column avatar_preset;

-- +goose Down
alter table users add column avatar_preset text;
