package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A display name is counted in characters, not bytes, and trimmed (audit
// 2026-09-09): a 21-letter Cyrillic name was refused as "over 60", and " "
// was a valid name that rendered as a blank tile everywhere.
func TestDisplayNameCountsRunesAndTrims(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}
	cookie := rec.Result().Cookies()[0]
	patch := func(name string) int {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me",
			strings.NewReader(`{"displayName":`+name+`,"ftpWatts":250,"weightKg":80}`))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.handleUpdateMe(w, req)
		return w.Code
	}
	if code := patch(`"Александра Петровна-Ш"`); code != http.StatusOK {
		t.Errorf("a 21-character Cyrillic name: %d, want 200", code)
	}
	if code := patch(`"   "`); code != http.StatusBadRequest {
		t.Errorf("a name of spaces: %d, want 400", code)
	}
	if code := patch(`"` + strings.Repeat("ä", 61) + `"`); code != http.StatusBadRequest {
		t.Errorf("61 characters: %d, want 400", code)
	}
	if code := patch(`"  Jan  "`); code != http.StatusOK {
		t.Errorf("a padded name: %d, want 200 (trimmed)", code)
	}
	u, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil || u.DisplayName != "Jan" {
		t.Errorf("stored name %q, want it trimmed to Jan (%v)", u.DisplayName, err)
	}
}
