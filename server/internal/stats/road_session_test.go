package stats

import (
	"context"
	"log/slog"
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

// A session's ride says how it was ridden (#3053): a workout, or a game —
// which saves as the empty, unscored workout a free ride does — never
// timeable, and with the weight the rider set, never a default one.
func TestASessionRideSaysHowItWasRidden(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	var riders []hub.RiderRecord
	for _, name := range []string{"weighed", "unweighed"} {
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		samples := make([]protocol.RiderMetrics, 120)
		for i := range samples {
			samples[i] = protocol.RiderMetrics{Watts: 150, Cadence: 90, Seq: i + 1, Clock: i}
		}
		riders = append(riders, hub.RiderRecord{Rider: protocol.Rider{ID: store.UUIDString(u.ID), Name: name, FtpWatts: 200, WeightKg: 75}, Samples: samples})
	}
	weighed, _ := store.ParseUUID(riders[0].Rider.ID)
	if _, err := st.Pool.Exec(ctx, `update users set weight_kg = 71, weight_source = 'manual' where id = $1`, weighed); err != nil {
		t.Fatal(err)
	}
	crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: "Modes", OwnerID: weighed, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	channel, err := st.Queries.CreateChannel(ctx, db.CreateChannelParams{CrewID: crew.ID, Kind: "voice", Name: "Modes", MaxChannels: 10})
	if err != nil {
		t.Fatal(err)
	}

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	for i, c := range []struct {
		workoutJSON, mode string
	}{
		{`{"name":"Openers","steps":[{"type":"steady","seconds":120,"target":0.6}]}`, "workout"},
		{`{"name":"Floor is Lava","unscored":true,"steps":[]}`, "game"},
	} {
		started := time.Now().Add(-time.Duration(3-i) * time.Hour).Truncate(time.Second)
		if err := saver.save(ctx, store.UUIDString(channel.ID), uuid.NewString(), c.mode, c.workoutJSON, started, riders); err != nil {
			t.Fatal(err)
		}
		for _, r := range riders {
			id, _ := store.ParseUUID(r.Rider.ID)
			var mode *string
			var timeable *bool
			var weight *int16
			if err := st.Pool.QueryRow(ctx, `select ride_mode, timeable, weight_kg from rides where user_id = $1 and started_at = $2`,
				id, started).Scan(&mode, &timeable, &weight); err != nil {
				t.Fatalf("%s's %s ride: %v", r.Rider.Name, c.mode, err)
			}
			if mode == nil || *mode != c.mode || timeable == nil || *timeable {
				t.Errorf("%s's %s ride saved mode %v, timeable %v", r.Rider.Name, c.mode, mode, timeable)
			}
			wantWeight := r.Rider.Name == "weighed"
			if (weight != nil) != wantWeight || (wantWeight && *weight != 71) {
				t.Errorf("%s's %s ride kept weight %v", r.Rider.Name, c.mode, weight)
			}
		}
	}
}
