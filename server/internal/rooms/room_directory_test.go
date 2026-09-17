package rooms

// The public directory — the tests for room_directory.go, split out of
// rooms_test.go (consolidation sweep 2026-09-09).

import (
	"net/http"
	"slices"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The opt-in public directory (#1118, ADR-0039). Two invariants matter more
// than the listing itself, and both are one careless clause from being wrong.
func TestDirectoryListsOnlyWhatOwnersChose(t *testing.T) {
	h := setup(t)
	openSlug, _ := h.createRoom(t, "alice", "Findable Room")
	shutSlug, _ := h.createRoom(t, "alice", "Private Room")

	// Every room starts unlisted — the default lives in the schema (#698),
	// so a fresh directory is empty however many rooms exist.
	if names := h.directory(t, "bob"); len(names) != 0 {
		t.Fatalf("a room listed itself without being asked: %v", names)
	}

	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+openSlug,
		`{"name":"Findable Room","listed":true,"soundPack":"base","cheers":["flame"]}`); status != http.StatusOK {
		t.Fatalf("list it: %d", status)
	}
	names := h.directory(t, "bob")
	if len(names) != 1 || names[0] != "Findable Room" {
		t.Fatalf("directory = %v, want only the listed room", names)
	}
	if slices.Contains(names, "Private Room") {
		t.Error("an unlisted room is in the directory")
	}
	_ = shutSlug

	// Signed out is not "public": opt-in public means opt-in to the riders on
	// this instance, not to the web (ADR-0009).
	if status, _ := h.call(t, "", http.MethodGet, "/api/rooms/directory", ""); status != http.StatusUnauthorized {
		t.Errorf("signed out read the directory: %d", status)
	}
}

// A listing discloses nothing and admits to the crew — the two halves of
// ADR-0038's 2026-09-17 amendment (#2245), which are one decision and so are
// one test. The read stays the narrowest in the app: a name, an icon, a link.
// The POST beside it is the crew's second, public door, and it has been open
// since #1671 with nothing asserting it — this test was named
// TestListingARoomOpensNoDoor and stopped at the read, so its name said the
// opposite of the product.
func TestListingDisclosesNothingAndAdmitsToTheCrew(t *testing.T) {
	h := setup(t)
	// Three rooms in one crew, which is the cap exactly: the listed one is
	// the door, and the other two are what lies behind it — one left open to
	// the crew, one shut to it.
	slug, crewCode := h.createRoom(t, "alice", "Findable Room")
	sibling, _ := h.createRoom(t, "alice", "Sibling Room")
	shut, _ := h.createRoom(t, "alice", "Shut Room")
	h.makePrivate(t, shut)
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Findable Room","listed":true,"soundPack":"base","cheers":["flame"]}`); status != http.StatusOK {
		t.Fatalf("list it: %d", status)
	}
	crew := h.crewOf(t, slug)
	carol := h.users.ByToken["carol"].ID

	// Carol is not a member. She can see it exists…
	if names := h.directory(t, "carol"); len(names) != 1 || names[0] != "Findable Room" {
		t.Fatalf("carol cannot find a listed room: %v", names)
	}
	// …and that is the whole of what she gains by reading.
	_, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	for _, leak := range []string{"code", "members", "soundPack", "cheers", "icsToken", "board", "me"} {
		if body[leak] != nil {
			t.Errorf("listing exposed %q to a non-member: %v", leak, body[leak])
		}
	}
	// The directory entry itself carries no disclosure beyond the door.
	status, list := h.call(t, "carol", http.MethodGet, "/api/rooms/directory", "")
	if status != http.StatusOK {
		t.Fatalf("directory: %d", status)
	}
	entries, _ := list["rooms"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %v", entries)
	}
	entry, _ := entries[0].(map[string]any)
	for key := range entry {
		if key != "slug" && key != "name" && key != "icon" {
			t.Errorf("a directory entry carries %q — the columns are the disclosure decision", key)
		}
	}
	// Nothing of the crew is hers yet: the door has to be the thing that
	// opens all of it below, not a state she was already in.
	if role := h.crewRole(t, crew, carol); role != "" {
		t.Fatalf("carol is already %q in the crew before joining anything", role)
	}
	if status, _ := h.call(t, "carol", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), ""); status != http.StatusNotFound {
		t.Fatalf("the crew page answered a stranger: %d", status)
	}

	// The door: posting to a listed room joins the CREW, then the room.
	if status, body := h.call(t, "carol", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("the listed room refused a stranger: %d %v", status, body)
	}
	if role := h.crewRole(t, crew, carol); role != "member" {
		t.Fatalf("the directory admitted carol to the room alone: crew role = %q, want member", role)
	}

	// Transitive, part one: every member is handed the crew's invite
	// (ListCrewRoomsFor and handleGetCrew both select it), so a rider who
	// walked in off the directory can admit others through the front door
	// with the listing out of it entirely. Rotating the code is the only
	// take-back and it breaks every other outstanding link (#1930).
	status, page := h.call(t, "carol", http.MethodGet, "/api/crews/"+store.UUIDString(crew.ID), "")
	if status != http.StatusOK {
		t.Fatalf("the crew page refused its newest member: %d %v", status, page)
	}
	code, _ := page["code"].(string)
	if code != crewCode {
		t.Errorf("crew code handed over = %q, want the crew's own %q", code, crewCode)
	}
	if len(code) != protocol.CrewCodeLen {
		t.Errorf("the invite is %d characters, not %d", len(code), protocol.CrewCodeLen)
	}

	// Transitive, part two: the crew's other rooms open to her, and only the
	// ones their owner left open to the crew. That limit is the whole of the
	// widening, so it is asserted from both sides.
	if status, body := h.call(t, "carol", http.MethodPost, "/api/rooms/"+sibling+"/join", ""); status != http.StatusNoContent {
		t.Errorf("a crew-visible sibling stayed shut to a crew member: %d %v", status, body)
	}
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+shut+"/join", ""); status != http.StatusForbidden {
		t.Errorf("a room shut to its crew opened anyway: %d", status)
	}
}

// `listed` and crew visibility are different axes (ADR-0038 says so
// explicitly). Nothing here may make a crew-visible room listed, and listing
// a room is not a statement about any crew.
func TestListedIsNotCrewVisibility(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Room")
	// Bob is a member, so this room is crew-visible to him by ADR-0038's
	// default — and that must not put it in the public directory.
	h.join(t, "bob", slug)
	if names := h.directory(t, "carol"); len(names) != 0 {
		t.Errorf("a room became listed by having members: %v", names)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if room.Listed {
		t.Error("joining a room set its listed flag")
	}
}
