package channels

import (
	"context"
	"log/slog"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// The hub's minutes land as counters: a rider's own, and a crew's for each of
// its voice channels that had two riders in it. What is not a voice channel
// of a crew, or not a rider any more, is skipped without costing the batch.
func TestVoiceTimeLandsAsCounters(t *testing.T) {
	st := storetest.Open(t)
	rider := func(name string) db.User {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
		return u
	}
	kim, lena, gone := rider("kim"), rider("lena"), rider("gone")
	crew := testx.Crew(t, st, "Hangout", kim.ID, lena.ID)
	lounge := testx.Voice(t, st, crew, "Lounge", false)
	upstairs := testx.Voice(t, st, crew, "Upstairs", false)
	notes := store.UUIDString(testx.Text(t, st, crew, "notes"))

	k := &VoiceTime{store: st, log: slog.New(slog.DiscardHandler),
		riders: map[string]int64{}, together: map[string]int64{}}
	ids := []string{store.UUIDString(kim.ID), store.UUIDString(lena.ID), store.UUIDString(gone.ID), "not-a-rider"}
	k.AddVoiceTime(ids, []string{lounge, upstairs, notes}, 60)
	k.AddVoiceTime(ids[:1], []string{lounge}, 60)
	if _, err := st.Pool.Exec(t.Context(), "delete from users where id = $1", gone.ID); err != nil {
		t.Fatal(err)
	}
	k.flush(t.Context())

	for _, want := range []struct {
		who     db.User
		seconds int64
	}{{kim, 120}, {lena, 60}} {
		got, err := st.Queries.UserVoiceSeconds(t.Context(), want.who.ID)
		if err != nil || got != want.seconds {
			t.Errorf("%s has %d s in voice (%v), want %d", want.who.DisplayName, got, err, want.seconds)
		}
	}
	// The lounge twice and upstairs once; the text channel is no place to hang out.
	if got, err := st.Queries.CrewTogetherSeconds(t.Context(), crew); err != nil || got != 180 {
		t.Errorf("the crew has %d s together (%v), want 180", got, err)
	}
	if len(k.riders) != 0 || len(k.together) != 0 {
		t.Errorf("a batch that landed is still pending: %v %v", k.riders, k.together)
	}

	// The next flush adds to what is there.
	k.AddVoiceTime(ids[1:2], nil, 60)
	k.flush(t.Context())
	if got, _ := st.Queries.UserVoiceSeconds(t.Context(), lena.ID); got != 120 {
		t.Errorf("Lena's second minute: %d s, want 120", got)
	}
}
