package playlists

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (h *harness) drawIDs(t *testing.T, c crewFixture) map[string]int {
	t.Helper()
	rows, err := h.store.Queries.SmartShuffleTracks(t.Context(), db.SmartShuffleTracksParams{
		ChannelID: c.voiceID, Lim: 1000,
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
// there looks exactly like one that should. Since #2439 the pool is the
// riders who may enter the voice channel (ADR-0058).
func TestSmartShuffleOnlyDrawsFromWhoMayEnterTheChannel(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice") // alice owns the crew; nobody else is in it
	mine := h.track(t, "alice", "On The Shelf")
	strangers := h.track(t, "bob", "Not For This Channel")

	drawn := h.drawIDs(t, c)
	if drawn[strangers] > 0 {
		t.Error("autoplay drew a track nobody who may enter this channel uploaded")
	}
	if drawn[mine] == 0 {
		t.Error("autoplay cannot reach a track the crew's own owner uploaded")
	}
}

// Being let into the channel brings your shelf with you — a channel's music
// is what its people brought, which is already what it permits by hand (any
// of them may queue their own track for everyone).
func TestEnteringTheChannelBringsYourShelfToItsAutoplay(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	theirs := h.track(t, "bob", "Bob's Song")

	if h.drawIDs(t, c)[theirs] > 0 {
		t.Fatal("an outsider's track was already reachable")
	}
	h.join(t, c, "bob", "member")
	if h.drawIDs(t, c)[theirs] == 0 {
		t.Error("bob came in and his shelf did not follow")
	}
}

// An open channel's pool is the whole crew's (ADR-0058): a member nobody
// named into it may still enter, so their shelf is in.
func TestAnOpenChannelDrawsFromTheWholeCrew(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	if err := h.store.Queries.JoinCrew(t.Context(), db.JoinCrewParams{CrewID: c.id, UserID: h.users["bob"].ID}); err != nil {
		t.Fatalf("join crew: %v", err)
	}
	theirs := h.track(t, "bob", "Crew Song")
	if h.drawIDs(t, c)[theirs] > 0 {
		t.Fatal("a member not named into the private channel was drawn from")
	}
	if _, err := h.store.Pool.Exec(t.Context(), `update channels set private = false where id = $1`, c.voiceID); err != nil {
		t.Fatalf("open the channel: %v", err)
	}
	if h.drawIDs(t, c)[theirs] == 0 {
		t.Error("the channel is open to the crew and a member's shelf is still out")
	}
}

// Two riders holding the same song is two rows — they are two shelves — but
// the draw must offer each once. A join that fanned out would queue one song
// twice in a single refill.
func TestOneSongOnTwoShelvesIsDrawnOncePerShelf(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	h.join(t, c, "bob", "member")
	hers := h.track(t, "alice", "Both Have It")
	his := h.track(t, "bob", "Both Have It")

	drawn := h.drawIDs(t, c)
	for _, id := range []string{hers, his} {
		if drawn[id] != 1 {
			t.Errorf("track %s drawn %d times, want 1", id[:8], drawn[id])
		}
	}
}

// A rider taken out of a private channel keeps their crew row, and an
// unguarded pool would go on playing their music in the channel they can no
// longer enter. The room ban this used to test became a crew ban (#2442);
// the room-level exclusion's successor is the private channel's name list.
func TestTakingARiderOutOfAPrivateChannelTakesTheirShelf(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	h.join(t, c, "bob", "member")
	mine := h.track(t, "alice", "Still Here")
	theirs := h.track(t, "bob", "Played Anyway")

	if h.drawIDs(t, c)[theirs] == 0 {
		t.Fatal("bob's shelf was unreachable before — test proves nothing")
	}
	if err := h.store.Queries.UnnameChannelMember(t.Context(), db.UnnameChannelMemberParams{
		ChannelID: c.voiceID, UserID: h.users["bob"].ID,
	}); err != nil {
		t.Fatalf("take bob out: %v", err)
	}

	drawn := h.drawIDs(t, c)
	if drawn[theirs] > 0 {
		t.Error("autoplay still draws from the shelf of a rider taken out of the channel")
	}
	if drawn[mine] == 0 {
		t.Error("taking bob out emptied the channel's own autoplay")
	}
}

// A member the crew banned keeps their row and loses their say: their shelf
// must leave the rotation with them. Silent if it regresses — the draw is
// random, so a track that should be gone looks like one that should be there.
func TestACrewBannedMembersShelfLeavesAutoplay(t *testing.T) {
	h := setup(t)
	c := h.crew(t, "alice")
	h.join(t, c, "bob", "member")
	if _, err := h.store.Pool.Exec(t.Context(), `update channels set private = false where id = $1`, c.voiceID); err != nil {
		t.Fatalf("open the channel: %v", err)
	}
	theirs := h.track(t, "bob", "Bob's Song")
	if h.drawIDs(t, c)[theirs] == 0 {
		t.Fatal("a member's track was not reachable before the ban — test proves nothing")
	}
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: c.id, UserID: h.users["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if h.drawIDs(t, c)[theirs] > 0 {
		t.Error("autoplay still draws from the shelf of a member the crew banned")
	}
}
