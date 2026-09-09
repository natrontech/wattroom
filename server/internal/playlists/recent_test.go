package playlists

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/store"
)

func aliceID(id pgtype.UUID) string { return store.UUIDString(id) }

// "Just played" from the log (#1432): both kinds, newest first, a library
// row wearing the track's current title, a video wearing the title the deck
// showed, and who queued each — nobody for autoplay.
func TestRecentPlaysBothKinds(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	track := h.track(t, "alice", "Sandstorm")
	alice := h.users["alice"].ID
	ctx := t.Context()

	h.svc.TrackEnded(ctx, slug, hub.Play{VideoID: "dQw4w9WgXcQ", Title: "Never Gonna Give You Up", QueuedBy: aliceID(alice), Skipped: false})
	h.svc.TrackEnded(ctx, slug, hub.Play{TrackID: track, Skipped: true})
	// Junk never lands: not a video id, not a track id.
	h.svc.TrackEnded(ctx, slug, hub.Play{VideoID: "nope", Title: "x"})

	got := h.svc.Recent(ctx, slug, 5)
	if len(got) != 2 {
		t.Fatalf("recent = %+v, want the video and the track", got)
	}
	if got[0].TrackID != track || got[0].Title != "Sandstorm" || got[0].Artist != "Artist of Sandstorm" || got[0].AddedBy != "" {
		t.Fatalf("newest (the library track, queued by autoplay): %+v", got[0])
	}
	if got[1].VideoID != "dQw4w9WgXcQ" || got[1].Title != "Never Gonna Give You Up" || got[1].AddedBy != "alice" || got[1].TrackID != "" {
		t.Fatalf("the video, queued by alice: %+v", got[1])
	}

	// Another room remembers nothing of this one (privacy is architecture).
	if other := h.svc.Recent(ctx, h.room(t, "alice"), 5); len(other) != 0 {
		t.Fatalf("another room's recent = %+v, want none", other)
	}
}
