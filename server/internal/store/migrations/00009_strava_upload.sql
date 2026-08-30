-- +goose Up
-- Auto-upload to the rider's own Strava (#34). Default ON: connecting Strava
-- to a training app is the ask; the profile carries the escape for riders who
-- used it purely as a login. Upload-only is locked (WATTROOM.md) — nothing is
-- ever pulled or shown to others.
alter table users
    add column strava_upload boolean not null default true;

-- +goose Down
alter table users drop column strava_upload;
