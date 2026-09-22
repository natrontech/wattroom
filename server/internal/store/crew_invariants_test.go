package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// The boundary every person-visibility query goes through: `visible_channels`
// (ADR-0058, #2465), successor of the `visible_rooms` invariants #1106 set.
// Table-driven over the query list on purpose: a spot check on one of them is
// what let #1109 and #1114 sit in the other three.
//
// Every case is a SILENT failure if it breaks — a row too many is a privacy
// leak, a row too few a lockout, and neither errors.
//
// Not in this table: `CountRiderMedalsInCommon` needs a ride to hang a medal
// on, and gamify's trophy-case tests hold it to the same boundary.

// chanFixture: alice owns crew Velvet with an open channel and a private one;
// bob is a member of it, carol owns a crew of her own.
type chanFixture struct {
	st                *store.Store
	alice, bob, carol pgtype.UUID
	crew              pgtype.UUID
	open, private     pgtype.UUID
}

func (f *chanFixture) user(t *testing.T, name string) pgtype.UUID {
	t.Helper()
	u, err := f.st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
	if err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	t.Cleanup(func() { _, _ = f.st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	return u.ID
}

func (f *chanFixture) newCrew(t *testing.T, name string, owner pgtype.UUID) pgtype.UUID {
	t.Helper()
	c, err := f.st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: name, OwnerID: owner, Code: testx.CrewCode()})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	t.Cleanup(func() { _, _ = f.st.Pool.Exec(context.Background(), "delete from crews where id = $1", c.ID) })
	return c.ID
}

func (f *chanFixture) channel(t *testing.T, crew pgtype.UUID, name string, private bool) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := f.st.Pool.QueryRow(t.Context(),
		"insert into channels (crew_id, kind, name, position, private) values ($1, 'voice', $2, 0, $3) returning id",
		crew, name, private).Scan(&id); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	return id
}

func (f *chanFixture) role(t *testing.T, user pgtype.UUID, role string) {
	t.Helper()
	if err := f.st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{CrewID: f.crew, UserID: user, Role: role}); err != nil {
		t.Fatalf("crew role: %v", err)
	}
}

func (f *chanFixture) name(t *testing.T, channel, user pgtype.UUID) {
	t.Helper()
	if _, err := f.st.Pool.Exec(t.Context(),
		"insert into channel_members (channel_id, user_id) values ($1, $2)", channel, user); err != nil {
		t.Fatalf("name into channel: %v", err)
	}
}

func setupChannels(t *testing.T) *chanFixture {
	t.Helper()
	f := &chanFixture{st: open(t)}
	f.alice, f.bob, f.carol = f.user(t, "alice"), f.user(t, "bob"), f.user(t, "carol")
	f.crew = f.newCrew(t, "Velvet", f.alice)
	f.open = f.channel(t, f.crew, "open", false)
	f.private = f.channel(t, f.crew, "priv", true)
	f.channel(t, f.newCrew(t, "Other", f.carol), "else", false)
	f.role(t, f.bob, "member")
	return f
}

// A track the rider uploaded, so TrackPlayableBy has something to refuse.
func (f *chanFixture) track(t *testing.T, owner pgtype.UUID) pgtype.UUID {
	t.Helper()
	tr, err := f.st.Queries.CreateTrack(t.Context(), db.CreateTrackParams{
		Sha256: testx.Slug("sha"), UploadedBy: owner, Title: "t", DurationMs: 1000, SizeBytes: 1, Tags: []string{},
	})
	if err != nil {
		t.Fatalf("create track: %v", err)
	}
	return tr.ID
}

var visibilityQueries = []struct {
	name string
	run  func(t *testing.T, f *chanFixture, viewer, rider pgtype.UUID) bool
}{
	{"SharesChannelOrFriends", func(t *testing.T, f *chanFixture, viewer, rider pgtype.UUID) bool {
		ok, err := f.st.Queries.SharesChannelOrFriends(t.Context(), db.SharesChannelOrFriendsParams{Viewer: viewer, Rider: rider})
		if err != nil {
			t.Fatalf("SharesChannelOrFriends: %v", err)
		}
		return ok
	}},
	{"SharesChannel", func(t *testing.T, f *chanFixture, viewer, rider pgtype.UUID) bool {
		ok, err := f.st.Queries.SharesChannel(t.Context(), db.SharesChannelParams{Viewer: viewer, Rider: rider})
		if err != nil {
			t.Fatalf("SharesChannel: %v", err)
		}
		return ok
	}},
	{"TrackPlayableBy", func(t *testing.T, f *chanFixture, viewer, rider pgtype.UUID) bool {
		_, err := f.st.Queries.TrackPlayableBy(t.Context(), db.TrackPlayableByParams{ID: f.track(t, rider), UserID: viewer})
		return err == nil
	}},
}

func (f *chanFixture) sees(t *testing.T, viewer, rider pgtype.UUID) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, q := range visibilityQueries {
		out[q.name] = q.run(t, f, viewer, rider)
	}
	return out
}

func expectAll(t *testing.T, got map[string]bool, want bool, why string) {
	t.Helper()
	for name, ok := range got {
		if ok != want {
			t.Errorf("%s: %s (got %v)", name, why, ok)
		}
	}
}

// The gate itself, case by case: `mayEnter` in channels/access.go.
func TestVisibleChannels(t *testing.T) {
	f := setupChannels(t)
	admin, named, banned := f.user(t, "admin"), f.user(t, "named"), f.user(t, "banned")
	f.role(t, admin, "admin")
	f.role(t, named, "member")
	f.name(t, f.private, named)
	f.role(t, banned, "banned")
	f.name(t, f.private, banned) // a stale naming must not outrank the ban

	for _, tc := range []struct {
		name          string
		user, channel pgtype.UUID
		want          bool
	}{
		{"the owner enters the private channel", f.alice, f.private, true},
		{"an admin enters the private channel", admin, f.private, true},
		{"a member enters the open channel", f.bob, f.open, true},
		{"a member not named does NOT enter the private channel", f.bob, f.private, false},
		{"a named member enters the private channel", named, f.private, true},
		{"a banned rider enters no open channel", banned, f.open, false},
		{"a banned rider enters no channel they were named into", banned, f.private, false},
		{"nobody crosses the crew boundary", f.carol, f.open, false},
	} {
		var got bool
		if err := f.st.Pool.QueryRow(t.Context(),
			"select exists (select 1 from visible_channels where channel_id = $1 and user_id = $2)",
			tc.channel, tc.user).Scan(&got); err != nil {
			t.Fatalf("visible_channels: %v", err)
		}
		if got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNoVisibilityAcrossTheCrewBoundary(t *testing.T) {
	f := setupChannels(t)
	expectAll(t, f.sees(t, f.carol, f.bob), false, "carol sees bob across the crew boundary")
	expectAll(t, f.sees(t, f.bob, f.carol), false, "bob sees carol across the crew boundary")
}

func TestSharingAChannelGrantsVisibility(t *testing.T) {
	f := setupChannels(t)
	expectAll(t, f.sees(t, f.bob, f.alice), true, "bob and alice share the open channel and cannot see each other")
}

func TestACrewBanEndsVisibility(t *testing.T) {
	f := setupChannels(t)
	f.role(t, f.bob, "banned")
	expectAll(t, f.sees(t, f.bob, f.alice), false, "a crew-banned rider still sees the crew")
	expectAll(t, f.sees(t, f.alice, f.bob), false, "the crew still sees a crew-banned rider")
}

// The case `visible_rooms` could not answer after M9 (#2465): nobody writes
// room memberships any more, so a rider who joins the crew now has no room.
// dave joins by the crew's door alone and must still see bob, and hear him.
func TestJoiningTheCrewAfterTheMigrationGrantsVisibility(t *testing.T) {
	f := setupChannels(t)
	dave := f.user(t, "dave")
	f.role(t, dave, "member")
	expectAll(t, f.sees(t, dave, f.bob), true, "a rider who joined the crew does not see a crew-mate in its open channel")
}

// The limit: a crew whose channels are all private exposes nobody who is
// named into none of them — ADR-0038's "joining a crew does not by itself
// expose everyone", carried by ADR-0058. Un-naming is the room ban's successor.
func TestACrewAloneGrantsNothingWithoutASharedChannel(t *testing.T) {
	f := setupChannels(t)
	dave := f.user(t, "dave")
	f.role(t, dave, "member")
	f.name(t, f.private, dave)
	if _, err := f.st.Pool.Exec(t.Context(), "update channels set private = true where id = $1", f.open); err != nil {
		t.Fatalf("close the channel: %v", err)
	}
	f.name(t, f.open, f.bob)
	expectAll(t, f.sees(t, f.bob, dave), false, "crew membership alone exposed two riders who share no channel")

	f.name(t, f.private, f.bob)
	expectAll(t, f.sees(t, f.bob, dave), true, "named into the same private channel and still invisible")
	if _, err := f.st.Pool.Exec(t.Context(),
		"delete from channel_members where channel_id = $1 and user_id = $2", f.private, f.bob); err != nil {
		t.Fatalf("un-name: %v", err)
	}
	expectAll(t, f.sees(t, f.bob, dave), false, "un-named from the only shared channel and still visible")
}
