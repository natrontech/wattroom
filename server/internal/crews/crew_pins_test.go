package crews

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// The crew's pin board (ADR-0056, #2405). Everyone in the crew writes, which
// is the half of this worth testing rather than assuming: the handlers carry
// no `administers` call, and a reviewer reading that as an oversight would
// "fix" it into the feature the ADR argued against.

// pins is the board as one member reads it. `call` decodes an object and the
// list is an array, so this one goes to the mux directly.
func (h *harness) pins(t *testing.T, who, crewID string) []map[string]any {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/crews/"+crewID+"/pins", nil)
	req.Header.Set("X-Test-User", who)
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("%s listing pins: %d %s", who, w.Code, w.Body.String())
	}
	var out []map[string]any
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decoding the board: %v", err)
	}
	return out
}

func (h *harness) pin(t *testing.T, who, crewID, title, body string) string {
	t.Helper()
	status, out := h.call(t, who, http.MethodPost, "/api/crews/"+crewID+"/pins",
		fmt.Sprintf(`{"title":%q,"body":%q}`, title, body))
	if status != http.StatusCreated {
		t.Fatalf("%s pinning %q: %d %v", who, title, status, out)
	}
	id, _ := out["id"].(string)
	if id == "" {
		t.Fatalf("a pinned pin came back without an id: %v", out)
	}
	return id
}

// crewWith is alice's crew with bob in it as a plain member, by id.
func crewWith(t *testing.T, h *harness) string {
	t.Helper()
	crew := h.newCrew(t, "alice", "Velvet Hammer")
	h.join(t, "bob", crew)
	return store.UUIDString(crew.ID)
}

func TestPinsRoundTrip(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)

	if got := h.pins(t, "alice", crew); len(got) != 0 {
		t.Fatalf("a new crew's board should be empty, got %v", got)
	}

	id := h.pin(t, "alice", crew, "Minecraft", "Address: mc.natron.io:25565")
	board := h.pins(t, "alice", crew)
	if len(board) != 1 || board[0]["title"] != "Minecraft" {
		t.Fatalf("board after pinning: %v", board)
	}
	if board[0]["createdBy"] != h.displayName(t, "alice") {
		t.Fatalf("a pin should carry who wrote it: %v", board[0])
	}

	// Anyone in the crew rewrites any pin — bob is a plain member and never
	// wrote this one. This is ADR-0056's decision, stated as a test so that
	// adding a permission check fails here rather than shipping.
	status, out := h.call(t, "bob", http.MethodPatch, "/api/crews/"+crew+"/pins/"+id,
		`{"title":"Minecraft","body":"Address: mc.natron.io:25565\nPassword: longboat"}`)
	if status != http.StatusOK {
		t.Fatalf("bob editing alice's pin: %d %v", status, out)
	}
	board = h.pins(t, "bob", crew)
	body, _ := board[0]["body"].(string)
	if !strings.Contains(body, "longboat") {
		t.Fatalf("the edit did not land: %v", board)
	}

	if status, out := h.call(t, "bob", http.MethodDelete, "/api/crews/"+crew+"/pins/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("bob unpinning: %d %v", status, out)
	}
	if got := h.pins(t, "alice", crew); len(got) != 0 {
		t.Fatalf("board after unpinning: %v", got)
	}
}

func TestPinValidation(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)

	long := strings.Repeat("x", protocol.MaxPinTitleChars+1)
	tests := []struct {
		name  string
		body  string
		field string
	}{
		{"no title", `{"title":"","body":"something"}`, "title"},
		{"blank title", `{"title":"   ","body":"something"}`, "title"},
		{"title too long", fmt.Sprintf(`{"title":%q,"body":"x"}`, long), "title"},
		{"nothing to say", `{"title":"Minecraft","body":""}`, "body"},
		{"body too long", fmt.Sprintf(`{"title":"x","body":%q}`, strings.Repeat("y", protocol.MaxPinBodyChars+1)), "body"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, out := h.call(t, "alice", http.MethodPost, "/api/crews/"+crew+"/pins", tc.body)
			if status != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d %v", status, out)
			}
			if out["field"] != tc.field {
				t.Fatalf("the refusal should point at %q: %v", tc.field, out)
			}
			if out["message"] == "" {
				t.Fatalf("a refusal says what to do (errors.md): %v", out)
			}
		})
	}

	// Characters, not bytes (#1986): forty kana is a legal title, and the
	// byte length of this one is three times the limit.
	kana := strings.Repeat("あ", protocol.MaxPinTitleChars)
	if status, out := h.call(t, "alice", http.MethodPost, "/api/crews/"+crew+"/pins",
		fmt.Sprintf(`{"title":%q,"body":"x"}`, kana)); status != http.StatusCreated {
		t.Fatalf("a %d-character title is inside the bound: %d %v", protocol.MaxPinTitleChars, status, out)
	}
}

func TestPinsRefuseTheOutsider(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)
	id := h.pin(t, "alice", crew, "Door code", "4417")

	// carol is in no crew: every path is a 404, never a 403. Saying "you may
	// not" about a crew she cannot see would confirm it exists.
	for _, tc := range []struct {
		name, method, path, body string
	}{
		{"list", http.MethodGet, "/api/crews/" + crew + "/pins", ""},
		{"create", http.MethodPost, "/api/crews/" + crew + "/pins", `{"title":"x","body":"y"}`},
		{"update", http.MethodPatch, "/api/crews/" + crew + "/pins/" + id, `{"title":"x","body":"y"}`},
		{"delete", http.MethodDelete, "/api/crews/" + crew + "/pins/" + id, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if status, out := h.call(t, "carol", tc.method, tc.path, tc.body); status != http.StatusNotFound {
				t.Fatalf("carol %s: expected 404, got %d %v", tc.name, status, out)
			}
			// ...and signed out is a 401, not a 404: the difference is
			// whether signing in would help (errors.md).
			if status, out := h.call(t, "", tc.method, tc.path, tc.body); status != http.StatusUnauthorized {
				t.Fatalf("signed out %s: expected 401, got %d %v", tc.name, status, out)
			}
		})
	}
}

func TestPinOfAnotherCrewIsNotFound(t *testing.T) {
	h := setup(t)
	mine := crewWith(t, h)
	// carol's own crew, and a pin on it. Alice is in one crew and carol in
	// the other, so this is a real id that is simply not on alice's board.
	other := store.UUIDString(h.newCrew(t, "carol", "Other Crew").ID)
	theirs := h.pin(t, "carol", other, "Their code", "9999")

	// Every write is crew-scoped in SQL, not only in the handler: alice is a
	// member of `mine`, so the membership check passes and the pin id is the
	// only thing standing between her and carol's board.
	if status, out := h.call(t, "alice", http.MethodPatch, "/api/crews/"+mine+"/pins/"+theirs,
		`{"title":"hijacked","body":"x"}`); status != http.StatusNotFound {
		t.Fatalf("editing another crew's pin: expected 404, got %d %v", status, out)
	}
	if status, out := h.call(t, "alice", http.MethodDelete, "/api/crews/"+mine+"/pins/"+theirs, ""); status != http.StatusNotFound {
		t.Fatalf("unpinning another crew's pin: expected 404, got %d %v", status, out)
	}
	if board := h.pins(t, "carol", other); len(board) != 1 || board[0]["title"] != "Their code" {
		t.Fatalf("carol's board was touched: %v", board)
	}

	// A well-formed id that is on no board at all, and one that is not an id.
	for _, bad := range []string{"00000000-0000-0000-0000-000000000000", "not-a-uuid"} {
		if status, _ := h.call(t, "alice", http.MethodDelete, "/api/crews/"+mine+"/pins/"+bad, ""); status != http.StatusNotFound {
			t.Fatalf("unpinning %q: expected 404, got %d", bad, status)
		}
	}
}

func TestPinBoardIsBounded(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)
	for i := range protocol.MaxCrewPins {
		h.pin(t, "alice", crew, fmt.Sprintf("Pin %d", i), "something")
	}
	// The cap is counted and enforced in one statement, so a full board
	// refuses rather than growing — and it says what to do about it.
	status, out := h.call(t, "bob", http.MethodPost, "/api/crews/"+crew+"/pins",
		`{"title":"One too many","body":"x"}`)
	if status != http.StatusConflict {
		t.Fatalf("pin number %d: expected 409, got %d %v", protocol.MaxCrewPins+1, status, out)
	}
	if out["error"] != "conflict" {
		t.Fatalf("a full board is a conflict: %v", out)
	}
	if got := len(h.pins(t, "alice", crew)); got != protocol.MaxCrewPins {
		t.Fatalf("board grew past the cap: %d pins", got)
	}
}
