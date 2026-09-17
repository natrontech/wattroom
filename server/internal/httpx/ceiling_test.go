package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// docs/SPEC.md:79-81: "A ceiling is refused with 429 rate_limited … and the
// message names the number and the remedy — never a wait, because a ceiling
// does not clear on its own." The code had three answers for that one rule
// (#2244): a 429, a 409, and a 400 validation_error on a well-formed upload.
// One helper, so a client can branch on "you hit a ceiling" — which it could
// not while the status was whichever the handler felt like.
func TestWriteCeilingIsAlwaysA429(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteCeiling(rec, "You already own 3 rooms — delete one to open another.")

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429", rec.Code)
	}
	var body ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("not errors.md's shape: %v: %s", err, rec.Body)
	}
	if body.Error != "rate_limited" {
		t.Errorf("code %q, want rate_limited", body.Error)
	}
	// The handler's message travels whole: it is the only place the number
	// and the way out can be said.
	if body.Message != "You already own 3 rooms — delete one to open another." {
		t.Errorf("message = %q", body.Message)
	}
	if body.Field != "" {
		t.Errorf("a ceiling is not a field's fault: %q", body.Field)
	}
}
