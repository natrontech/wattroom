package playlists

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"math"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// track puts one row in the pool. The sha is random rather than derived from
// the test name: `tracks.sha256` is globally unique and the test database
// outlives the run, so a fixed one collides with the previous run's row.
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

func (h *harness) weights(t *testing.T, c crewFixture) map[string]float64 {
	t.Helper()
	rows, err := h.store.Queries.SmartShuffleTracks(t.Context(), db.SmartShuffleTracksParams{
		// The pool is the whole database's: ask for more than it can
		// plausibly hold, so a neighbouring suite's tracks cannot push ours
		// out of range.
		ChannelID: c.voiceID, Lim: 1000, Within: nil,
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
// wrong one is invisible — the channel just quietly keeps playing what it
// skips.
func TestSmartShuffleWeighsRecencyAndSkips(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")

	fresh := h.track(t, "alice", "Never played")
	skipped := h.track(t, "alice", "Skipped twice")
	justPlayed := h.track(t, "alice", "Just played")
	longAgo := h.track(t, "alice", "Played this morning")

	ctx := t.Context()
	h.svc.TrackEnded(ctx, c.voice(), hub.Play{TrackID: skipped, QueuedBy: store.UUIDString(h.users["alice"].ID), Skipped: true})
	h.svc.TrackEnded(ctx, c.voice(), hub.Play{TrackID: skipped, QueuedBy: "", Skipped: true})
	h.svc.TrackEnded(ctx, c.voice(), hub.Play{TrackID: justPlayed, QueuedBy: "", Skipped: false})
	h.svc.TrackEnded(ctx, c.voice(), hub.Play{TrackID: longAgo, QueuedBy: "", Skipped: false})
	// Age that last one past the 4 h recency window without waiting for it.
	if _, err := h.store.Pool.Exec(ctx,
		"update track_plays set at = now() - interval '5 hours' where track_id = $1", longAgo,
	); err != nil {
		t.Fatalf("age the play: %v", err)
	}

	got := h.weights(t, c)
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

// Privacy is architecture (WATTROOM.md): one channel's taste is not a fact
// about the pool. A global count would be the easy mistake here and would
// show up only as another channel mysteriously avoiding a song.
func TestSmartShuffleHistoryIsChannelScoped(t *testing.T) {
	h := setup(t)
	// Both crews are alice's: since #1095 a smart draw only reaches tracks
	// uploaded by riders who may enter the channel, so a crew bob owns would
	// not see this track at all and the test would pass for the wrong reason.
	loud := h.crew(t, "alice")
	quiet := h.crew(t, "alice")
	track := h.track(t, "alice", "Divisive")

	for range 3 {
		h.svc.TrackEnded(t.Context(), loud.voice(), hub.Play{TrackID: track, QueuedBy: "", Skipped: true})
	}

	if got := h.weights(t, loud)[track]; math.Abs(got-0.25) > 0.01 {
		t.Errorf("the channel that skipped it: weight = %v, want 0.25", got)
	}
	if got := h.weights(t, quiet)[track]; math.Abs(got-1.0) > 0.01 {
		t.Errorf("a channel that never heard it: weight = %v, want 1", got)
	}
}

// Autoplay in smart mode draws from the pool and ignores the active playlist
// — the setting picks a source as well as an order.
func TestSmartAutoplayQueuesPoolTracks(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	track := h.track(t, "alice", "Sandstorm")

	h.autoplay(t, c, `{"enabled":true,"order":"smart"}`)

	tracks, ok := h.svc.Autoplay(t.Context(), c.voice(), hub.SessionMood{})
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
		t.Errorf("the channel's own track missed a batch of %d: %+v", len(tracks), tracks)
	}
}

// The channel's PATCH accepts exactly the orders Autoplay walks: one it took
// that Autoplay does not know would fall through to "ordered" in silence.
func TestAutoplayOrderRejectsAnythingElse(t *testing.T) {
	h := setup(t)
	voice := "/api/channels/" + h.crew(t, "alice").voice()
	for _, order := range []string{"ordered", "shuffled", "smart"} {
		if code, body := h.call(t, "alice", http.MethodPatch, voice,
			`{"autoplay":{"enabled":true,"order":"`+order+`"}}`); code != http.StatusOK {
			t.Errorf("%s refused: %d %v", order, code, body)
		}
	}
	if code, _ := h.call(t, "alice", http.MethodPatch, voice,
		`{"autoplay":{"enabled":true,"order":"clever"}}`); code != http.StatusBadRequest {
		t.Errorf("junk order accepted: %d", code)
	}
}

// Smart is an order over the active playlist, not a second source (#1429):
// with a list that holds library tracks, the draw is those and nothing else;
// with no list, it is the members' whole libraries.
func TestSmartAutoplayFollowsTheActivePlaylist(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	base := "/api/crews/" + store.UUIDString(c.id) + "/playlists"
	listed := h.track(t, "alice", "On the list")
	loose := h.track(t, "alice", "Not on the list")

	_, body := h.call(t, "alice", http.MethodPost, base, `{"name":"Smart list"}`)
	playlistID, _ := body["id"].(string)
	if code, body := h.call(t, "alice", http.MethodPost, base+"/"+playlistID+"/tracks",
		`{"action":"add","trackId":"`+listed+`"}`); code != http.StatusCreated {
		t.Fatalf("add library track: %d %v", code, body)
	}
	// A video in the same list is Ordered's and Shuffled's business, never
	// Smart's — it has no history to weigh.
	if code, _ := h.call(t, "alice", http.MethodPost, base+"/"+playlistID+"/tracks", videoTrack); code != http.StatusCreated {
		t.Fatalf("add video: %d", code)
	}
	h.autoplay(t, c, `{"enabled":true,"order":"smart","playlistId":"`+playlistID+`"}`)

	for range 5 {
		tracks, ok := h.svc.Autoplay(t.Context(), c.voice(), hub.SessionMood{})
		if !ok || len(tracks) != 1 || tracks[0].TrackID != listed || tracks[0].VideoID != "" {
			t.Fatalf("smart over a list drew %+v, want only the list's library track", tracks)
		}
	}

	// No active list: the whole library is back, the loose track with it. The
	// channel's PATCH keeps what it is not sent, so clearing is an empty id.
	h.autoplay(t, c, `{"playlistId":""}`)
	tracks, ok := h.svc.Autoplay(t.Context(), c.voice(), hub.SessionMood{})
	seen := map[string]bool{}
	for _, cmd := range tracks {
		seen[cmd.TrackID] = true
	}
	if !ok || !seen[loose] || !seen[listed] {
		t.Fatalf("smart with no list drew %+v, want the whole library", tracks)
	}
}
