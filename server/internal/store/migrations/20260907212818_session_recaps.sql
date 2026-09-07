-- +goose Up

-- The first thing in this app that survives a reload of a room's timeline
-- (ADR-0034): one row per finished session, saying who was there and for how
-- long. ADR-0022 keeps room events ephemeral and this does not change that —
-- the card is an artifact, not a persisted event stream, and `chat` is
-- untouched: no kind column, no migration, no filter on read.
--
-- Expand/contract (ADR-0019): a new table only. Nothing is dropped or renamed,
-- so the release before this one runs against it unharmed.
--
-- `riders` is jsonb rather than a child table because it is read whole, never
-- queried into, and is written exactly once: [{id, rider, from, to, rode}].
-- The `id` is the rider's user id, and it is the reason an account purge can
-- find the intervals it has to remove — a name cannot be trusted to identify
-- a person, and a ghost interval is still a record of one.
create table session_recaps (
    id         uuid primary key default gen_random_uuid(),
    room_id    uuid        not null references rooms (id) on delete cascade,
    workout    text        not null,
    started_at timestamptz not null,
    ended_at   timestamptz not null,
    riders     jsonb       not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

-- Both read paths lead with the room and order by when the session ended: the
-- backlog wants a room's most recent, the prune wants everyone's oldest.
create index session_recaps_room_ended on session_recaps (room_id, ended_at desc);
create index session_recaps_ended on session_recaps (ended_at);

-- A rider deleting their account has to leave every recap that names them, and
-- `riders` is a jsonb array — there is no foreign key here for `delete from
-- users` to cascade through, and an interval saying "someone left at 19:40" is
-- still a record of a person (ADR-0034).
--
-- A trigger rather than a second statement in the handler because it is the
-- only way to make the removal atomic with the delete: nothing on this server
-- runs in a transaction, every write is one sqlc call, and a purge that
-- half-happened is worse than either outcome. It also cannot be forgotten by
-- the next path that deletes a user.
--
-- ponytail: `@>` scans session_recaps without an index. The table holds one row
-- per session per room and account deletion is rare; add a GIN index on riders
-- if that ever stops being true.
-- +goose StatementBegin
create or replace function purge_recap_rider() returns trigger as $$
begin
    update session_recaps
    set riders = (
        select coalesce(jsonb_agg(entry), '[]'::jsonb)
        from jsonb_array_elements(riders) entry
        where entry ->> 'id' is distinct from old.id::text
    )
    where riders @> jsonb_build_array(jsonb_build_object('id', old.id::text));
    return old;
end;
$$ language plpgsql;
-- +goose StatementEnd

create trigger users_purge_recaps
    before delete on users
    for each row execute function purge_recap_rider();

-- +goose Down
drop trigger if exists users_purge_recaps on users;
drop function if exists purge_recap_rider();
drop table if exists session_recaps;
