package store

// The jukebox splits along the room's halves (ADR-0058, #2430): its saved
// playlists go to the crew, its deck's autoplay and play log to the voice
// channel. Written one version short of the CHANNELS migration, because both
// run in the same boot at the M9 release.
//
// The quiet failures are a deck setting landing on the room's TEXT channel,
// which has no deck and would keep it forever unread, and a room playlist left
// without its crew, which the crew's shelf would simply never list.

import (
	"context"
	"testing"
	"time"
)

func TestTheJukeboxSplitsBetweenTheCrewAndTheVoiceChannel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	owner := insertID(ctx, t, pool, `insert into users (display_name) values ('Owner') returning id`)
	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Thursday Crew', $1, 'THURSD') returning id`, owner)
	room := insertID(ctx, t, pool, `
		insert into rooms (slug, name, owner_id, crew_id, crew_visible) values ('lounge', 'Lounge', $1, $2, true)
		returning id`, owner, crew)
	roomList := insertID(ctx, t, pool, `insert into playlists (room_id, name) values ($1, 'Warm-up') returning id`, room)
	riderList := insertID(ctx, t, pool, `insert into playlists (user_id, name) values ($1, 'Mine') returning id`, owner)
	if _, err := pool.Exec(ctx, `
		update rooms set autoplay_enabled = true, autoplay_order = 'shuffled', autoplay_playlist_id = $2
		where id = $1`, room, roomList); err != nil {
		t.Fatalf("autoplay: %v", err)
	}
	play := insertID(ctx, t, pool, `
		insert into track_plays (room_id, video_id, title, skipped) values ($1, 'dQw4w9WgXcQ', 'A track', false)
		returning id`, room)

	if err := migrateScratchUp(ctx, pool); err != nil {
		t.Fatalf("migrate over the room: %v", err)
	}

	var textChannel, voiceChannel string
	if err := pool.QueryRow(ctx,
		`select text_channel_id, voice_channel_id from room_channels where room_id = $1`, room).
		Scan(&textChannel, &voiceChannel); err != nil {
		t.Fatalf("room_channels: %v", err)
	}

	t.Run("a room playlist joins the crew's shelf and a rider's stays theirs", func(t *testing.T) {
		var roomListCrew, riderListCrew *string
		if err := pool.QueryRow(ctx, `
			select (select crew_id from playlists where id = $1), (select crew_id from playlists where id = $2)`,
			roomList, riderList).Scan(&roomListCrew, &riderListCrew); err != nil {
			t.Fatalf("playlists: %v", err)
		}
		if roomListCrew == nil || *roomListCrew != crew {
			t.Errorf("the room playlist's crew is %q, want the room's crew %s", orNone(roomListCrew), crew)
		}
		if riderListCrew != nil {
			t.Errorf("a rider's own playlist was handed to crew %s", *riderListCrew)
		}
	})

	t.Run("the deck's autoplay moves to the voice channel", func(t *testing.T) {
		type autoplay struct {
			enabled  bool
			order    string
			playlist *string
		}
		read := func(channel string) autoplay {
			var a autoplay
			if err := pool.QueryRow(ctx,
				`select autoplay_enabled, autoplay_order, autoplay_playlist_id from channels where id = $1`, channel).
				Scan(&a.enabled, &a.order, &a.playlist); err != nil {
				t.Fatalf("channel autoplay: %v", err)
			}
			return a
		}
		voice := read(voiceChannel)
		if !voice.enabled || voice.order != "shuffled" || voice.playlist == nil || *voice.playlist != roomList {
			t.Errorf("voice channel autoplay = on:%v %s playlist %q, want the room's: on, shuffled, playlist %s",
				voice.enabled, voice.order, orNone(voice.playlist), roomList)
		}
		if text := read(textChannel); text.enabled || text.playlist != nil {
			t.Errorf("the text channel took a deck setting (on:%v, playlist %q); it has no deck", text.enabled, orNone(text.playlist))
		}
	})

	t.Run("the play log follows the deck to the voice channel", func(t *testing.T) {
		var got *string
		if err := pool.QueryRow(ctx, `select channel_id from track_plays where id = $1`, play).Scan(&got); err != nil {
			t.Fatalf("track_plays: %v", err)
		}
		if got == nil || *got != voiceChannel {
			t.Errorf("the play is on channel %q, want the room's voice channel %s", orNone(got), voiceChannel)
		}
	})

	t.Run("what comes after has no room, and nothing is left without an owner", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`insert into playlists (crew_id, name) values ($1, 'Crew list')`, crew); err != nil {
			t.Errorf("a crew playlist with no room behind it was refused: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`insert into track_plays (channel_id, video_id, title, skipped) values ($1, 'dQw4w9WgXcQ', 'A track', true)`,
			voiceChannel); err != nil {
			t.Errorf("a play on a channel with no room behind it was refused: %v", err)
		}
		for what, sql := range map[string]string{
			"a playlist that is a rider's and a crew's": `insert into playlists (user_id, crew_id, name) values ('` + owner + `', '` + crew + `', 'Both')`,
			"a playlist that is nobody's":               `insert into playlists (name) values ('Nobody')`,
			"a play that is on no deck at all":          `insert into track_plays (video_id, title, skipped) values ('dQw4w9WgXcQ', 'A track', true)`,
		} {
			if _, err := pool.Exec(ctx, sql); err == nil {
				t.Errorf("%s was accepted", what)
			}
		}
	})
}

// orNone reads a nullable column for a failure message.
func orNone(p *string) string {
	if p == nil {
		return "none"
	}
	return *p
}
