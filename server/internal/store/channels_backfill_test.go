package store

// Every room becomes a text channel and a voice channel (ADR-0058, #2428), and
// like the crew cutover this is a migration a fresh database says nothing
// about: the backfill only ever runs over rows that were already there. So
// this migrates a scratch database to one version short, writes rooms the way
// the release before wrote them, and migrates over them.
//
// The failure worth guarding is the quiet one. A channel that comes out open
// when its room was private, or a banned rider carried in as a named member,
// raises no error anywhere — it is ADR-0058's migration rule broken, and the
// first person to notice would be the one who walked in.

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The channels migration. UpTo stops one short of it.
const channelsMigrationVersion int64 = 20260922185319

func insertID(ctx context.Context, t *testing.T, pool *pgxpool.Pool, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", strings.Fields(sql)[2], err)
	}
	return id
}

type backfilledChannel struct {
	id, crewID, kind, name, soundPack string
	position                          int
	private                           bool
}

func channelOf(ctx context.Context, t *testing.T, pool *pgxpool.Pool, roomID, column string) backfilledChannel {
	t.Helper()
	var c backfilledChannel
	if err := pool.QueryRow(ctx, `
		select c.id, c.crew_id, c.kind, c.name, c.sound_pack, c.position, c.private
		from room_channels rc join channels c on c.id = rc.`+column+`
		where rc.room_id = $1`, roomID).
		Scan(&c.id, &c.crewID, &c.kind, &c.name, &c.soundPack, &c.position, &c.private); err != nil {
		t.Fatalf("the %s of room %s: %v", column, roomID, err)
	}
	return c
}

func namedMembers(ctx context.Context, t *testing.T, pool *pgxpool.Pool, channelID string) map[string]bool {
	t.Helper()
	rows, err := pool.Query(ctx, `select user_id from channel_members where channel_id = $1`, channelID)
	if err != nil {
		t.Fatalf("channel_members: %v", err)
	}
	defer rows.Close()
	got := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[id] = true
	}
	return got
}

func TestEveryRoomBecomesATextAndAVoiceChannel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	user := func(name string) string {
		return insertID(ctx, t, pool, `insert into users (display_name) values ($1) returning id`, name)
	}
	owner, member, guest, banned, bannedGuest, outsider := user("Owner"), user("Member"),
		user("Guest"), user("Banned"), user("Banned guest"), user("Outsider")

	crew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Thursday Crew', $1, 'THURSD') returning id`, owner)
	otherCrew := insertID(ctx, t, pool, `insert into crews (name, owner_id, code) values ('Other Crew', $1, 'QTHERS') returning id`, outsider)

	room := func(slug, name, crewID, ownerID string, crewVisible bool, soundPack string, made time.Time) string {
		return insertID(ctx, t, pool, `
			insert into rooms (slug, name, owner_id, crew_id, crew_visible, sound_pack, created_at)
			values ($1, $2, $3, $4, $5, $6, $7) returning id`,
			slug, name, ownerID, crewID, crewVisible, soundPack, made)
	}
	base := time.Date(2026, 9, 1, 18, 0, 0, 0, time.UTC)
	// Made second but listed first below: position follows when a room was
	// made, never the order rows happen to come back in.
	painCave := room("pain-cave", "Pain Cave", crew, owner, false, "silent", base.Add(time.Hour))
	lounge := room("lounge", "Lounge", crew, owner, true, "base", base)
	elsewhere := room("elsewhere", "Elsewhere", otherCrew, outsider, true, "base", base.Add(2*time.Hour))

	for _, m := range []struct{ room, user, role string }{
		{painCave, owner, "owner"}, {painCave, member, "member"}, {painCave, banned, "banned"},
		{painCave, bannedGuest, "banned"},
		{lounge, owner, "owner"}, {lounge, member, "member"},
		{elsewhere, outsider, "owner"},
	} {
		if _, err := pool.Exec(ctx,
			`insert into memberships (room_id, user_id, role) values ($1, $2, $3)`, m.room, m.user, m.role); err != nil {
			t.Fatalf("membership: %v", err)
		}
	}
	// A crew-mate let into the private room by name, and one the room banned
	// who holds a grant too: the ban beat the grant in `visible_rooms`.
	for _, g := range []string{guest, bannedGuest} {
		if _, err := pool.Exec(ctx,
			`insert into room_grants (room_id, user_id) values ($1, $2)`, painCave, g); err != nil {
			t.Fatalf("grant: %v", err)
		}
	}

	if err := migrateScratchUp(ctx, pool); err != nil {
		t.Fatalf("migrate over the rooms: %v", err)
	}

	t.Run("two channels per room, no more", func(t *testing.T) {
		var channels, rooms int
		if err := pool.QueryRow(ctx,
			`select (select count(*) from channels), (select count(*) from rooms)`).Scan(&channels, &rooms); err != nil {
			t.Fatalf("count: %v", err)
		}
		if channels != 2*rooms {
			t.Fatalf("%d channels for %d rooms, want %d", channels, rooms, 2*rooms)
		}
	})

	t.Run("each room is a text and a voice channel of its name, in its crew", func(t *testing.T) {
		for _, r := range []struct{ id, name, crew string }{
			{painCave, "Pain Cave", crew}, {lounge, "Lounge", crew}, {elsewhere, "Elsewhere", otherCrew},
		} {
			text, voice := channelOf(ctx, t, pool, r.id, "text_channel_id"), channelOf(ctx, t, pool, r.id, "voice_channel_id")
			if text.kind != "text" || voice.kind != "voice" {
				t.Errorf("%s became a %s and a %s channel, want text and voice", r.name, text.kind, voice.kind)
			}
			for _, c := range []backfilledChannel{text, voice} {
				if c.name != r.name || c.crewID != r.crew {
					t.Errorf("%s's %s channel is %q in crew %s, want %q in %s", r.name, c.kind, c.name, c.crewID, r.name, r.crew)
				}
			}
		}
	})

	t.Run("an open room's channels are open and name nobody", func(t *testing.T) {
		for _, col := range []string{"text_channel_id", "voice_channel_id"} {
			c := channelOf(ctx, t, pool, lounge, col)
			if c.private {
				t.Errorf("the open room's %s channel came out private", c.kind)
			}
			if got := namedMembers(ctx, t, pool, c.id); len(got) != 0 {
				t.Errorf("the open room's %s channel names %d members; the crew is its audience", c.kind, len(got))
			}
		}
	})

	t.Run("a private room's channels stay private to exactly its people", func(t *testing.T) {
		for _, col := range []string{"text_channel_id", "voice_channel_id"} {
			c := channelOf(ctx, t, pool, painCave, col)
			if !c.private {
				t.Fatalf("the private room's %s channel came out open — everyone in the crew can now walk in", c.kind)
			}
			got := namedMembers(ctx, t, pool, c.id)
			for who, id := range map[string]string{"owner": owner, "member": member, "guest with a grant": guest} {
				if !got[id] {
					t.Errorf("the %s of the private room is not named into its %s channel", who, c.kind)
				}
			}
			for who, id := range map[string]string{"rider the room banned": banned, "banned rider holding a grant": bannedGuest} {
				if got[id] {
					t.Errorf("the %s is named into the %s channel: the migration let them back in", who, c.kind)
				}
			}
			if len(got) != 3 {
				t.Errorf("the private room's %s channel names %d members, want its 3 people", c.kind, len(got))
			}
		}
	})

	t.Run("channels are ordered within their crew by when the room was made", func(t *testing.T) {
		for _, col := range []string{"text_channel_id", "voice_channel_id"} {
			first, second := channelOf(ctx, t, pool, lounge, col), channelOf(ctx, t, pool, painCave, col)
			if first.position != 0 || second.position != 1 {
				t.Errorf("%s positions: Lounge %d, Pain Cave %d; want 0 and 1", first.kind, first.position, second.position)
			}
			if other := channelOf(ctx, t, pool, elsewhere, col); other.position != 0 {
				t.Errorf("the other crew's first %s channel is at %d, want 0 — positions count per crew", other.kind, other.position)
			}
		}
	})

	t.Run("the room's sound pack goes to its voice channel", func(t *testing.T) {
		if got := channelOf(ctx, t, pool, painCave, "voice_channel_id").soundPack; got != "silent" {
			t.Errorf("voice channel sound pack %q, want the room's %q", got, "silent")
		}
	})
}

func TestTheChannelsMigrationRefusesARoomWithNoCrew(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool := scratchPool(ctx, t)
	migrateScratchTo(ctx, t, pool, channelsMigrationVersion-1)

	owner := insertID(ctx, t, pool, `insert into users (display_name) values ('Owner') returning id`)
	insertID(ctx, t, pool, `insert into rooms (slug, name, owner_id) values ('adrift', 'Adrift', $1) returning id`, owner)

	err := migrateScratchUp(ctx, pool)
	if err == nil {
		t.Fatal("a crewless room migrated; its chat and deck would have had no channel to follow into")
	}
	if !strings.Contains(err.Error(), "have no crew") {
		t.Fatalf("refused, but not by the crewless-room guard: %v", err)
	}
}
