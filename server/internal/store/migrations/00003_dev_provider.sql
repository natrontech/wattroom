-- +goose Up

-- 'dev' is a real provider, guarded by WATTROOM_DEV_LOGIN=1 at runtime: with no
-- OAuth apps registered a dev machine had no way to sign in at all, and every
-- rooms/roles flow needs a session. Going through the same identities row keeps
-- one code path — no side door.
alter table identities drop constraint identities_provider_check;
alter table identities add constraint identities_provider_check
    check (provider in ('google', 'github', 'strava', 'dev'));

-- +goose Down
alter table identities drop constraint identities_provider_check;
alter table identities add constraint identities_provider_check
    check (provider in ('google', 'github', 'strava'));
