-- +goose Up
-- The rider's IANA zone (#858), so a session email names a time they recognise
-- rather than the one on the server's clock. Nullable and additive per
-- ADR-0019: null means never reported, and the mail falls back to the server's
-- zone exactly as it did before this column existed.
--
-- Nobody types this. The browser already knows it, so the client reports it and
-- the value corrects itself when a rider moves — a timezone picker would fail
-- the 95% rule in .claude/rules/ux.md.
alter table users
    add column timezone text;

-- +goose Down
alter table users
    drop column timezone;
