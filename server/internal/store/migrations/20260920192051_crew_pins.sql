-- +goose Up
-- The crew's pin board (ADR-0056, #2405): the handful of facts a crew keeps
-- needing that nothing else holds — a game server and its password, the
-- Discord link, the door code. Chat cannot hold them, because PruneChat caps
-- a room at 500 lines and anything posted there is on a timer.
--
-- Owned by the CREW, not a room. Every room of a crew shows the same board,
-- which is why this hangs off crews and not rooms: a fact about the server
-- the crew plays on is not true in one room and false in the next.
--
-- ON DELETE CASCADE on crew_id, unlike crews' own RESTRICT from rooms: a pin
-- is the crew's own writing and nothing of it survives the crew. `created_by`
-- is SET NULL rather than CASCADE — a pin belongs to the board, and a member
-- deleting their account must not take the door code with them (WATTROOM.md's
-- purge is worth more than the attribution, never more than the board).
--
-- A pin is a title and a BODY, not a key and a value: one thing worth pinning
-- is rarely one string, and which of the body's lines are copyable is the
-- client's reading of it rather than a column here.
--
-- No length CHECKs. The bounds are counted in RUNES at the boundary
-- (protocol.MaxPinTitleChars, MaxPinBodyChars; #1986: characters, not bytes),
-- and a char_length CHECK would be a second, differently-spelled answer to
-- the same question that silently disagrees on any multi-byte pin — the
-- reasoning rides.note was given one release ago.
--
-- Expand/contract (ADR-0019): a release only ADDS — one new table, one index.
create table crew_pins (
    id         uuid primary key default gen_random_uuid(),
    crew_id    uuid not null references crews (id) on delete cascade,
    title      text not null,
    body       text not null,
    created_by uuid references users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- The board's only read is "this crew's pins, oldest first". The id breaks a
-- same-millisecond tie, so two reads agree on the order the way ListRoomChat's
-- does (#468).
create index crew_pins_crew_created on crew_pins (crew_id, created_at, id);

-- +goose Down
drop table crew_pins;
