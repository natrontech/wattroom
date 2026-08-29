-- +goose Up

-- Post-ride medals (#28): awarded per closed group session, kept as room
-- history. A medal references its ride so the evidence survives with it.
create table medals (
    id         uuid primary key default gen_random_uuid(),
    room_id    uuid not null references rooms (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    ride_id    uuid not null references rides (id) on delete cascade,
    kind       text not null check (kind in ('diesel', 'metronome', 'hammer', 'lanterne_rouge')),
    awarded_at timestamptz not null default now()
);

create index medals_room on medals (room_id, awarded_at desc);

-- +goose Down
drop table medals;
