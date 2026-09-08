package rooms

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A crew ban reaches every room in the crew (ADR-0038, third amendment). Each
// door below refuses a ROOM ban already; the question here is whether it also
// refuses the level above, which it can only do by asking isBanned rather than
// reading the membership row itself.
//
// All of these fail silently if they regress — the door opens, nothing errors —
// so every case is mutation-checked in the PR.

// crewBan puts the room in a fresh crew and bans user at crew level, leaving
// the membership row untouched: the room ban and the crew ban must be
// independently sufficient, and a test that set both would prove neither.
func (h *harness) crewBan(t *testing.T, slug, user string) {
	t.Helper()
	crewID := h.putInCrew(t, slug, "Crew "+slug)
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crewID, UserID: h.users.byToken[user].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
}

// putInCrew creates a crew owned by the room's owner and moves the room into
// it, returning the crew's id. The migration does this for every existing room
// (ADR-0038); tests make rooms after it, so they do it themselves.
func (h *harness) putInCrew(t *testing.T, slug, name string) pgtype.UUID {
	t.Helper()
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	code := randomCode(6)
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: name, OwnerID: room.OwnerID, Code: &code,
	})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	if _, err := h.store.Pool.Exec(t.Context(),
		"update rooms set crew_id = $2 where id = $1", room.ID, crew.ID); err != nil {
		t.Fatalf("place room in crew: %v", err)
	}
	return crew.ID
}

func TestACrewBanClosesEveryRoomDoor(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Hammer")
	h.join(t, "bob", slug)

	// Each door, open before the crew ban. Without this the test would pass
	// against a door that was broken all along.
	doors := []struct {
		name   string
		method string
		path   string
		body   string
		open   int
	}{
		{"the room itself", http.MethodGet, "/api/rooms/" + slug, "", http.StatusOK},
		{"the rider's own room settings", http.MethodPatch, "/api/rooms/" + slug + "/me",
			`{"notify":true,"onBoard":true}`, http.StatusOK},
	}
	for _, d := range doors {
		if status, _ := h.call(t, "bob", d.method, d.path, d.body); status != d.open {
			t.Fatalf("%s was not open before the ban (%d) — test proves nothing", d.name, status)
		}
	}

	h.crewBan(t, slug, "bob")

	for _, d := range doors {
		status, _ := h.call(t, "bob", d.method, d.path, d.body)
		switch d.name {
		case "the room itself":
			// A room's existence is not a secret: the outsider view still
			// renders, but it must no longer carry the insider payload.
			if status != http.StatusOK {
				t.Errorf("%s: got %d, want the outsider view", d.name, status)
			}
		default:
			if status != http.StatusForbidden {
				t.Errorf("%s: a crew-banned rider was let in (%d)", d.name, status)
			}
		}
	}
}

// The outsider view is the interesting half of handleGet: a crew-banned rider
// must lose their role and their own preferences, not merely be refused.
func TestACrewBanTakesTheInsiderViewAway(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Hammer")
	h.join(t, "bob", slug)
	_, before := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if before["role"] != "member" {
		t.Fatalf("bob was not a member before the ban (%v) — test proves nothing", before["role"])
	}

	h.crewBan(t, slug, "bob")

	_, after := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if after["role"] == "member" {
		t.Error("a crew-banned rider still reads as a member of the room")
	}
	if after["me"] != nil {
		t.Error("a crew-banned rider still gets their own room preferences back")
	}
}

// Rejoining is the path a ban exists to shut. A room ban survives it because
// the row carries it; a crew ban has no row in this room at all, so this is
// the case that regresses if a door reads memberships directly.
func TestACrewBanSurvivesRejoining(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Hammer")
	h.crewBan(t, slug, "bob")
	// crewBan re-homes the room in a crew of its own; the ban and the code
	// under test are that crew's.
	code := codeOf(h.crewOf(t, slug).Code)

	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("a crew-banned rider joined by link: %d", status)
	}
	body := fmt.Sprintf(`{"code":%q}`, code)
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", body); status != http.StatusForbidden {
		t.Errorf("a crew-banned rider joined by code: %d", status)
	}
}

// A crew ban is one person in one crew. The blast radius is the thing most
// likely to be got wrong by a join written slightly too loosely.
func TestACrewBanTouchesNobodyElse(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Hammer")
	for _, who := range []string{"bob", "carol"} {
		h.join(t, who, slug)
	}
	h.crewBan(t, slug, "bob")

	prefs := `{"notify":true,"onBoard":true}`
	if status, _ := h.call(t, "carol", http.MethodPatch, "/api/rooms/"+slug+"/me", prefs); status != http.StatusOK {
		t.Errorf("banning bob shut carol out of her own settings: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/me", prefs); status != http.StatusOK {
		t.Errorf("banning bob shut the owner out of her own room: %d", status)
	}
}

// The sidebar is a door too, and it was not in the list above. `ListUserRooms`
// filters `m.role != 'banned'` — the ROOM ban, which a crew ban deliberately
// does not set (the helper above leaves the membership row untouched). So a
// crew-banned rider could still be handed the room in their own room list,
// which is where #1178 puts the crew's name and icon.
func TestACrewBanTakesTheRoomOutOfTheList(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Hammer")
	h.join(t, "bob", slug)
	if !listsRoom(t, h, "bob", slug) {
		t.Fatal("bob's room list is missing the room before the ban — the test would prove nothing")
	}

	h.crewBan(t, slug, "bob")

	if listsRoom(t, h, "bob", slug) {
		t.Error("a crew-banned rider is still handed the room in their own room list")
	}
}

// listsRoom asks GET /api/rooms as user and says whether slug is in it. The
// endpoint answers with an object — {"rooms": [...], "maxOwned": n} — not a
// bare array, which is worth stating because decoding it as one yields an
// empty list rather than an error.
func listsRoom(t *testing.T, h *harness, user, slug string) bool {
	t.Helper()
	status, body := h.call(t, user, http.MethodGet, "/api/rooms", "")
	if status != http.StatusOK {
		t.Fatalf("list rooms: %d", status)
	}
	rooms, _ := body["rooms"].([]any)
	for _, entry := range rooms {
		room, _ := entry.(map[string]any)
		if room["slug"] == slug {
			return true
		}
	}
	return false
}
