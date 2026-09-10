-- +goose Up
-- The way back in when every credential is gone (#1822, ADR-0029 promised it):
-- a hashed single-use token mailed to the account's verified address, on the
-- same idiom as email_verify_hash above it — SHA-256 of the token and an
-- expiry, never the token, so a leaked table recovers nobody's account.
--
-- Its own pair of columns rather than reusing the verification ones: the two
-- ceremonies overlap in time (a rider can be confirming a new address while a
-- recovery link is live) and they unlock different things — one moves an
-- address, the other mints a session.
--
-- Expand/contract (ADR-0019): two nullable columns, nothing dropped, so the
-- release before this one runs against this schema untouched.
alter table users
    add column recover_hash    bytea,
    add column recover_expires timestamptz;

-- +goose Down
alter table users
    drop column recover_hash,
    drop column recover_expires;
