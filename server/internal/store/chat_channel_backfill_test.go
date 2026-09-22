package store

// A room's chat follows it into the text channel it became (ADR-0058, #2429).
// The old world is written one version short of the CHANNELS migration, not
// of this one: both run in the same boot at the M9 release, and a room that
// existed before #2428 is the only kind whose chat this backfill ever moves.
//
// The quiet failure is chat landing in the wrong place — the room's VOICE
// channel, which has no text surface, would keep every row and show none.

import (
	"context"
	"testing"
	"time"
)

func TestARoomsChatFollowsItIntoItsTextChannel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	author := insertID(ctx, t, pool, `insert into users (display_name) values ('Author') returning id`)
	reader := insertID(ctx, t, pool, `insert into users (display_name) values ('Reader') returning id`)
	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Thursday Crew', $1, 'THURSD') returning id`, author)
	room := insertID(ctx, t, pool, `
		insert into rooms (slug, name, owner_id, crew_id, crew_visible) values ('lounge', 'Lounge', $1, $2, true)
		returning id`, author, crew)
	image := insertID(ctx, t, pool, `
		insert into chat_images (room_id, user_id, mime, bytes) values ($1, $2, 'image/png', '\x00') returning id`,
		room, author)
	line := insertID(ctx, t, pool, `
		insert into chat_messages (room_id, user_id, text, image_id) values ($1, $2, 'no session Thursday', $3)
		returning id`, room, author, image)
	readAt := time.Date(2026, 9, 20, 19, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx,
		`insert into room_reads (room_id, user_id, read_at) values ($1, $2, $3)`, room, reader, readAt); err != nil {
		t.Fatalf("room_reads: %v", err)
	}
	if _, err := pool.Exec(ctx, `update rooms set announcement_id = $2 where id = $1`, room, line); err != nil {
		t.Fatalf("announcement: %v", err)
	}

	if err := migrateScratchUp(ctx, pool); err != nil {
		t.Fatalf("migrate over the room: %v", err)
	}

	var textChannel, voiceChannel string
	if err := pool.QueryRow(ctx,
		`select text_channel_id, voice_channel_id from room_channels where room_id = $1`, room).
		Scan(&textChannel, &voiceChannel); err != nil {
		t.Fatalf("room_channels: %v", err)
	}

	t.Run("messages and images land in the text channel", func(t *testing.T) {
		for table, id := range map[string]string{"chat_messages": line, "chat_images": image} {
			var got *string
			if err := pool.QueryRow(ctx, `select channel_id from `+table+` where id = $1`, id).Scan(&got); err != nil {
				t.Fatalf("%s: %v", table, err)
			}
			switch {
			case got == nil:
				t.Errorf("a row of %s has no channel after the migration", table)
			case *got == voiceChannel:
				t.Errorf("a row of %s landed in the room's voice channel, which has no text to show it in", table)
			case *got != textChannel:
				t.Errorf("a row of %s landed in channel %s, want the room's text channel %s", table, *got, textChannel)
			}
		}
	})

	t.Run("a read mark carries over, so nothing reads as unread again", func(t *testing.T) {
		var got time.Time
		if err := pool.QueryRow(ctx,
			`select read_at from channel_reads where channel_id = $1 and user_id = $2`, textChannel, reader).Scan(&got); err != nil {
			t.Fatalf("the reader's mark on the text channel: %v", err)
		}
		if !got.Equal(readAt) {
			t.Errorf("read_at %s, want the room's %s", got, readAt)
		}
	})

	t.Run("the announcement stays up, on the text channel", func(t *testing.T) {
		var text, voice *string
		if err := pool.QueryRow(ctx, `
			select (select announcement_id from channels where id = $1),
			       (select announcement_id from channels where id = $2)`, textChannel, voiceChannel).
			Scan(&text, &voice); err != nil {
			t.Fatalf("announcement: %v", err)
		}
		if text == nil || *text != line {
			t.Errorf("the text channel's announcement is %v, want the room's marked line %s", text, line)
		}
		if voice != nil {
			t.Errorf("the voice channel carries an announcement (%s); it has no text", *voice)
		}
	})

	t.Run("a channel made afterwards can be written without a room, and no row is left with neither", func(t *testing.T) {
		fresh := insertID(ctx, t, pool, `
			insert into channels (crew_id, kind, name, position) values ($1, 'text', 'Pain Cave', 1) returning id`, crew)
		if _, err := pool.Exec(ctx,
			`insert into chat_messages (channel_id, user_id, text) values ($1, $2, 'first')`, fresh, author); err != nil {
			t.Fatalf("a message in a channel with no room behind it was refused: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`insert into chat_messages (user_id, text) values ($1, 'nowhere')`, author); err == nil {
			t.Error("a message with neither a room nor a channel was accepted")
		}
	})
}
