-- +goose Up
-- Calendar-feed secret (#245): calendar apps can't sign in, so the iCal URL
-- carries a per-room token. The volatile default backfills every existing
-- room with its own value and stamps each new room at insert.
alter table rooms add column ics_token text not null
    default replace(gen_random_uuid()::text, '-', '');

-- +goose Down
alter table rooms drop column ics_token;
