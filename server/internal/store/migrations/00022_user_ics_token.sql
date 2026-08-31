-- +goose Up
-- One feed per rider (#325). The room token (00016) addresses a room, so
-- riding in four rooms meant subscribing four times; this one addresses the
-- rider and follows their membership list. Same volatile-default backfill.
alter table users add column ics_token text not null
    default replace(gen_random_uuid()::text, '-', '');

-- +goose Down
alter table users drop column ics_token;
