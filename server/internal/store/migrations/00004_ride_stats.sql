-- +goose Up

-- The stats pipeline (#25) writes what it computes: the power curve feeds the
-- 90-day rolling category and the FTP prompt (#26), XP feeds levels. Both are
-- per-ride facts, so they live on the ride.
alter table rides add column curve jsonb;
alter table rides add column xp integer not null default 0;

-- +goose Down
alter table rides drop column curve;
alter table rides drop column xp;
