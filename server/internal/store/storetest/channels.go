package storetest

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// ChannelsFor does to one room what M9's migrations did to every room that
// existed (#2428, #2432): gives it a crew when the fixture made none, puts its
// people in the crew — a room ban becoming a crew ban — and makes it one text
// and one voice channel with its name and its gate, a private room's people
// named into both. Person visibility reads channels since #2465, so a room
// fixture that means "these riders share a room" calls this once its
// memberships and grants are written, and again after it changes them.
//
// ponytail: dies with the room fixtures when #2446 deletes the rooms package.
func ChannelsFor(t testing.TB, st *store.Store, room pgtype.UUID) {
	t.Helper()
	ctx := context.Background()
	var crew pgtype.UUID
	if err := st.Pool.QueryRow(ctx, `
		with made as (
			insert into crews (name, owner_id, founded_by, code)
			select name, owner_id, owner_id, $2
			from rooms where id = $1 and crew_id is null
			returning id
		)
		update rooms set crew_id = (select id from made)
		where id = $1 and exists (select 1 from made)
		returning crew_id`, room, testx.CrewCode()).Scan(&crew); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("crew for room: %v", err)
	} else if err == nil {
		// The crew holds the room back (restrict), so the room goes first.
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(ctx, "delete from rooms where id = $1", room)
			_, _ = st.Pool.Exec(ctx, "delete from crews where id = $1", crew)
		})
	}
	for _, stmt := range []string{
		`insert into crew_roles (crew_id, user_id, role)
		 select r.crew_id, m.user_id, 'member' from memberships m
		 join rooms r on r.id = m.room_id join crews c on c.id = r.crew_id
		 where m.room_id = $1 and m.role <> 'banned' and m.user_id <> c.owner_id
		 on conflict do nothing`,
		`insert into crew_roles (crew_id, user_id, role)
		 select r.crew_id, m.user_id, 'banned' from memberships m
		 join rooms r on r.id = m.room_id join crews c on c.id = r.crew_id
		 where m.room_id = $1 and m.role = 'banned' and m.user_id <> c.owner_id
		 on conflict (crew_id, user_id) do update set role = 'banned'`,
		`with src as (
			select r.id as room_id, gen_random_uuid() as text_id, gen_random_uuid() as voice_id,
			       r.crew_id, r.name, not r.crew_visible as private
			from rooms r
			where r.id = $1 and not exists (select 1 from room_channels rc where rc.room_id = r.id)
		), made as (
			insert into channels (id, crew_id, kind, name, position, private)
			select text_id, crew_id, 'text', name, 0, private from src
			union all
			select voice_id, crew_id, 'voice', name, 0, private from src
		)
		insert into room_channels (room_id, text_channel_id, voice_channel_id)
		select room_id, text_id, voice_id from src`,
		`insert into channel_members (channel_id, user_id)
		 select ch, p.user_id from room_channels rc
		 join rooms r on r.id = rc.room_id
		 cross join lateral (values (rc.text_channel_id), (rc.voice_channel_id)) as v (ch)
		 join (select room_id, user_id from memberships where role <> 'banned'
		       union select room_id, user_id from room_grants) p on p.room_id = rc.room_id
		 where rc.room_id = $1 and not r.crew_visible
		 on conflict do nothing`,
	} {
		if _, err := st.Pool.Exec(ctx, stmt, room); err != nil {
			t.Fatalf("channels for room: %v", err)
		}
	}
}
