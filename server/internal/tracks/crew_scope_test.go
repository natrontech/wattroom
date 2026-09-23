package tracks

import (
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// Phase 2 of #1095 (#1103): the audio endpoint's reach is "may enter a
// channel the uploader may enter", asked of visible_channels (ADR-0058). That
// is the crew scope — an open channel admits the whole crew — and it is what
// closes the door #1126 did not know about: a crew ban left the room's
// membership row in place, so the old "shares a room" join kept handing a
// crew-banned rider the bytes.

// crewOf makes owner a crew with an open voice channel and returns it —
// nobody else in it yet.
func (h *harness) crewOf(t *testing.T, owner string) pgtype.UUID {
	t.Helper()
	crew := testx.Crew(t, h.store, owner, h.users.ByToken[owner].ID)
	testx.Voice(t, h.store, crew, "Crew Scope", false)
	return crew
}

// member puts who into crew as a plain member, named into no channel.
func (h *harness) member(t *testing.T, crew pgtype.UUID, who string) {
	t.Helper()
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew, UserID: h.users.ByToken[who].ID, Role: "member",
	}); err != nil {
		t.Fatalf("member %s: %v", who, err)
	}
}

func (h *harness) audio(t *testing.T, who, id string) int {
	t.Helper()
	return h.do(t, who, http.MethodGet, "/api/tracks/"+id+"/audio", nil).Code
}

// The widening: bob joined alice's crew and is named into none of its
// channels. Its open channel admits him and admits alice, so they share a
// channel in the sense that matters — and alice's track plays for him, even
// though nobody put him in that channel by name. Her private channel, which
// does not admit him, is not what does it.
func TestATrackReachesWhoeverMayEnterAChannelItsUploaderMayEnter(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(41, 383), "Crew.mp3")
	id, _ := track["id"].(string)
	crew := h.crewOf(t, "alice")
	testx.Voice(t, h.store, crew, "Back Room", true)

	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Fatalf("a stranger could play it (%d) — test proves nothing", code)
	}
	// Bob is in the crew now; the open channel is enterable for him, and
	// alice may enter it.
	h.member(t, crew, "bob")
	if code := h.audio(t, "bob", id); code != http.StatusOK {
		t.Errorf("a crew-mate who may enter a channel alice may enter cannot play her track: %d", code)
	}
	// Browsing is not widened: her shelf stays hers — not listed, not
	// editable, not deletable by a crew-mate who may hear it.
	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, []byte(`{"title":"Mine now"}`)); w.Code != http.StatusNotFound {
		t.Errorf("the crew widened editing alice's track, not just hearing it: %d", w.Code)
	}
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusNotFound {
		t.Errorf("the crew widened deleting alice's track: %d", w.Code)
	}
	if strings.Contains(h.do(t, "bob", http.MethodGet, "/api/tracks", nil).Body.String(), id) {
		t.Errorf("the crew widened listing alice's shelf")
	}
}

// The door #1126 did not list. A crew ban kept the room's membership row; the
// old join read the row and kept playing. Silent if it regresses — the bytes
// go out, nothing errors — so this was seen red against the old query.
func TestACrewBannedRiderCannotPlayACrewMatesTrack(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(42, 383), "Banned.mp3")
	id, _ := track["id"].(string)
	crew := h.crewOf(t, "alice")
	h.member(t, crew, "bob")
	if code := h.audio(t, "bob", id); code != http.StatusOK {
		t.Fatalf("bob could not play it before the ban (%d) — test proves nothing", code)
	}

	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew, UserID: h.users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Errorf("a crew-banned rider still played a crew-mate's track: %d, want 404", code)
	}
	if code := h.audio(t, "alice", id); code != http.StatusOK {
		t.Errorf("banning bob cost alice her own track: %d", code)
	}
}

// Another crew's track is not there: not to read, not to hear. Queueing it
// into a channel is the same door — the hub takes any track id on "add" and
// every rider's deck then asks this endpoint, which is where it 404s.
func TestAnotherCrewsTrackIsNotThere(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(43, 383), "Elsewhere.mp3")
	id, _ := track["id"].(string)
	h.crewOf(t, "alice")
	h.crewOf(t, "bob")

	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, []byte(`{"title":"Mine now"}`)); w.Code != http.StatusNotFound {
		t.Errorf("edit: %d, want 404", w.Code)
	}
	if strings.Contains(h.do(t, "bob", http.MethodGet, "/api/tracks", nil).Body.String(), id) {
		t.Errorf("another crew's track is listed on bob's shelf")
	}
	if code := h.audio(t, "bob", id); code != http.StatusNotFound {
		t.Errorf("audio: %d, want 404", code)
	}
}
