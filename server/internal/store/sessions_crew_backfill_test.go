package store

// Sessions move to the crew (ADR-0058, #2431): plans, recaps, medals and rides
// gain the crew, and the voice channel where there is one. Written one version
// short of the CHANNELS migration, because both run in the same boot at the M9
// release.
//
// The quiet failures: a row left with no crew, which the crew's calendar,
// board and history would simply never list; and a recap that outlives a
// deleted private channel, which would fall open to everyone in the crew.

import (
	"context"
	"testing"
	"time"
)

func TestSessionsMoveToTheCrewAndItsVoiceChannel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	rider := insertID(ctx, t, pool, `insert into users (display_name) values ('Rider') returning id`)
	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Thursday Crew', $1, 'THURSD') returning id`, rider)
	room := insertID(ctx, t, pool, `
		insert into rooms (slug, name, owner_id, crew_id, crew_visible) values ('pain-cave', 'Pain Cave', $1, $2, false)
		returning id`, rider, crew)
	start := time.Date(2026, 9, 17, 18, 0, 0, 0, time.UTC)

	plan := insertID(ctx, t, pool, `
		insert into scheduled_sessions (room_id, workout_name, workout_json, starts_at, created_by)
		values ($1, 'Sweet Spot 2x20', '{}', $2, $3) returning id`, room, start.Add(7*24*time.Hour), rider)
	recap := insertID(ctx, t, pool, `
		insert into session_recaps (room_id, workout, started_at, ended_at) values ($1, 'Sweet Spot 2x20', $2, $3)
		returning id`, room, start, start.Add(time.Hour))
	ride := func(roomID any, at time.Time) string {
		return insertID(ctx, t, pool, `
			insert into rides (user_id, room_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
			values ($1, $2, 'Sweet Spot 2x20', $3, 3600, 200, 720, 0.9, 250, '\x00') returning id`, rider, roomID, at)
	}
	roomRide, soloRide := ride(room, start), ride(nil, start.Add(24*time.Hour))
	medal := insertID(ctx, t, pool, `
		insert into medals (room_id, user_id, ride_id, kind) values ($1, $2, $3, 'diesel') returning id`, room, rider, roomRide)

	if err := migrateScratchUp(ctx, pool); err != nil {
		t.Fatalf("migrate over the room: %v", err)
	}

	var voiceChannel string
	if err := pool.QueryRow(ctx, `select voice_channel_id from room_channels where room_id = $1`, room).Scan(&voiceChannel); err != nil {
		t.Fatalf("room_channels: %v", err)
	}

	t.Run("no plan, recap or medal is left without its crew", func(t *testing.T) {
		for _, table := range []string{"scheduled_sessions", "session_recaps", "medals"} {
			var orphans int
			if err := pool.QueryRow(ctx, `select count(*) from `+table+` where crew_id is null`).Scan(&orphans); err != nil {
				t.Fatalf("%s: %v", table, err)
			}
			if orphans != 0 {
				t.Errorf("%d row(s) of %s have no crew; the crew's pages would never list them", orphans, table)
			}
		}
	})

	t.Run("each row names the room's crew, and its voice channel where it has one", func(t *testing.T) {
		for _, c := range []struct {
			what, table, id string
			channel         bool
		}{
			{"the plan", "scheduled_sessions", plan, true},
			{"the recap", "session_recaps", recap, true},
			{"the medal", "medals", medal, false},
			{"the ride in the room", "rides", roomRide, true},
		} {
			cols := "crew_id, null::uuid"
			if c.channel {
				cols = "crew_id, channel_id"
			}
			var gotCrew, gotChannel *string
			if err := pool.QueryRow(ctx, `select `+cols+` from `+c.table+` where id = $1`, c.id).Scan(&gotCrew, &gotChannel); err != nil {
				t.Fatalf("%s: %v", c.what, err)
			}
			if orNone(gotCrew) != crew {
				t.Errorf("%s is in crew %q, want the room's %s", c.what, orNone(gotCrew), crew)
			}
			if c.channel && orNone(gotChannel) != voiceChannel {
				t.Errorf("%s is in channel %q, want the room's voice channel %s", c.what, orNone(gotChannel), voiceChannel)
			}
		}
	})

	t.Run("a solo ride stays with no crew, and no old row gets an invented session", func(t *testing.T) {
		var soloCrew, rideSession, recapSession *string
		if err := pool.QueryRow(ctx, `
			select (select crew_id from rides where id = $1),
			       (select session_id from rides where id = $2),
			       (select session_id from session_recaps where id = $3)`, soloRide, roomRide, recap).
			Scan(&soloCrew, &rideSession, &recapSession); err != nil {
			t.Fatalf("read: %v", err)
		}
		if soloCrew != nil {
			t.Errorf("a solo ride was put in crew %s", *soloCrew)
		}
		if rideSession != nil || recapSession != nil {
			t.Errorf("a session id was invented for history that never had one (ride %q, recap %q)",
				orNone(rideSession), orNone(recapSession))
		}
	})

	t.Run("what comes after needs no room, and nothing is left with neither", func(t *testing.T) {
		for what, sql := range map[string]string{
			"a plan":  `insert into scheduled_sessions (crew_id, workout_name, workout_json, starts_at, created_by) values ('` + crew + `', 'Ramp', '{}', now(), '` + rider + `')`,
			"a recap": `insert into session_recaps (crew_id, channel_id, session_id, workout, started_at, ended_at) values ('` + crew + `', '` + voiceChannel + `', gen_random_uuid(), 'Ramp', now(), now())`,
			"a medal": `insert into medals (crew_id, user_id, ride_id, kind) values ('` + crew + `', '` + rider + `', '` + roomRide + `', 'hammer')`,
		} {
			if _, err := pool.Exec(ctx, sql); err != nil {
				t.Errorf("%s in a crew with no room behind it was refused: %v", what, err)
			}
		}
		for what, sql := range map[string]string{
			"a plan":  `insert into scheduled_sessions (workout_name, workout_json, starts_at, created_by) values ('Ramp', '{}', now(), '` + rider + `')`,
			"a recap": `insert into session_recaps (workout, started_at, ended_at) values ('Ramp', now(), now())`,
			"a medal": `insert into medals (user_id, ride_id, kind) values ('` + rider + `', '` + roomRide + `', 'hammer')`,
		} {
			if _, err := pool.Exec(ctx, sql); err == nil {
				t.Errorf("%s with neither a room nor a crew was accepted", what)
			}
		}
	})

	t.Run("deleting the channel takes its recaps, rather than opening them to the crew", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `delete from channels where id = $1`, voiceChannel); err != nil {
			t.Fatalf("delete the voice channel: %v", err)
		}
		var left int
		if err := pool.QueryRow(ctx, `select count(*) from session_recaps where id = $1`, recap).Scan(&left); err != nil {
			t.Fatalf("count: %v", err)
		}
		if left != 0 {
			t.Error("a recap outlived its private channel; with no channel to gate it, the whole crew would read it")
		}
		var planChannel *string
		if err := pool.QueryRow(ctx, `select channel_id from scheduled_sessions where id = $1`, plan).Scan(&planChannel); err != nil {
			t.Fatalf("the plan went with the channel, but members had answered it: %v", err)
		}
		if planChannel != nil {
			t.Errorf("the plan still names the deleted channel %s", *planChannel)
		}
	})
}
