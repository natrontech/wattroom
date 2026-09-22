package stats

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// placeRiders are three riders — the fewest a session awards medals to.
func placeRiders(t *testing.T, st *store.Store) []hub.RiderRecord {
	t.Helper()
	ctx := context.Background()
	samples := make([]protocol.RiderMetrics, 70)
	for i := range samples {
		samples[i] = protocol.RiderMetrics{Watts: 200, Cadence: 90, Seq: i + 1}
	}
	var riders []hub.RiderRecord
	for _, name := range []string{"place-a", "place-b", "place-c"} {
		u, err := st.Queries.CreateUser(ctx, db.CreateUserParams{DisplayName: name, FtpWatts: 250, WeightKg: 75})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		riders = append(riders, hub.RiderRecord{
			Rider:   protocol.Rider{ID: store.UUIDString(u.ID), Name: name, FtpWatts: 250, WeightKg: 75},
			Samples: samples,
		})
	}
	return riders
}

// where reads what each of the riders' rides, and their medals, say about
// where they were ridden.
func where(t *testing.T, st *store.Store, riders []hub.RiderRecord) (rides, medals []struct{ room, crew, channel, session pgtype.UUID }) {
	t.Helper()
	for _, r := range riders {
		uid, _ := store.ParseUUID(r.Rider.ID)
		var got struct{ room, crew, channel, session pgtype.UUID }
		if err := st.Pool.QueryRow(context.Background(),
			"select room_id, crew_id, channel_id, session_id from rides where user_id = $1", uid,
		).Scan(&got.room, &got.crew, &got.channel, &got.session); err != nil {
			t.Fatalf("%s's ride: %v", r.Rider.Name, err)
		}
		rides = append(rides, got)
		rows, err := st.Pool.Query(context.Background(), "select room_id, crew_id from medals where user_id = $1", uid)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var m struct{ room, crew, channel, session pgtype.UUID }
			if err := rows.Scan(&m.room, &m.crew); err != nil {
				t.Fatal(err)
			}
			medals = append(medals, m)
		}
		rows.Close()
	}
	return rides, medals
}

const placeWorkout = `{"name":"W","steps":[{"type":"steady","seconds":600,"target":0.8}]}`

// A session's rides name its crew, its voice channel and the session itself
// (#2443) — including a channel no room ever became, which the room-era save
// could not resolve at all. The medals name the crew.
func TestASessionsRidesNameTheirCrewChannelAndSession(t *testing.T) {
	st := storetest.Open(t)
	ctx := context.Background()
	riders := placeRiders(t, st)
	owner, _ := store.ParseUUID(riders[0].Rider.ID)
	crew, err := st.Queries.CreateCrew(ctx, db.CreateCrewParams{Name: "Thursday Crew", OwnerID: owner, Code: testx.CrewCode()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	channel, err := st.Queries.CreateChannel(ctx, db.CreateChannelParams{CrewID: crew.ID, Kind: "voice", Name: "Pain Cave", MaxChannels: 10})
	if err != nil {
		t.Fatal(err)
	}
	session := uuid.NewString()

	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	if err := saver.save(ctx, store.UUIDString(channel.ID), session, "W", placeWorkout, time.Now().Add(-time.Hour).Truncate(time.Second), riders); err != nil {
		t.Fatalf("a session in a channel no room became: %v", err)
	}
	rides, medals := where(t, st, riders)
	for i, got := range rides {
		if got.room.Valid || got.crew != crew.ID || got.channel != channel.ID || store.UUIDString(got.session) != session {
			t.Errorf("%s's ride: room %v crew %v channel %v session %v — want no room, the crew, the channel and the session",
				riders[i].Rider.Name, got.room.Valid, got.crew.Valid, got.channel.Valid, store.UUIDString(got.session))
		}
	}
	if len(medals) == 0 {
		t.Fatal("three riders earned no medals — the medal half of this test measured nothing")
	}
	for _, m := range medals {
		if m.crew != crew.ID || m.room.Valid {
			t.Errorf("a medal names crew %v room %v, want the crew and no room", m.crew.Valid, m.room.Valid)
		}
	}
}

// A channel deleted while its session ran is nowhere — and the rides are
// saved anyway: nobody ever loses a ride (WATTROOM.md).
func TestASessionInADeletedChannelStillSavesItsRides(t *testing.T) {
	st := storetest.Open(t)
	riders := placeRiders(t, st)
	saver := NewSaver(st, slog.New(slog.DiscardHandler))
	if err := saver.save(context.Background(), uuid.NewString(), uuid.NewString(), "W", placeWorkout,
		time.Now().Add(-time.Hour).Truncate(time.Second), riders); err != nil {
		t.Fatalf("a session whose channel is gone: %v", err)
	}
	rides, medals := where(t, st, riders)
	for _, got := range rides {
		if got.crew.Valid || got.channel.Valid {
			t.Errorf("a ride from a deleted channel names crew %v channel %v", got.crew.Valid, got.channel.Valid)
		}
	}
	if len(medals) != 0 {
		t.Errorf("%d medals awarded to nowhere", len(medals))
	}
}
