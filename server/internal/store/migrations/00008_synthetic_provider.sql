-- +goose Up

-- 'synthetic' is the production ride monitor (#153). It signs in with a bearer
-- from WATTROOM_SYNTHETIC_TOKEN rather than OAuth, but goes through the same
-- identities row and the same session machinery as everyone else — one code
-- path, no side door. Absent the env var the route does not exist at all.
alter table identities drop constraint identities_provider_check;
alter table identities add constraint identities_provider_check
    check (provider in ('google', 'github', 'strava', 'dev', 'synthetic'));

-- +goose Down
alter table identities drop constraint identities_provider_check;
alter table identities add constraint identities_provider_check
    check (provider in ('google', 'github', 'strava', 'dev'));
