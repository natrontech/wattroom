package crews

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// Every crew you are in, with what you are to each (#1476), and none that
// banned you: the switcher and Home read this list since the room list that
// carried it went (#2446).
func TestMyCrewsListsWhatYouAreToEach(t *testing.T) {
	h := setup(t)
	own := h.newCrew(t, "alice", "Alice Crew")
	theirs := h.newCrew(t, "bob", "Bob Crew")
	h.join(t, "alice", theirs)
	banned := h.newCrew(t, "carol", "Carol Crew")
	h.join(t, "alice", banned)
	if status, body := h.call(t, "carol", http.MethodPost, crewPath(banned, "/role"),
		fmt.Sprintf(`{"userId":%q,"role":"banned"}`, h.userID(t, "alice"))); status != http.StatusNoContent {
		t.Fatalf("carol bans alice: %d %v", status, body)
	}

	status, body := h.call(t, "alice", http.MethodGet, "/api/crews", "")
	if status != http.StatusOK {
		t.Fatalf("alice's crews: %d %v", status, body)
	}
	byID := map[string]map[string]any{}
	list, _ := body["crews"].([]any)
	for _, item := range list {
		crew, _ := item.(map[string]any)
		id, _ := crew["id"].(string)
		byID[id] = crew
	}
	mine := byID[store.UUIDString(own.ID)]
	if mine["role"] != "owner" || mine["founded"] != true || mine["named"] != true || mine["code"] != codeOf(own.Code) {
		t.Errorf("her own crew reads %v", mine)
	}
	member := byID[store.UUIDString(theirs.ID)]
	if member["role"] != "member" || member["founded"] != nil || member["code"] != codeOf(theirs.Code) {
		t.Errorf("bob's crew reads %v", member)
	}
	if crew, listed := byID[store.UUIDString(banned.ID)]; listed {
		t.Errorf("a crew that banned her is listed: %v", crew)
	}
	if len(byID) != 2 {
		t.Errorf("alice is in %d crews, want 2: %v", len(byID), list)
	}

	if status, _ := h.call(t, "", http.MethodGet, "/api/crews", ""); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
}
