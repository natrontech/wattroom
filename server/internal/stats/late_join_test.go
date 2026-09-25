package stats

import (
	"context"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A rider who joins a session for its second block (ADR-0059) is saved as
// they rode it (#2814): their samples carry the timeline second, so the
// save scores them against the block they rode, sees them reach the last
// block, and dates their ride when they started it. It scored them against
// minute 0 and counted their samples as the distance they had covered, so
// they were never "completed" and stood in no medal.
func TestALateJoinerIsSavedAsTheyRode(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	const workoutJSON = `{"name":"Two","steps":[{"type":"steady","seconds":120,"target":0.5},{"type":"steady","seconds":120,"target":1.0}]}`
	ride := func(from, to, watts int) []protocol.RiderMetrics {
		var samples []protocol.RiderMetrics
		for second := from; second < to; second++ {
			samples = append(samples, protocol.RiderMetrics{Watts: watts, Cadence: 90, Seq: second + 1, Clock: second})
		}
		return samples
	}
	started := time.Now().Add(-time.Hour).Truncate(time.Second)
	var riders []hub.RiderRecord
	for _, r := range []struct {
		name    string
		samples []protocol.RiderMetrics
		start   time.Time
	}{
		{"late-a", ride(0, 240, 150), started},
		{"late-b", ride(0, 240, 150), started},
		// Joined at the second block and rode it on target.
		{"late-c", ride(120, 240, 200), started.Add(120 * time.Second)},
	} {
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: r.name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		riders = append(riders, hub.RiderRecord{
			Rider:   protocol.Rider{ID: store.UUIDString(u.ID), Name: r.name, FtpWatts: 200, WeightKg: 75},
			Samples: r.samples, StartedAt: r.start,
		})
	}
	owner, _ := store.ParseUUID(riders[0].Rider.ID)
	crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: "Late Crew", OwnerID: owner, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	channel, err := st.Queries.CreateChannel(ctx, db.CreateChannelParams{CrewID: crew.ID, Kind: "voice", Name: "Late", MaxChannels: 10})
	if err != nil {
		t.Fatal(err)
	}

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	if err := saver.save(ctx, store.UUIDString(channel.ID), uuid.NewString(), "Two", workoutJSON, started, riders); err != nil {
		t.Fatal(err)
	}
	late, _ := store.ParseUUID(riders[2].Rider.ID)
	var at time.Time
	var execution float32
	if err := st.Pool.QueryRow(ctx, "select started_at, execution from rides where user_id = $1", late).Scan(&at, &execution); err != nil {
		t.Fatal(err)
	}
	if want := started.Add(120 * time.Second); !at.Equal(want) {
		t.Errorf("the late joiner's ride starts at %v, want %v — when they joined, not when the session did", at, want)
	}
	if execution != 1 {
		t.Errorf("the late joiner's execution saved as %v, want 1 — the live meter's number", execution)
	}
	var kinds []string
	rows, err := st.Pool.Query(ctx, "select kind from medals where user_id = $1", late)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, kind)
	}
	rows.Close()
	if !slices.Contains(kinds, "metronome") {
		t.Errorf("the late joiner rode their block on target and holds %v, want metronome — they were not counted as completing it", kinds)
	}
}
