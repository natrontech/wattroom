-- +goose Up
-- Channels: the room dissolves into the crew (ADR-0058, #2428). A crew keeps
-- identity; below it are text channels (a name, a gate, a scrollback) and
-- voice channels (a name, a gate, a deck, who is in it). Every room becomes
-- one of each, with the room's name and the room's gate.
--
-- NOTHING READS ANY OF THIS YET. The rest of M9 re-keys chat, the jukebox,
-- sessions and membership onto these tables through `room_channels`, and
-- `rooms`, `memberships` and `room_grants` stay exactly as they are until the
-- release after M9 drops them (#2433). The release before this one never
-- touches the new tables, so retagging to it is safe (ADR-0019).
--
-- One rule governs the backfill, ADR-0058's: nobody can reach anything after
-- this migration that they could not reach before it. Where the new shape
-- cannot say exactly what the old one said, it takes the narrow side.

create table channels (
    id         uuid primary key default gen_random_uuid(),
    -- A channel belongs to one crew for good (ADR-0058, carrying ADR-0038's
    -- argument for rooms). Cascade: a channel is the crew's furniture and has
    -- no life without it.
    crew_id    uuid not null references crews (id) on delete cascade,
    kind       text not null check (kind in ('text', 'voice')),
    -- docs/SPEC.md: a crew or channel name is 1–60 characters.
    name       text not null check (char_length(name) between 1 and 60),
    -- Order within the crew's text list or its voice list, whichever `kind`
    -- puts it in. Not unique: reordering moves rows through each other, and a
    -- unique index would make every drag the two-step shuffle playlist tracks
    -- need.
    position   integer not null,
    -- Open (false) admits every member of the crew who is not banned; private
    -- admits the crew's owner, its admins and the members named into it
    -- (docs/SPEC.md, ADR-0058). Open is what a NEW channel is. Rooms that
    -- existed are backfilled below from their own gate, never from this.
    private    boolean not null default false,
    -- The room's vocabulary, not a new one: `rooms.sound_pack` is 'base' or
    -- 'silent' and the API refuses anything else. Only a voice channel's is
    -- ever heard; a text channel carries the default.
    sound_pack text not null default 'base' check (sound_pack in ('base', 'silent')),
    created_at timestamptz not null default now()
);

create index channels_crew on channels (crew_id, kind, position);

-- The named members of a PRIVATE channel — the successor of `room_grants`,
-- and of the membership rows that admitted people to a private room. An open
-- channel needs none: the crew is its audience.
create table channel_members (
    channel_id uuid not null references channels (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    -- Who named them. Null for everyone the backfill carried over, and for
    -- anyone whose namer has since deleted their account — the admission
    -- outlives the person who made it, as a grant did.
    added_by   uuid references users (id) on delete set null,
    added_at   timestamptz not null default now(),
    primary key (channel_id, user_id)
);

create index channel_members_user on channel_members (user_id);

-- Which channels each room became. Every later backfill in M9 reads this, and
-- so does the redirect that keeps old `/r/{slug}` links landing somewhere
-- (#2446, #2458). Set null rather than cascade on the channel side: deleting a
-- channel must not erase the record that a room once pointed at it, and a
-- redirect with no text channel left is a case the reader handles.
create table room_channels (
    room_id          uuid primary key references rooms (id) on delete cascade,
    text_channel_id  uuid references channels (id) on delete set null,
    voice_channel_id uuid references channels (id) on delete set null
);

-- +goose StatementBegin
do $$
declare
    crewless integer;
begin
    -- Every room has had a crew since the cutover (ADR-0038), and #2332 put it
    -- in the insert. A room without one here is a bug somewhere else, and
    -- skipping it would quietly strand its chat and its deck in the rest of
    -- M9's backfills. Refuse loudly instead: #2462 runs this against a copy of
    -- production before any release does.
    select count(*) into crewless from rooms where crew_id is null;
    if crewless > 0 then
        raise exception 'channels: % room(s) have no crew to become channels of; place them in one first', crewless;
    end if;
end $$;
-- +goose StatementEnd

-- One text and one voice channel per room: the room's name, the room's gate,
-- ordered within the crew by when the rooms were made. The room's sound pack
-- goes to its voice channel, where sounds are heard. A private room's people
-- become both of its channels' named members: its live memberships and its
-- grants, minus anyone the room banned — a room ban beat a grant in
-- `visible_rooms` and must still beat it here. An open room's channels get no
-- named members; the crew is their audience.
--
-- One statement, so the ids minted in `src` are the same ids in all four
-- inserts; the foreign keys between them are checked when it ends. `where not
-- exists` makes it re-runnable: it only adopts rooms that have no channels
-- yet, so a later migration can repeat it word for word for any room a
-- rolled-back release created in between.
with src as (
    select
        r.id              as room_id,
        gen_random_uuid() as text_channel_id,
        gen_random_uuid() as voice_channel_id,
        r.crew_id,
        -- Room names were held to 1–60 by the API, never by a CHECK. Held to
        -- it here too, so one row the API let through long ago cannot stop the
        -- boot.
        left(coalesce(nullif(btrim(r.name), ''), 'general'), 60) as name,
        not r.crew_visible as private,
        r.sound_pack,
        r.created_at,
        (coalesce((select max(c.position) + 1 from channels c where c.crew_id = r.crew_id), 0)
            + row_number() over (partition by r.crew_id order by r.created_at, r.id) - 1)::integer as position
    from rooms r
    where not exists (select 1 from room_channels rc where rc.room_id = r.id)
),
text_channels as (
    insert into channels (id, crew_id, kind, name, position, private, sound_pack, created_at)
    select text_channel_id, crew_id, 'text', name, position, private, 'base', created_at from src
),
voice_channels as (
    insert into channels (id, crew_id, kind, name, position, private, sound_pack, created_at)
    select voice_channel_id, crew_id, 'voice', name, position, private, sound_pack, created_at from src
),
mapping as (
    insert into room_channels (room_id, text_channel_id, voice_channel_id)
    select room_id, text_channel_id, voice_channel_id from src
)
insert into channel_members (channel_id, user_id, added_by, added_at)
select ch.channel_id, p.user_id, null, p.since
from src
cross join lateral (values (src.text_channel_id), (src.voice_channel_id)) as ch (channel_id)
join (
    select m.room_id, m.user_id, m.joined_at as since
    from memberships m
    where m.role <> 'banned'
    union all
    select g.room_id, g.user_id, g.granted_at
    from room_grants g
) p on p.room_id = src.room_id
where src.private
  and not exists (
      select 1 from memberships b
      where b.room_id = src.room_id and b.user_id = p.user_id and b.role = 'banned'
  )
on conflict (channel_id, user_id) do nothing;

-- +goose Down
drop table room_channels;
drop table channel_members;
drop table channels;
