-- +goose Up
-- Email notifications for planned sessions (#117). The address is typed in on
-- the profile, never pulled from OAuth; the opt-in defaults off because these
-- emails leave the platform (privacy is architecture). unsub_token lets every
-- mail carry an unsubscribe link that works without signing in.
alter table users
    add column email text,
    add column notify_planned boolean not null default false,
    add column unsub_token uuid not null default gen_random_uuid();

-- +goose Down
alter table users
    drop column email,
    drop column notify_planned,
    drop column unsub_token;
