package store

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// The contract (#2433): the room tables and every room_id column go, and
// nothing that M9 moved onto a crew or a channel goes with them. The rows
// below are written the way the release before left them — a room, its
// channels and its old link, and crew rows that still carry the room — and
// the drop runs over them.
func TestTheContractDropsTheRoomsAndKeepsTheCrews(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, dropRoomsVersion-1)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	owner := insertID(ctx, t, pool, `insert into users (display_name) values ('Owner') returning id`)
	member := insertID(ctx, t, pool, `insert into users (display_name) values ('Member') returning id`)
	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Contract', $1, 'CONTRC') returning id`, owner)
	channel := func(kind string) string {
		return insertID(ctx, t, pool,
			`insert into channels (crew_id, kind, name, position) values ($1, $2, 'Lounge', 0) returning id`, crew, kind)
	}
	text, voice := channel("text"), channel("voice")
	room := insertID(ctx, t, pool,
		`insert into rooms (slug, name, owner_id, crew_id, crew_visible) values ('lounge', 'Lounge', $1, $2, true) returning id`, owner, crew)
	exec(`insert into room_channels (room_id, text_channel_id, voice_channel_id) values ($1, $2, $3)`, room, text, voice)
	exec(`insert into moved_rooms (slug, crew_id, text_channel_id, voice_channel_id) values ('lounge', $1, $2, $3)`, crew, text, voice)
	exec(`insert into memberships (room_id, user_id, role) values ($1, $2, 'member')`, room, member)
	exec(`insert into room_grants (room_id, user_id) values ($1, $2)`, room, member)
	exec(`insert into chat_messages (room_id, channel_id, user_id, text) values ($1, $2, $3, 'still here')`, room, text, member)
	exec(`insert into playlists (room_id, crew_id, name) values ($1, $2, 'Crew Mix')`, room, crew)
	exec(`insert into scheduled_sessions (room_id, crew_id, channel_id, workout_name, workout_json, starts_at, created_by)
		values ($1, $2, $3, 'Thursday', '{}', now() + interval '2 days', $4)`, room, crew, voice, member)
	exec(`insert into session_recaps (room_id, crew_id, channel_id, workout, started_at, ended_at, riders)
		values ($1, $2, $3, 'Openers', now() - interval '2 hours', now() - interval '1 hour', '[]')`, room, crew, voice)

	migrateScratchTo(ctx, t, pool, dropRoomsVersion)

	for _, gone := range []string{"rooms", "memberships", "room_grants", "room_reads", "room_channels", "visible_rooms"} {
		var still *string
		if err := pool.QueryRow(ctx, `select to_regclass($1)::text`, gone).Scan(&still); err != nil {
			t.Fatalf("%s: %v", gone, err)
		}
		if still != nil {
			t.Errorf("%s survived the contract", gone)
		}
	}
	var columns []string
	rows, err := pool.Query(ctx, `select table_name from information_schema.columns
		where table_schema = 'public' and column_name = 'room_id' order by table_name`)
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatalf("column: %v", err)
		}
		columns = append(columns, table)
	}
	rows.Close()
	if len(columns) > 0 {
		t.Errorf("room_id survived on %v", columns)
	}

	for what, sql := range map[string]string{
		"the channel's line":  `select count(*) from chat_messages where channel_id = $1 and text = 'still here'`,
		"the old link":        `select count(*) from moved_rooms where slug = 'lounge' and text_channel_id = $1`,
		"the crew's playlist": `select count(*) from playlists p join channels c on c.crew_id = p.crew_id where c.id = $1 and p.name = 'Crew Mix'`,
		"the crew's plan":     `select count(*) from scheduled_sessions s join channels c on c.crew_id = s.crew_id where c.id = $1`,
		"the session's recap": `select count(*) from session_recaps r join channels c on c.crew_id = r.crew_id where c.id = $1`,
		"the text channel":    `select count(*) from channels where id = $1`,
	} {
		var n int
		if err := pool.QueryRow(ctx, sql, text).Scan(&n); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		if n != 1 {
			t.Errorf("%s did not survive the contract (%d)", what, n)
		}
	}

	// A playlist is a rider's or a crew's now, never neither and never both.
	if _, err := pool.Exec(ctx, `insert into playlists (name) values ('Nobody''s')`); err == nil {
		t.Error("a playlist that belongs to nobody was accepted")
	}
}

// A room's playlist carries its crew since #2430, so the contract has nothing
// to decide — and if one does not, it stops rather than dropping the only thing
// that said whose it was.
func TestTheContractRefusesAPlaylistThatBelongsToNobody(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, dropRoomsVersion-1)

	owner := insertID(ctx, t, pool, `insert into users (display_name) values ('Owner') returning id`)
	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Orphan', $1, 'ORPHAN') returning id`, owner)
	room := insertID(ctx, t, pool,
		`insert into rooms (slug, name, owner_id, crew_id, crew_visible) values ('orphan', 'Orphan', $1, $2, true) returning id`, owner, crew)
	if _, err := pool.Exec(ctx, `insert into playlists (room_id, name) values ($1, 'Room Only')`, room); err != nil {
		t.Fatalf("playlist: %v", err)
	}

	sqldb := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqldb.Close() }()
	err := goose.UpToContext(ctx, sqldb, "migrations", dropRoomsVersion)
	if err == nil || !strings.Contains(err.Error(), "belongs to neither a rider nor a crew") {
		t.Fatalf("the contract ran over a playlist nobody owns: %v", err)
	}
}
