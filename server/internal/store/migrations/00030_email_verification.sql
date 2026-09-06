-- +goose Up
-- Email becomes a verified account attribute (#781, ADR-0029): the way back in
-- when every provider and passkey is gone. Expand-only per ADR-0019 — `email`
-- keeps exactly its old meaning (the live address session mail goes to) and
-- nothing is dropped, so the previous release still runs against this schema.
--
-- One path writes these: PATCH /api/me only ever fills email_pending and the
-- token, and only the confirm handler promotes pending into email. That is what
-- keeps a verified address live while a replacement is still unconfirmed.
alter table users
    add column email_verified_at    timestamptz,
    add column email_pending        text,
    -- SHA-256 of the emailed token, never the token itself — the same rule
    -- sessions follow, so a leaked table cannot verify anybody's address.
    add column email_verify_hash    bytea,
    add column email_verify_expires timestamptz,
    -- Accounts created from here on must verify before they can ride; the ones
    -- that predate this migration keep the default and are only asked (#781).
    -- A column rather than a created_at cutoff: the question is whether this
    -- rider was ever onboarded with the requirement, not when they signed up.
    add column email_required       boolean not null default false;

-- Two accounts cannot both hold one verified address. Partial on purpose:
-- unverified and pending addresses stay unconstrained because they prove
-- nothing yet, and every row is unverified the moment this runs.
create unique index users_email_verified on users (lower(email))
    where email_verified_at is not null;

-- +goose Down
drop index users_email_verified;
alter table users
    drop column email_verified_at,
    drop column email_pending,
    drop column email_verify_hash,
    drop column email_verify_expires,
    drop column email_required;
