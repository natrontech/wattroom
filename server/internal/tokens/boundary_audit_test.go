package tokens

import (
	"net/http"
	"testing"
)

// errors.md's 404 for a bearer credential (#1415): a malformed id, and —
// the whole cross-account defence — another account's id.
func TestTokenDeleteIs404ForMalformedAndForeignIds(t *testing.T) {
	mux, _ := setup(t)
	code, body := call(t, mux, "alice", http.MethodPost, "/api/tokens", `{"name":"coach"}`)
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/not-a-uuid", ""); code != http.StatusNotFound {
		t.Errorf("malformed id: %d, want 404", code)
	}
	if code, _ := call(t, mux, "bob", http.MethodDelete, "/api/tokens/"+id, ""); code != http.StatusNotFound {
		t.Errorf("another account's token: %d, want 404", code)
	}
	// Alice's own still works, so the 404 above was scoping, not a bug.
	if code, _ := call(t, mux, "alice", http.MethodDelete, "/api/tokens/"+id, ""); code != http.StatusNoContent {
		t.Errorf("own token: %d, want 204", code)
	}
}
