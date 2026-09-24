-- +goose Up
-- A poke between friends is a line in their thread (#2721): who poked and
-- when is the record, and the words beside it are optional. Every line the
-- release before this one wrote is a message, which is what the default
-- says — so that release reads the table as it always did, and a rollback
-- only shows a poke as the words it carried (a bare one as an empty line).
alter table dm_messages add column poke boolean not null default false;

-- +goose Down
alter table dm_messages drop column poke;
