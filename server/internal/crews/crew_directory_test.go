package crews

// The public crew directory and the share card — the tests for
// crew_directory.go (#2445).

import (
	"net/http"
	"strings"
	"testing"
)

// crewDirectoryEntry is the caller's directory entry for one code, nil when
// the crew is not in it. Looked up by code rather than by count: the test
// database is shared by every package in the run.
func (h *harness) crewDirectoryEntry(t *testing.T, who, code string) map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/crews/directory", "")
	if status != http.StatusOK {
		t.Fatalf("crew directory as %s: %d %v", who, status, body)
	}
	entries, _ := body["crews"].([]any)
	for _, item := range entries {
		if entry, _ := item.(map[string]any); entry["code"] == code {
			return entry
		}
	}
	return nil
}

// ADR-0039's entry rule, carried to the crew by ADR-0058: a crew is in the
// directory only when its owner or an admin put it there, and the entry is a
// name, a mark and a link — the door, and nothing past it.
func TestCrewDirectoryListsOnlyWhatAdminsChose(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Directory Crew")
	code := codeOf(crew.Code)
	patch := func(who, body string) int {
		status, _ := h.call(t, who, http.MethodPatch, crewPath(crew), body)
		return status
	}
	// A name that sorts onto the first page whatever else is listed.
	const name = "0 Findable Crew"

	// Every crew starts unlisted — the default lives in the schema.
	if entry := h.crewDirectoryEntry(t, "bob", code); entry != nil {
		t.Fatalf("a crew listed itself without being asked: %v", entry)
	}

	// Listing is the admins' switch: a plain member cannot throw it.
	h.joinCrew(t, "bob", code)
	if status := patch("bob", `{"name":"`+name+`","listed":true}`); status != http.StatusForbidden {
		t.Fatalf("a member listed the crew: %d", status)
	}
	if status := patch("alice", `{"name":"`+name+`","listed":true}`); status != http.StatusOK {
		t.Fatalf("the owner could not list the crew: %d", status)
	}

	// Carol is in no crew of alice's, and can find it.
	entry := h.crewDirectoryEntry(t, "carol", code)
	if entry == nil || entry["name"] != name {
		t.Fatalf("carol cannot find a listed crew: %v", entry)
	}
	for key := range entry {
		if key != "code" && key != "name" && key != "icon" && key != "imageUrl" {
			t.Errorf("a directory entry carries %q — the columns are the disclosure decision", key)
		}
	}

	// The switch reads back to the people who can throw it, and to nobody else.
	_, owner := h.call(t, "alice", http.MethodGet, crewPath(crew), "")
	if owner["listed"] != true {
		t.Errorf("the owner's crew page does not say it is listed: %v", owner["listed"])
	}
	_, member := h.call(t, "bob", http.MethodGet, crewPath(crew), "")
	if member["listed"] != nil {
		t.Errorf("a member's crew page carries the listing switch: %v", member["listed"])
	}

	// A PATCH that leaves the field out keeps it (nil keeps).
	if status := patch("alice", `{"name":"`+name+`"}`); status != http.StatusOK {
		t.Fatalf("rename: %d", status)
	}
	if h.crewDirectoryEntry(t, "carol", code) == nil {
		t.Fatal("a rename unlisted the crew")
	}
	if status := patch("alice", `{"name":"`+name+`","listed":false}`); status != http.StatusOK {
		t.Fatalf("unlist: %d", status)
	}
	if entry := h.crewDirectoryEntry(t, "carol", code); entry != nil {
		t.Fatalf("an unlisted crew is still in the directory: %v", entry)
	}

	// Signed out is not "public": opt-in public means opt-in to the riders on
	// this instance, not to the web (ADR-0009).
	if status, _ := h.call(t, "", http.MethodGet, "/api/crews/directory", ""); status != http.StatusUnauthorized {
		t.Errorf("signed out read the directory: %d", status)
	}
}

// The share card answers to the code, whatever its case, as the door does —
// and to nothing else.
func TestCrewCardAnswersToTheCode(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Card Crew")
	code := codeOf(crew.Code)
	name, _, ok := h.svc.CrewCard(t.Context(), strings.ToLower(code))
	if !ok || name != crew.Name {
		t.Fatalf("CrewCard(%q) = %q %v, want %q", code, name, ok, crew.Name)
	}
	if _, _, ok := h.svc.CrewCard(t.Context(), "NOSUCHCODE"); ok {
		t.Fatal("an unknown code has a card")
	}
}
