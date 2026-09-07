-- +goose Up
-- The Strava refresh token stops being the one credential held in the clear
-- (#697). It is the only stored-and-reused one: sessions are hashed, because
-- nothing needs those back.
--
-- Expand/contract (ADR-0019): this release only ADDS the sealed column. The
-- plaintext one stays in the schema and is dropped a release after the code
-- has stopped reading it, so retagging to the previous image still finds a
-- table it understands.
--
-- Nullable, and it stays null on every deployment with no WATTROOM_TOKEN_KEY
-- set — a server without a key keeps behaving exactly as it did, which is what
-- lets this ship before the key is provisioned.
alter table identities add column refresh_token_enc bytea;

-- +goose Down
alter table identities drop column refresh_token_enc;
