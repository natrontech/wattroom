-- +goose Up
-- The contract half of #1038 (ADR-0035): a refresh token is stored sealed in
-- `refresh_token_enc` or not at all. 2026.10.3 is the release a rollback lands
-- on, and its binary names only `refresh_token_enc` (#4117).
alter table identities drop column refresh_token;

-- +goose Down
alter table identities add column refresh_token text;
