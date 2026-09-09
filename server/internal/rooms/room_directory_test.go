package rooms

// The public directory — the tests for room_directory.go, split out of
// rooms_test.go (consolidation sweep 2026-09-09).

import (
	"net/http"
	"slices"
	"testing"
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

// Listing widens DISCOVERY, never ACCESS. Bob can find the room; he still
// meets every gate he met before. This is the invariant that makes the
// feature safe, and it fails silently — the directory would look identical.
func TestListingARoomOpensNoDoor(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Findable Room")
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Findable Room","listed":true,"soundPack":"base","cheers":["flame"]}`); status != http.StatusOK {
		t.Fatalf("list it: %d", status)
	}

	// Carol is not a member. She can see it exists…
	if names := h.directory(t, "carol"); len(names) != 1 {
		t.Fatalf("carol cannot find a listed room: %v", names)
	}
	// …and that is the whole of what she gains.
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
