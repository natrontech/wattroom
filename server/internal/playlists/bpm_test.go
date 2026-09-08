package playlists

import (
	"context"
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestTargetCadence(t *testing.T) {
	cases := []struct {
		name string
		mood hub.SessionMood
		want float64 // 0 means "no preference"
	}{
		// The band IS the work (#66), so it wins over anything effort implies.
		{"a band beats the effort tier", hub.SessionMood{TargetPct: 0.95, CadenceLow: 55, CadenceHigh: 65}, 60},
		{"one-sided band, over", hub.SessionMood{TargetPct: 0.68, CadenceLow: 100}, 100},
		{"one-sided band, under", hub.SessionMood{TargetPct: 0.68, CadenceHigh: 60}, 60},

		{"recovery", hub.SessionMood{TargetPct: 0.5}, 80},
		{"endurance", hub.SessionMood{TargetPct: 0.68}, 85},
		{"threshold", hub.SessionMood{TargetPct: 0.9}, 90},
		{"VO2", hub.SessionMood{TargetPct: 1.15}, 95},

		// Nothing running, and blocks with no fraction that describes the
		// room: an absolute-watts hold, a sprint. Silence, not a guess.
		{"no session", hub.SessionMood{}, 0},
		{"a block with no fraction", hub.SessionMood{TargetPct: 0}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rpm, ok := targetCadence(tc.mood)
			if tc.want == 0 {
				if ok {
					t.Fatalf("claimed a preference of %v rpm", rpm)
				}
				return
			}
			if !ok || rpm != tc.want {
				t.Errorf("rpm = %v (ok=%v), want %v", rpm, ok, tc.want)
			}
		})
	}
}

// The BPM half of the weight (#270). The boost has to reach tracks at the
// cadence AND at double it, leave everything else exactly where #269 put it,
// and vanish entirely when no session is running — that last one silently
// biases every idle room's music if it is wrong.
func TestBpmBoostsTheCadenceAndItsDouble(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}

	onBeat := h.trackBpm(t, "alice", "Ninety", 90)
	doubled := h.trackBpm(t, "alice", "One Eighty", 180)
	offBeat := h.trackBpm(t, "alice", "One Twenty", 120)
	untagged := h.track(t, "alice", "Nobody Said")
	// `tracks.bpm` is an unconstrained smallint; both API paths bound it to
	// 1..399, so this row is written directly — which is also the only way
	// one could ever appear. It exists to hold the idle-room guard honest:
	// without it, `abs(0 - 0) <= 0` is TRUE and a zero-BPM track is the one
	// thing a room with no session running would start favouring.
	zeroBpm := h.trackBpm(t, "alice", "Zero", 0)

	weights := func(rpm float64) map[string]float64 {
		t.Helper()
		rows, err := h.store.Queries.SmartShuffleTracks(t.Context(), db.SmartShuffleTracksParams{
			RoomID: room.ID, Lim: 1000,
			TargetRpm: rpm, BpmTolerance: bpmTolerance, BpmBoost: bpmBoost,
			AffinityWindow: affinityWindow, ArtistBoost: artistBoost, TagBoost: tagBoost,
		})
		if err != nil {
			t.Fatalf("smart shuffle: %v", err)
		}
		out := map[string]float64{}
		for _, r := range rows {
			out[store.UUIDString(r.ID)] = r.Weight
		}
		return out
	}

	riding := weights(90)
	for _, tc := range []struct {
		name, id string
		want     float64
		why      string
	}{
		{"at the cadence", onBeat, bpmBoost, "90 BPM under a 90 rpm block"},
		{"at double the cadence", doubled, bpmBoost, "the same beat, one stroke at a time"},
		{"off the beat", offBeat, 1.0, "120 is neither 90 nor 180"},
		{"no BPM tagged", untagged, 1.0, "never punished for what nobody said"},
	} {
		if got := riding[tc.id]; math.Abs(got-tc.want) > 0.01 {
			t.Errorf("%s: weight = %v, want %v (%s)", tc.name, got, tc.want, tc.why)
		}
	}

	if got := riding[zeroBpm]; math.Abs(got-1.0) > 0.01 {
		t.Errorf("a zero-BPM track was boosted under a 90 rpm block: %v", got)
	}

	// No session: every track back to 1, the pre-#270 draw exactly.
	for id, w := range weights(0) {
		if math.Abs(w-1.0) > 0.01 {
			t.Errorf("idle room still biased: %s weighs %v, want 1", id, w)
		}
	}
}

func (h *harness) trackBpm(t *testing.T, uploader, title string, bpm int16) string {
	t.Helper()
	id := h.track(t, uploader, title)
	uid, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if _, err := h.store.Pool.Exec(context.Background(),
		"update tracks set bpm = $2 where id = $1", uid, bpm); err != nil {
		t.Fatalf("set bpm: %v", err)
	}
	return id
}
