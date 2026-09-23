-- +goose Up
-- Where an old room link lands, kept apart from the rooms (#2558). The
-- /r/{slug} redirect (#2458) read `rooms` joined to `room_channels`, and both
-- go in #2433; a link somebody pasted in 2026 should still open in 2027. This
-- holds only what the redirect answers — the slug, the crew and the two
-- channels the room became — and nothing that ever gated anything: the crew
-- and its channels keep their own doors (crews/moved.go).
--
-- No reference to rooms, so a room going (an owner's account deleted) no
-- longer takes its links with it. The crew going does: a link into a crew
-- that no longer exists has nowhere to land.
create table moved_rooms (
    slug             text primary key,
    crew_id          uuid not null references crews (id) on delete cascade,
    text_channel_id  uuid references channels (id) on delete set null,
    voice_channel_id uuid references channels (id) on delete set null
);

insert into moved_rooms (slug, crew_id, text_channel_id, voice_channel_id)
select lower(r.slug), r.crew_id, rc.text_channel_id, rc.voice_channel_id
from rooms r
join room_channels rc on rc.room_id = r.id
where r.crew_id is not null
on conflict (slug) do nothing;

-- The code from this release on never deletes a room row itself (#2558):
-- the rows are dead weight until #2433 drops them, and deleting a crew now
-- takes the ones still pointing at it instead of being refused by them.
alter table rooms drop constraint rooms_crew_id_fkey,
    add constraint rooms_crew_id_fkey foreign key (crew_id) references crews (id) on delete cascade;

-- +goose Down
alter table rooms drop constraint rooms_crew_id_fkey,
    add constraint rooms_crew_id_fkey foreign key (crew_id) references crews (id) on delete restrict;
drop table moved_rooms;
