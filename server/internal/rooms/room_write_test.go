package rooms

// Creating, updating and deleting rooms — the tests for room_write.go and
// rooms.go, split out of rooms_test.go (consolidation sweep 2026-09-09).

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestCreateAndJoinFlow(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Velvet Hammer Test")

	if !strings.HasPrefix(slug, "velvet-hammer-test-") {
		t.Errorf("slug %q does not come from the name plus a random suffix", slug)
	}
	if len(code) != 6 {
		t.Errorf("code %q is not 6 chars", code)
	}

	// A signed-in stranger with the link sees the name but not the invite code
	// or the member list — enough to decide to join, nothing more. The door
	// tells them it is shut, and that they are not in the crew (#1236).
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["code"] != nil || body["members"] != nil {
		t.Fatalf("stranger view leaked: %d %v", status, body)
	}
	if body["canEnter"] != nil || body["inCrew"] != nil {
		t.Errorf("a stranger's door says canEnter=%v inCrew=%v, want neither", body["canEnter"], body["inCrew"])
	}

	// The stranger may not walk in: the room's crew is not theirs (#1236).
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Fatalf("a stranger walked into a room by its address: %d", status)
	}
	// Join the crew by code — lowercase with spaces, because it was read out
	// loud — then walk into the room, which is open to the crew.
	status, body = h.call(t, "bob", http.MethodPost, "/api/crews/join",
		fmt.Sprintf(`{"code":%q}`, "  "+strings.ToLower(code)+"  "))
	if status != http.StatusOK || body["name"] == nil {
		t.Fatalf("join crew by code: %d %v", status, body)
	}
	// In the crew and at an open room's door: it opens.
	if _, door := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); door["canEnter"] != true || door["inCrew"] != true {
		t.Errorf("a crew member's door says canEnter=%v inCrew=%v, want both", door["canEnter"], door["inCrew"])
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("a crew member could not walk in: %d", status)
	}

	// A member sees everything — including the crew's code on the room, which
	// is what the TV shows when the lounge is idle (#1236).
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["role"] != "member" {
		t.Fatalf("member view: %d %v", status, body)
	}
	if c, _ := body["crew"].(map[string]any); c["code"] != code {
		t.Errorf("the room's crew does not carry the crew's code for members: %v", body["crew"])
	}
	if members, _ := body["members"].([]any); len(members) != 2 {
		t.Fatalf("expected 2 members, got %v", body["members"])
	}
}

func TestUnauthenticatedAndBadCode(t *testing.T) {
	h := setup(t)
	if status, _ := h.call(t, "", http.MethodPost, "/api/rooms", `{"name":"x"}`); status != http.StatusUnauthorized {
		t.Errorf("signed-out create: %d", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/crews/join", `{"code":"XXXXXX"}`)
	if status != http.StatusNotFound || body["field"] != "code" {
		t.Errorf("bad code: %d %v", status, body)
	}
}

func TestSlugAndCodeHelpers(t *testing.T) {
	if got := slugify("Velvet Hammer!!"); got != "velvet-hammer" {
		t.Errorf("slugify: %q", got)
	}
	if got := slugify("???"); got != "room" {
		t.Errorf("slugify fallback: %q", got)
	}
	code := randomCode(6)
	for _, c := range code {
		if strings.ContainsRune("0O1IL", c) {
			t.Errorf("code %q contains a read-aloud-ambiguous character", code)
		}
	}
}

// TestSlugSuffixUnguessable covers #694: a room's slug is not just its name,
// so two rooms sharing a name land on different, unguessable URLs, and
// renaming never regenerates or drops the suffix a shared link depends on.
func TestSlugSuffixUnguessable(t *testing.T) {
	h := setup(t)
	slugA, _ := h.createRoom(t, "alice", "Thursday Crew")
	slugB, _ := h.createRoom(t, "bob", "Thursday Crew")

	if slugA == slugB {
		t.Fatalf("two rooms with the same name got the same slug: %q", slugA)
	}
	const prefix = "thursday-crew-"
	if !strings.HasPrefix(slugA, prefix) || !strings.HasPrefix(slugB, prefix) {
		t.Fatalf("slugs missing the name prefix: %q, %q", slugA, slugB)
	}
	suffixA := strings.TrimPrefix(slugA, prefix)
	suffixB := strings.TrimPrefix(slugB, prefix)
	if suffixA == "" || suffixB == "" || suffixA == suffixB {
		t.Fatalf("suffixes are not distinct random strings: %q, %q", suffixA, suffixB)
	}

	// Renaming the room must not touch the slug — the suffix (and the whole
	// slug) is fixed at creation so a shared link keeps working.
	status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slugA,
		`{"name":"Friday Crew","listed":false}`)
	if status != http.StatusOK {
		t.Fatalf("rename: %d %v", status, body)
	}
	if got := body["slug"]; got != slugA {
		t.Fatalf("rename changed the slug: %q -> %v", slugA, got)
	}
	status, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slugA, "")
	if status != http.StatusOK || body["name"] != "Friday Crew" {
		t.Fatalf("renamed room not reachable at its old slug: %d %v", status, body)
	}
}

func TestUpdateSoundPackAndDelete(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Deletable")
	_ = code

	h.enter(t, "bob", code, slug)

	// Owner sets the pack; bad values bounce with the field named.
	status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":false,"soundPack":"silent"}`)
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("set pack: %d %v", status, body)
	}
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":false,"soundPack":"airhorn"}`)
	if status != http.StatusBadRequest || body["field"] != "soundPack" {
		t.Fatalf("bad pack: %d %v", status, body)
	}
	// A PATCH without the field (the drawer's listed toggle) keeps the pack.
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":true}`)
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("patch keeps pack: %d %v", status, body)
	}
	// Members see it on GET.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("member sees pack: %d %v", status, body)
	}

	// Delete is owner-only.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusForbidden {
		t.Fatalf("member delete: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("owner delete: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); status != http.StatusNotFound {
		t.Fatalf("room gone: %d", status)
	}
}

func TestOwnedRoomsCap(t *testing.T) {
	h := setup(t)
	for i := range 3 {
		h.createRoom(t, "alice", fmt.Sprintf("Cap Room %d", i))
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms", `{"name":"One Too Many"}`)
	if status != http.StatusConflict || body["error"] != "conflict" {
		t.Fatalf("fourth room: %d %v", status, body)
	}
	// Deleting frees the slot (docs/SPEC.md), and the list carries the role
	// the frontend gates on.
	status, body = h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	roomsList, _ := body["rooms"].([]any)
	if status != http.StatusOK || len(roomsList) != 3 {
		t.Fatalf("list: %d %v", status, body)
	}
	first, _ := roomsList[0].(map[string]any)
	if first["role"] != "owner" {
		t.Fatalf("list entry missing role: %v", first)
	}
	// The frontend disables "Open room" on this number and phrases the hint
	// from it (#603) — without it the cap is a literal in two codebases.
	if owned, _ := body["maxOwned"].(float64); int(owned) != maxOwnedRooms {
		t.Fatalf("list missing the cap the frontend gates on: %v", body["maxOwned"])
	}
	slug, _ := first["slug"].(string)
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms", `{"name":"Slot Freed"}`); status != http.StatusCreated {
		t.Fatalf("after delete: %d", status)
	}
}

func TestIconAndCheers(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Icon Cave")

	patch := func(body string) (int, map[string]any) {
		return h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug, body)
	}
	// Fresh room: no icon, base palette.
	if _, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, ""); body["icon"] != nil {
		t.Errorf("fresh room has an icon: %v", body["icon"])
	} else if cheers, _ := body["cheers"].([]any); len(cheers) != 6 {
		t.Errorf("fresh room palette: %v", body["cheers"])
	}

	// Icon: an icon key (#447) or none; junk refused; an emoji from before
	// #447 still lands so old rooms and clients keep working.
	if status, body := patch(`{"name":"Icon Cave","icon":"not an icon!"}`); status != http.StatusBadRequest {
		t.Errorf("junk icon accepted: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"<script>"}`); status != http.StatusBadRequest {
		t.Errorf("markup icon accepted: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"bike"}`); status != http.StatusOK || body["icon"] != "bike" {
		t.Errorf("key icon: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"🦖"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("emoji icon (compat): %d %v", status, body)
	}
	// Absent field keeps it; empty clears it.
	if status, body := patch(`{"name":"Icon Cave"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("absent icon did not keep: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":""}`); status != http.StatusOK || body["icon"] != nil {
		t.Errorf("empty icon did not clear: %d %v", status, body)
	}

	// Cheers: owner curates, dupes collapse, junk refused, cap enforced.
	if status, body := patch(`{"name":"Icon Cave","cheers":["heart","zap","heart"]}`); status != http.StatusOK {
		t.Fatalf("cheers: %d %v", status, body)
	} else if cheers, _ := body["cheers"].([]any); len(cheers) != 2 || cheers[0] != "heart" {
		t.Errorf("palette: %v", body["cheers"])
	}
	if status, body := patch(`{"name":"Icon Cave","cheers":["🦖","🌵"]}`); status != http.StatusOK {
		t.Errorf("emoji reactions (compat): %d %v", status, body)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["gg!"]}`); status != http.StatusBadRequest {
		t.Errorf("text reaction accepted: %d", status)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["Flame"]}`); status != http.StatusBadRequest {
		t.Errorf("uppercase reaction accepted: %d", status)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["flame","biceps-flexed","party-popper","skull","rocket","snowflake","heart","zap","trophy"]}`); status != http.StatusBadRequest {
		t.Errorf("nine reactions accepted: %d", status)
	}
	// Empty resets to the base set.
	if _, body := patch(`{"name":"Icon Cave","cheers":[]}`); true {
		if cheers, _ := body["cheers"].([]any); len(cheers) != 6 {
			t.Errorf("reset palette: %v", body["cheers"])
		}
	}
}
