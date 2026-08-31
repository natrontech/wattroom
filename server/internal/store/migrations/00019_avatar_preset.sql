-- +goose Up
-- #253: rider-picked avatar preset id (client owns the catalog); null falls
-- back to the OAuth avatar_url, then to an initial.
alter table users add column avatar_preset text;

-- +goose Down
alter table users drop column avatar_preset;
