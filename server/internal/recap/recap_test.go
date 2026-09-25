package recap

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// The session every fixture below shares: an hour, ended ten minutes ago.
var (
	sessionEnd   = time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	sessionStart = sessionEnd.Add(-time.Hour)
)

type world struct {
	st      *store.Store
	svc     *Service
	crew    db.Crew
	channel db.Channel
	users   map[string]db.User
}

func setup(t *testing.T) *world {
	t.Helper()
	st := storetest.Open(t)
	w := &world{st: st, svc: New(st, slog.New(slog.DiscardHandler)), users: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		w.users[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	crew, err := st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: "Recap Crew", OwnerID: w.users["alice"].ID, Code: testx.CrewCode(),
	})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	w.crew = crew
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	channel, err := st.Queries.CreateChannel(t.Context(), db.CreateChannelParams{
		CrewID: crew.ID, Kind: "voice", Name: "Pain Cave", MaxChannels: 10,
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	w.channel = channel
	return w
}

// recapRow writes the session every test in this file reads back.
func (w *world) recapRow(t *testing.T) {
	t.Helper()
	riders, err := json.Marshal([]protocol.SessionRecapRider{{
		ID: store.UUIDString(w.users["alice"].ID), Rider: "alice",
		From: sessionStart.UnixMilli(), To: sessionEnd.UnixMilli(), Rode: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	// Straight to the row: the crew's list is what these tests read, and the
	// save itself is TestSaveRecapKeysTheSession's.
	if _, err := w.st.Pool.Exec(t.Context(),
		"insert into session_recaps (crew_id, channel_id, workout, started_at, ended_at, riders) values ($1, $2, $3, $4, $5, $6)",
		w.crew.ID, w.channel.ID, "Sweet Spot 2x20", sessionStart, sessionEnd, riders); err != nil {
		t.Fatalf("save recap: %v", err)
	}
}

// A session's recap is the crew's and the channel's, under the session's own
// id (#2438): ListCrewRecaps reads crew_id, and a retry after a lost answer
// lands on the row it already made rather than a second card.
func TestSaveRecapKeysTheSession(t *testing.T) {
	w := setup(t)
	crew, channel := w.crew, w.channel
	session := "8f7c1a2e-9b1d-4c5e-8a6f-0d3b2c1e4f5a"
	rec := protocol.SessionRecap{
		Workout: "Openers", StartedAt: sessionStart.UnixMilli(), EndedAt: sessionEnd.UnixMilli(),
		Riders: []protocol.SessionRecapRider{{ID: store.UUIDString(w.users["alice"].ID), Rider: "alice"}},
	}
	for range 2 {
		w.svc.SaveRecap(store.UUIDString(channel.ID), session, rec)
	}
	var rows int
	var crewID, channelID pgtype.UUID
	if err := w.st.Pool.QueryRow(t.Context(),
		"select count(*) over (), crew_id, channel_id from session_recaps where session_id = $1",
		session).Scan(&rows, &crewID, &channelID); err != nil {
		t.Fatalf("read the recap: %v", err)
	}
	if rows != 1 {
		t.Errorf("two saves of one session left %d rows, want 1", rows)
	}
	if crewID != crew.ID || channelID != channel.ID {
		t.Errorf("the recap is crew %v channel %v, want %v and %v", crewID, channelID, crew.ID, channel.ID)
	}
	// And the list says both (#2600): an ended session's address finds its
	// voice channel through them.
	if got := w.list(t, "alice"); got.SessionID != session || got.ChannelID != store.UUIDString(channel.ID) {
		t.Errorf("the listed recap names session %q in channel %q, want %q in %q",
			got.SessionID, got.ChannelID, session, store.UUIDString(channel.ID))
	}
}

// ride saves one ride in the crew's voice channel for a rider, started at `at`.
func (w *world) ride(t *testing.T, who string, at time.Time) string {
	t.Helper()
	id, err := w.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: w.users[who].ID, CrewID: w.crew.ID, ChannelID: w.channel.ID, WorkoutName: "Sweet Spot 2x20",
		StartedAt: pgtype.Timestamptz{Time: at, Valid: true},
		Seconds:   3600, AvgWatts: 180, Kj: 640, Execution: 0.9, ExecutionScored: true,
		FtpWatts: 200, Samples: []byte{}, Curve: []byte(`{}`), Xp: 640,
	})
	if err != nil {
		t.Fatalf("create ride for %s: %v", who, err)
	}
	return store.UUIDString(id)
}

func (w *world) list(t *testing.T, viewer string) protocol.SessionRecap {
	t.Helper()
	rows, err := w.st.Queries.ListCrewRecaps(t.Context(), db.ListCrewRecapsParams{
		CrewID: w.crew.ID, Viewer: w.users[viewer].ID, Days: RetentionDays, MaxRows: 50,
	})
	if err != nil {
		t.Fatalf("list as %s: %v", viewer, err)
	}
	if len(rows) != 1 {
		t.Fatalf("list as %s returned %d recaps, want 1", viewer, len(rows))
	}
	rec, ok := Decode(slog.New(slog.DiscardHandler), rows[0])
	if !ok {
		t.Fatalf("list as %s: the recap would not decode", viewer)
	}
	return rec
}

// The card's one per-viewer field (#1560). Everything else on a recap reads
// the same for every member; this is the door to the viewer's OWN numbers, so
// the thing that must never happen is it opening somebody else's ride.
func TestRecapCarriesTheViewersOwnRide(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	// Both rode it. Bob's ride starts later — he joined ten minutes in.
	aliceRide := w.ride(t, "alice", sessionStart)
	bobRide := w.ride(t, "bob", sessionStart.Add(10*time.Minute))

	if got := w.list(t, "alice").RideID; got != aliceRide {
		t.Errorf("alice's card opens %q, want her own ride %q", got, aliceRide)
	}
	if got := w.list(t, "bob").RideID; got != bobRide {
		t.Errorf("bob's card opens %q, want his own ride %q — a late joiner's ride starts after the session did", got, bobRide)
	}
}

// The coach with no trainer, and the member reading the list who was never
// there: no ride, no link, and emphatically not the ride of whoever did ride.
func TestRecapWithoutARideCarriesNoLink(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	w.ride(t, "alice", sessionStart)

	if got := w.list(t, "bob").RideID; got != "" {
		t.Errorf("bob did not ride, yet his card opens %q", got)
	}
}

// The window is the session's own, not "a ride in this channel": last week's
// ride must not turn up on this week's card.
func TestRecapIgnoresRidesOutsideTheSession(t *testing.T) {
	w := setup(t)
	w.recapRow(t)
	for _, when := range []struct {
		name string
		at   time.Time
	}{
		{"a week earlier", sessionStart.Add(-7 * 24 * time.Hour)},
		{"an hour after it ended", sessionEnd.Add(time.Hour)},
		{"two minutes before it started", sessionStart.Add(-2 * time.Minute)},
	} {
		t.Run(when.name, func(t *testing.T) {
			ride := w.ride(t, "alice", when.at)
			if got := w.list(t, "alice").RideID; got == ride {
				t.Errorf("a ride from %s is on the card", when.name)
			}
			_, _ = w.st.Pool.Exec(t.Context(), "delete from rides where id = $1", ride)
		})
	}
}
