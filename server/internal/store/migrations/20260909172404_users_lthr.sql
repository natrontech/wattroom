-- +goose Up
-- LTHR follows the account like FTP and weight (#1571): it lived in one
-- browser's localStorage, and the rider who measured it on the web found
-- "—" in the desktop app the same evening. Bounds are docs/SPEC.md's (the
-- web store's PROFILE_LIMITS). Expand only: nullable, nothing dropped.
alter table users add column lthr smallint check (lthr is null or lthr between 100 and 210);

-- +goose Down
alter table users drop column lthr;
