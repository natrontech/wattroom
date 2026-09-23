-- +goose Up
-- The contract (#2433, ADR-0058): the rooms go. ADR-0019's rule is what makes
-- this safe — the release before this one (#2558) reads and writes none of
-- it, so retagging to that release boots code that never asks for what is
-- gone here. The /r/{slug} redirect lives on in moved_rooms (#2558).
drop view visible_rooms;
drop table room_channels, room_reads, room_grants, memberships;

-- A room's playlist carries its crew since #2430; a crewless one could not
-- exist after ADR-0038, and this says so rather than guessing if one does.
-- +goose StatementBegin
do $$
begin
    if exists (select 1 from playlists where user_id is null and crew_id is null) then
        raise exception 'a playlist belongs to neither a rider nor a crew — resolve it before dropping rooms';
    end if;
end $$;
-- +goose StatementEnd
alter table playlists drop constraint playlists_one_owner;
alter table playlists drop column room_id;
alter table playlists add constraint playlists_one_owner check ((user_id is not null) <> (crew_id is not null));

alter table chat_messages drop column room_id;
alter table chat_images drop column room_id;
alter table track_plays drop column room_id;
alter table scheduled_sessions drop column room_id;
alter table session_recaps drop column room_id;
alter table medals drop column room_id;
alter table rides drop column room_id;
drop table rooms;

-- +goose Down
-- Forward-only: what this dropped was a copy of what M9 moved onto crews and
-- channels, and nothing can put the rooms back. Rollback is an image tag, never
-- the database (AGENTS.md).
select 1;
