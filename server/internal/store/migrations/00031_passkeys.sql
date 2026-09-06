-- +goose Up
-- Passkeys (#782, ADR-0029): a credential in the account's credential set,
-- beside the OAuth identities. Discoverable, so signing in needs no identifier
-- at all — the browser resolves the account from the credential itself.
create table passkeys (
    -- The raw credential id the authenticator minted. Primary key because it is
    -- what a discoverable login arrives with, before any account is known.
    credential_id bytea primary key,
    user_id       uuid not null references users (id) on delete cascade,
    -- go-webauthn's own Credential record, stored the way that library
    -- serialises it. Nothing here is ever queried on, and shredding it into
    -- columns would only be a second copy of its struct, free to drift from it.
    -- The signature counter lives in here and is rewritten on every login.
    credential    jsonb not null,
    -- The rider's label for the thing in their pocket ("YubiKey", "iPhone").
    name          text not null,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz
);

create index passkeys_user on passkeys (user_id);

-- +goose Down
drop table passkeys;
