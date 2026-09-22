package store

// Crew membership takes over what room membership carried (ADR-0058, #2432).
// Written one version short of the CHANNELS migration, because every M9
// migration runs in the same boot at the release.
//
// Every assertion here guards a quiet widening, ADR-0058's migration rule: a
// rider readmitted by a room ban that did not become a crew ban, a room owner
// promoted into every private channel, or a rider from a board-off room
// waking up on the crew's board without the door ever having asked.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestCrewMembershipTakesOverFromTheRooms(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	user := func(name string) string {
		return insertID(ctx, t, pool, `insert into users (display_name) values ($1) returning id`, name)
	}
	var (
		owner      = user("Crew owner")
		roomOwner  = user("Room owner")
		admin      = user("Admin")
		onBoard    = user("On A's board")
		optedOut   = user("Opted out of A's board")
		boardless  = user("Only in board-off B")
		banned     = user("Banned in B, welcome in A")
		doorOnly   = user("Joined at the door, no rooms")
		crew       = insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Thursday Crew', $1, 'THURSD') returning id`, owner)
		base       = time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC)
		roomTokens = map[string]bool{}
	)
	room := func(slug, ownerID string, open, board, listed bool, cheers string, made time.Time) string {
		var id, token string
		if err := pool.QueryRow(ctx, `
			insert into rooms (slug, name, owner_id, crew_id, crew_visible, board_enabled, listed, cheers, created_at)
			values ($1, $1, $2, $3, $4, $5, $6, $7, $8) returning id, ics_token`,
			slug, ownerID, crew, open, board, listed, cheers, made).Scan(&id, &token); err != nil {
			t.Fatalf("room %s: %v", slug, err)
		}
		roomTokens[token] = true
		return id
	}
	lounge := room("lounge", owner, true, true, true, "flame skull", base)
	painCave := room("pain-cave", roomOwner, false, false, false, "rocket", base.Add(time.Hour))

	member := func(roomID, userID, role string, notify, board bool, joined time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			insert into memberships (room_id, user_id, role, notify, on_board, joined_at) values ($1, $2, $3, $4, $5, $6)`,
			roomID, userID, role, notify, board, joined); err != nil {
			t.Fatalf("membership: %v", err)
		}
	}
	member(lounge, owner, "owner", true, true, base)
	member(painCave, owner, "banned", true, true, base.Add(2*time.Hour)) // the crew's owner, banned by a room's
	member(painCave, roomOwner, "owner", true, true, base.Add(time.Hour))
	member(lounge, admin, "member", true, true, base.Add(3*time.Hour))
	member(lounge, onBoard, "member", true, true, base.Add(4*time.Hour))
	member(lounge, optedOut, "member", true, false, base.Add(5*time.Hour))
	member(painCave, boardless, "member", false, true, base.Add(-time.Hour)) // the earliest joiner of all
	member(lounge, banned, "member", true, true, base.Add(6*time.Hour))
	member(painCave, banned, "banned", true, true, base.Add(7*time.Hour))
	for _, r := range []struct{ user, role string }{{admin, "admin"}, {onBoard, "member"}, {doorOnly, "member"}} {
		if _, err := pool.Exec(ctx, `insert into crew_roles (crew_id, user_id, role) values ($1, $2, $3)`, crew, r.user, r.role); err != nil {
			t.Fatalf("crew_roles: %v", err)
		}
	}

	if err := migrateScratchUp(ctx, pool); err != nil {
		t.Fatalf("migrate over the crew: %v", err)
	}

	type row struct {
		role            string
		notify, onBoard bool
		joined          *time.Time
	}
	read := func(userID string) (row, bool) {
		var r row
		err := pool.QueryRow(ctx,
			`select role, notify, on_board, joined_at from crew_roles where crew_id = $1 and user_id = $2`, crew, userID).
			Scan(&r.role, &r.notify, &r.onBoard, &r.joined)
		return r, err == nil
	}

	t.Run("every room member is a crew member", func(t *testing.T) {
		var missing int
		if err := pool.QueryRow(ctx, `
			select count(*) from memberships m join rooms r on r.id = m.room_id
			where m.role <> 'banned' and not exists (
			    select 1 from crew_roles cr where cr.crew_id = r.crew_id and cr.user_id = m.user_id)`).Scan(&missing); err != nil {
			t.Fatalf("count: %v", err)
		}
		if missing != 0 {
			t.Errorf("%d room member(s) have no crew row", missing)
		}
		if r, ok := read(boardless); !ok || !r.joined.Equal(base.Add(-time.Hour)) {
			t.Errorf("a rider added from a room joined the crew at %v, want when they joined the room (%s)", r.joined, base.Add(-time.Hour))
		}
	})

	t.Run("a room owner comes in as a member, not an admin", func(t *testing.T) {
		if r, _ := read(roomOwner); r.role != "member" {
			t.Errorf("the room's owner is a crew %q; an admin enters every private channel", r.role)
		}
		if r, _ := read(admin); r.role != "admin" {
			t.Errorf("an existing admin became %q", r.role)
		}
	})

	t.Run("a room ban becomes a crew ban, except on the owner", func(t *testing.T) {
		if r, _ := read(banned); r.role != "banned" {
			t.Errorf("a rider banned from a room is a crew %q; they can walk into its channels", r.role)
		}
		if r, ok := read(owner); !ok || r.role == "banned" {
			t.Errorf("the crew's owner came out %q (row present: %v); the owner cannot be banned", r.role, ok)
		}
	})

	t.Run("only riders who were on a board are on the crew's board", func(t *testing.T) {
		for who, c := range map[string]struct {
			id   string
			want bool
		}{
			"a rider on the lounge's board":            {onBoard, true},
			"an admin on the lounge's board":           {admin, true},
			"a rider who opted out of the lounge's":    {optedOut, false},
			"a rider only in a room with no board":     {boardless, false},
			"a rider who joined at the door, no rooms": {doorOnly, false},
		} {
			r, ok := read(c.id)
			if !ok {
				t.Fatalf("%s has no crew row", who)
			}
			if r.onBoard != c.want {
				t.Errorf("%s: on_board = %v, want %v", who, r.onBoard, c.want)
			}
		}
	})

	t.Run("planned-session mail stays as the rider left it", func(t *testing.T) {
		if r, _ := read(boardless); r.notify {
			t.Error("a rider who turned it off in their only room has it on again")
		}
		if r, _ := read(doorOnly); !r.notify {
			t.Error("a rider in no room lost it, though they never said no")
		}
	})

	t.Run("the crew takes its rooms' switches and a fresh calendar token", func(t *testing.T) {
		var board, listed bool
		var cheers, token string
		if err := pool.QueryRow(ctx, `select board_enabled, listed, cheers, ics_token from crews where id = $1`, crew).
			Scan(&board, &listed, &cheers, &token); err != nil {
			t.Fatalf("crew: %v", err)
		}
		if !board || !listed {
			t.Errorf("board_enabled %v, listed %v; a room had each on", board, listed)
		}
		if cheers != "flame skull" {
			t.Errorf("cheers %q, want the oldest room's set", cheers)
		}
		if token == "" || roomTokens[token] {
			t.Errorf("the crew's calendar token %q is empty or a room's; old room feeds must not reach it", token)
		}
	})

	t.Run("succession reads the rows, by when a rider joined", func(t *testing.T) {
		q := db.New(pool)
		got, err := q.PickCrewSuccessor(ctx, db.PickCrewSuccessorParams{CrewID: uuidOf(t, crew), Departing: uuidOf(t, owner)})
		if err != nil || UUIDString(got) != admin {
			t.Fatalf("successor %s (%v), want the admin", UUIDString(got), err)
		}
		if _, err := pool.Exec(ctx, `update crew_roles set role = 'member' where crew_id = $1 and user_id = $2`, crew, admin); err != nil {
			t.Fatalf("demote: %v", err)
		}
		got, err = q.PickCrewSuccessor(ctx, db.PickCrewSuccessorParams{CrewID: uuidOf(t, crew), Departing: uuidOf(t, owner)})
		if err != nil || UUIDString(got) != boardless {
			t.Fatalf("successor %s (%v), want the longest-standing member, who joined a room before anyone", UUIDString(got), err)
		}
	})
}

func uuidOf(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	id, err := ParseUUID(s)
	if err != nil {
		t.Fatalf("uuid %q: %v", s, err)
	}
	return id
}
