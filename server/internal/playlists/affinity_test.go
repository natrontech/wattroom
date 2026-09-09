package playlists

import (
	"context"
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// trackLike puts one row in the pool with a chosen artist and tags — what the
// default fixture deliberately does not do, so a test has to ask for a
// relationship before one exists.
func (h *harness) trackLike(t *testing.T, uploader, title, artist string, tags ...string) string {
	t.Helper()
	id := h.track(t, uploader, title)
	uid, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if tags == nil {
		tags = []string{}
	}
	if _, err := h.store.Pool.Exec(context.Background(),
		"update tracks set artist = $2, tags = $3 where id = $1", uid, artist, tags); err != nil {
		t.Fatalf("set artist/tags: %v", err)
	}
	return id
}

func (h *harness) affinityWeights(t *testing.T, slug string) map[string]float64 {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	rows, err := h.store.Queries.SmartShuffleTracks(t.Context(), db.SmartShuffleTracksParams{
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

// Auto-DJ (#271): what the room finishes pulls its neighbours up. Every one
// of these fails silently — the draw is random, so a boost that never lands
// and a boost that lands on everything look identical from outside.
func TestAffinityFollowsWhatTheRoomFinishes(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")

	played := h.trackLike(t, "alice", "The One We Liked", "Justice", "french-house")
	sameArtist := h.trackLike(t, "alice", "Also Justice", "Justice", "electro")
	sameTag := h.trackLike(t, "alice", "Someone Else", "Cassius", "french-house")
	unrelated := h.trackLike(t, "alice", "Nothing In Common", "Sepultura", "thrash")
	noArtist := h.trackLike(t, "alice", "Untitled", "")
	// A second track nobody named, and the room finishes THIS one. Untagged
	// uploads are ordinary — the ID3 fallback leaves the artist empty — so
	// without the filter on `liked.artists` one anonymous track finishing
	// would lift every other anonymous track in the pool, which is not a
	// taste, it is a missing field.
	otherNoArtist := h.trackLike(t, "alice", "Also Untitled", "")

	// Nothing finished yet: the room has no taste and everything weighs 1.
	for id, w := range h.affinityWeights(t, slug) {
		if math.Abs(w-1.0) > 0.01 {
			t.Fatalf("a room with no history already had a preference: %s weighs %v", id, w)
		}
	}

	h.svc.TrackEnded(t.Context(), slug, hub.Play{TrackID: played, QueuedBy: "", Skipped: false})
	h.svc.TrackEnded(t.Context(), slug, hub.Play{TrackID: otherNoArtist, QueuedBy: "", Skipped: false})
	got := h.affinityWeights(t, slug)

	for _, tc := range []struct {
		name, id string
		want     float64
		why      string
	}{
		{"same artist", sameArtist, artistBoost, "a name means one thing exactly"},
		{"a tag in common", sameTag, tagBoost, "weaker: a tag is a hint, not a name"},
		{"unrelated", unrelated, 1.0, "neither the artist nor the tag"},
		{"no artist at all", noArtist, 1.0, "an empty artist must not match another empty one, and one just finished"},
	} {
		if w := got[tc.id]; math.Abs(w-tc.want) > 0.01 {
			t.Errorf("%s: weight = %v, want %v (%s)", tc.name, w, tc.want, tc.why)
		}
	}

	// The finished track itself: recency floor ONLY. Affinity must not lift
	// it back toward the deck — the penalty exists to stop exactly that, and
	// a track matches its own artist by definition.
	if w := got[played]; math.Abs(w-0.05) > 0.01 {
		t.Errorf("the track just played weighs %v, want the 0.05 recency floor — affinity lifted it back", w)
	}
}

// Privacy is architecture (WATTROOM.md), and taste is the most personal thing
// the pool holds. What one crew is into must not reach another room.
func TestAffinityIsRoomScoped(t *testing.T) {
	h := setup(t)
	// Both alice's, for the same reason as TestSmartShuffleHistoryIsRoomScoped:
	// #1095 scopes the draw to the room's members' uploads, so a room bob owns
	// would see nothing here and prove nothing about history isolation.
	theirs := h.room(t, "alice")
	ours := h.room(t, "alice")

	played := h.trackLike(t, "alice", "Their Favourite", "Justice", "french-house")
	sibling := h.trackLike(t, "alice", "Its Sibling", "Justice", "electro")
	h.svc.TrackEnded(t.Context(), theirs, hub.Play{TrackID: played, QueuedBy: "", Skipped: false})

	if w := h.affinityWeights(t, theirs)[sibling]; math.Abs(w-artistBoost) > 0.01 {
		t.Errorf("the room that finished it: sibling weighs %v, want %v", w, artistBoost)
	}
	if w := h.affinityWeights(t, ours)[sibling]; math.Abs(w-1.0) > 0.01 {
		t.Errorf("another room inherited their taste: sibling weighs %v, want 1", w)
	}
}

// A skip is not a completion. Boosting an artist because the room threw one
// of their tracks off the deck is the exact inverse of the feature.
func TestASkipBuildsNoAffinity(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")

	skipped := h.trackLike(t, "alice", "Rejected", "Justice", "french-house")
	sibling := h.trackLike(t, "alice", "Its Sibling", "Justice", "electro")
	h.svc.TrackEnded(t.Context(), slug, hub.Play{TrackID: skipped, QueuedBy: "", Skipped: true})

	got := h.affinityWeights(t, slug)
	if w := got[sibling]; math.Abs(w-1.0) > 0.01 {
		t.Errorf("a skip boosted the artist: sibling weighs %v, want 1", w)
	}
	// And the skipped track itself still carries its own penalty.
	if w := got[skipped]; math.Abs(w-0.5) > 0.01 {
		t.Errorf("skipped track weighs %v, want 0.5", w)
	}
}
