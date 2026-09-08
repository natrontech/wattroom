package playlists

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// track puts one row in the pool. The sha is random rather than derived from
// the test name: `tracks.sha256` is globally unique and wattroom_test is
// shared between worktrees, so a fixed one collides with whoever else is
// running right now.
func (h *harness) track(t *testing.T, uploader, title string) string {
	t.Helper()
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("sha: %v", err)
	}
	// Its own artist and no tags, so a track is unrelated to every other one
	// unless a test deliberately relates them. Sharing an artist here would
	// hand every fixture #271's affinity boost and quietly triple the
	// recency and skip numbers the tests below are actually about.
	row, err := h.store.Queries.CreateTrack(t.Context(), db.CreateTrackParams{
		Sha256: hex.EncodeToString(raw[:]), UploadedBy: h.users[uploader].ID,
		Title: title, Artist: "Artist of " + title, Album: "Before the Storm",
		DurationMs: 225000, SizeBytes: 4_000_000, Tags: []string{},
	})
	if err != nil {
		t.Fatalf("create track: %v", err)
	}
	// The uploader cascade takes the row when setup() deletes the user, but
	// a failed subtest should not leave the pool dirty for the next one.
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from tracks where id = $1", row.ID)
	})
	return store.UUIDString(row.ID)
}

func (h *harness) weights(t *testing.T, slug string) map[string]float64 {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	rows, err := h.store.Queries.SmartShuffleTracks(t.Context(), db.SmartShuffleTracksParams{
		// wattroom_test is shared: ask for more than the pool can plausibly
		// hold, so a neighbouring suite's tracks cannot push ours out of range.
		RoomID: room.ID, Lim: 1000,
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

// The weighting is what smart shuffle IS (#269, docs/SPEC.md). The draw
// itself is random and cannot be asserted; the weight it draws on can, and a
// wrong one is invisible — the room just quietly keeps playing what it skips.
func TestSmartShuffleWeighsRecencyAndSkips(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")

	fresh := h.track(t, "alice", "Never played")
	skipped := h.track(t, "alice", "Skipped twice")
	justPlayed := h.track(t, "alice", "Just played")
	longAgo := h.track(t, "alice", "Played this morning")

	ctx := t.Context()
	h.svc.TrackEnded(ctx, slug, skipped, store.UUIDString(h.users["alice"].ID), true)
	h.svc.TrackEnded(ctx, slug, skipped, "", true)
	h.svc.TrackEnded(ctx, slug, justPlayed, "", false)
	h.svc.TrackEnded(ctx, slug, longAgo, "", false)
	// Age that last one past the 4 h recency window without waiting for it.
	if _, err := h.store.Pool.Exec(ctx,
		"update track_plays set at = now() - interval '5 hours' where track_id = $1", longAgo,
	); err != nil {
		t.Fatalf("age the play: %v", err)
	}

	got := h.weights(t, slug)
	for _, tc := range []struct {
		name, id string
		want     float64
		why      string
	}{
		{"never played", fresh, 1.0, "no history is full weight"},
		{"skipped twice", skipped, 1.0 / 3.0, "divided by one more than the skips"},
		{"just played", justPlayed, 0.05, "the recency floor, not zero — a penalty, not a ban"},
		{"played 5 h ago", longAgo, 1.0, "older than the 4 h window is forgiven"},
	} {
		if math.Abs(got[tc.id]-tc.want) > 0.01 {
			t.Errorf("%s: weight = %v, want %v (%s)", tc.name, got[tc.id], tc.want, tc.why)
		}
	}
}

// Privacy is architecture (WATTROOM.md): one room's taste is not a fact about
// the pool. A global count would be the easy mistake here and would show up
// only as another room mysteriously avoiding a song.
func TestSmartShuffleHistoryIsRoomScoped(t *testing.T) {
	h := setup(t)
	// Both rooms are alice's: since #1095 a room's smart draw only reaches
	// tracks its own MEMBERS uploaded, so a room bob owns would not see this
	// track at all and the test would pass for the wrong reason.
	loud := h.room(t, "alice")
	quiet := h.room(t, "alice")
	track := h.track(t, "alice", "Divisive")

	for range 3 {
		h.svc.TrackEnded(t.Context(), loud, track, "", true)
	}

	if got := h.weights(t, loud)[track]; math.Abs(got-0.25) > 0.01 {
		t.Errorf("the room that skipped it: weight = %v, want 0.25", got)
	}
	if got := h.weights(t, quiet)[track]; math.Abs(got-1.0) > 0.01 {
		t.Errorf("a room that never heard it: weight = %v, want 1", got)
	}
}

// Autoplay in smart mode draws from the pool and ignores the active playlist
// — the setting picks a source as well as an order.
func TestSmartAutoplayQueuesPoolTracks(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	track := h.track(t, "alice", "Sandstorm")

	if code, body := h.call(t, "alice", "PATCH", "/api/rooms/"+slug+"/autoplay",
		`{"enabled":true,"order":"smart"}`); code != 200 {
		t.Fatalf("set smart: %d %v", code, body)
	}

	_, tracks, ok := h.svc.Autoplay(t.Context(), slug, hub.SessionMood{})
	if !ok || len(tracks) == 0 {
		t.Fatalf("smart autoplay found nothing: ok=%v tracks=%+v", ok, tracks)
	}
	// The SHAPE is what this test owns: every entry is a pool track, not a
	// video. Which one leads is a weighted random draw over a pool this suite
	// shares with every other — asserting an order here would be asserting the
	// RNG, and the weights have their own deterministic tests above.
	found := false
	for _, cmd := range tracks {
		if cmd.TrackID == "" || cmd.VideoID != "" {
			t.Fatalf("smart autoplay queued a video, not a pool track: %+v", cmd)
		}
		if cmd.TrackID == track {
			found = true
			if cmd.Title != "Sandstorm" {
				t.Errorf("title = %q, want the pool row's own", cmd.Title)
			}
		}
	}
	if !found && len(tracks) < smartShuffleBatch {
		// Only a full batch is allowed to have crowded it out.
		t.Errorf("the room's own track missed a batch of %d: %+v", len(tracks), tracks)
	}
}

func TestAutoplayOrderRejectsAnythingElse(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	for _, order := range []string{"ordered", "shuffled", "smart"} {
		if code, body := h.call(t, "alice", "PATCH", "/api/rooms/"+slug+"/autoplay",
			`{"enabled":true,"order":"`+order+`"}`); code != 200 {
			t.Errorf("%s refused: %d %v", order, code, body)
		}
	}
	if code, _ := h.call(t, "alice", "PATCH", "/api/rooms/"+slug+"/autoplay",
		`{"enabled":true,"order":"clever"}`); code != 400 {
		t.Errorf("junk order accepted: %d", code)
	}
}
