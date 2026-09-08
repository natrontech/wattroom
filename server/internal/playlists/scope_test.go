package playlists

import (
	"context"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (h *harness) drawIDs(t *testing.T, slug string) map[string]int {
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
	out := map[string]int{}
	for _, r := range rows {
		out[store.UUIDString(r.ID)]++
	}
	return out
}

// #1095's consumer the issue does not name. Autoplay is the one path that
// reaches for a track NOBODY asked for by name — no page, no search box, no
// queue action — so an unscoped draw here would put a stranger's upload on
// the deck past every check the acceptance criteria list. It fails in the
// quietest way there is: the draw is random, so a track that should not be
// there looks exactly like one that should.
func TestSmartShuffleOnlyDrawsFromTheRoomsOwnMembers(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice") // alice is the only member
	mine := h.track(t, "alice", "On The Shelf")
	strangers := h.track(t, "bob", "Not For This Room")

	drawn := h.drawIDs(t, slug)
	if drawn[strangers] > 0 {
		t.Error("autoplay drew a track nobody in this room uploaded")
	}
	if drawn[mine] == 0 {
		t.Error("autoplay cannot reach a track this room's own member uploaded")
	}
}

// A member joining brings their shelf with them — a room's music is what its
// people brought, which is already what the room permits by hand (any member
// may queue their own track for everyone).
func TestJoiningARoomBringsYourShelfToItsAutoplay(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	theirs := h.track(t, "bob", "Bob's Song")

	if h.drawIDs(t, slug)[theirs] > 0 {
		t.Fatal("a non-member's track was already reachable")
	}
	h.join(t, slug, "bob", "member")
	if h.drawIDs(t, slug)[theirs] == 0 {
		t.Error("bob joined and his shelf did not follow")
	}
}

// Two members holding the same song is two rows — they are two shelves — but
// the draw must offer each once. A join that fanned out would queue one song
// twice in a single refill.
func TestOneSongOnTwoShelvesIsDrawnOncePerShelf(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	h.join(t, slug, "bob", "member")
	hers := h.track(t, "alice", "Both Have It")
	his := h.track(t, "bob", "Both Have It")

	drawn := h.drawIDs(t, slug)
	for _, id := range []string{hers, his} {
		if drawn[id] != 1 {
			t.Errorf("track %s drawn %d times, want 1", id[:8], drawn[id])
		}
	}
}

// A ban keeps the membership row (ADR-0013), so an unguarded join still counts
// it and the room goes on playing the music of someone it threw out. This is
// the loudest of the three siblings #1113 found: the room HEARS it, and there
// is no surface anywhere that explains why.
func TestSmartShuffleDropsABannedRidersShelf(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	h.join(t, slug, "bob", "member")
	mine := h.track(t, "alice", "Still Here")
	theirs := h.track(t, "bob", "Played Anyway")

	if h.drawIDs(t, slug)[theirs] == 0 {
		t.Fatal("bob's shelf was unreachable before the ban — test proves nothing")
	}

	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if err := h.store.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: h.users["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban: %v", err)
	}

	drawn := h.drawIDs(t, slug)
	if drawn[theirs] > 0 {
		t.Error("autoplay still draws from a banned rider's shelf")
	}
	if drawn[mine] == 0 {
		t.Error("the ban emptied the room's own autoplay")
	}
}

// The draw stays on the room's members (#1103 confirmed that over the crew),
// but a member the CREW banned keeps their row and loses their say: their
// shelf must leave the rotation with them. Silent if it regresses — the
// draw is random, so a track that should be gone looks like one that should
// be there — so this was seen red against the old `role != 'banned'` join.
func TestACrewBannedMembersShelfLeavesAutoplay(t *testing.T) {
	h := setup(t)
	slug := h.room(t, "alice")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room.ID, UserID: h.users["bob"].ID, Role: "member",
	}); err != nil {
		t.Fatalf("membership: %v", err)
	}
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "alice", OwnerID: room.OwnerID})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{ID: room.ID, CrewID: crew.ID, CrewVisible: true}); err != nil {
		t.Fatalf("place: %v", err)
	}
	theirs := h.track(t, "bob", "Bob's Song")
	if h.drawIDs(t, slug)[theirs] == 0 {
		t.Fatal("a member's track was not reachable before the ban — test proves nothing")
	}

	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if h.drawIDs(t, slug)[theirs] > 0 {
		t.Error("autoplay still draws from the shelf of a member the crew banned")
	}
}
