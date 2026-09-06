package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func putTimezone(t *testing.T, s *Service, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/me/timezone", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleUpdateTimezone(w, req)
	return w
}

func TestUpdateTimezone(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)

	if w := putTimezone(t, s, cookie, `{"timezone":"Europe/Zurich"}`); w.Code != http.StatusNoContent {
		t.Fatalf("put = %d, want 204: %s", w.Code, w.Body.String())
	}
	stored, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if stored.Timezone == nil || *stored.Timezone != "Europe/Zurich" {
		t.Fatalf("stored %v, want Europe/Zurich", stored.Timezone)
	}

	// A rider who moves overwrites it — reporting on every load is the whole
	// mechanism, so a second write has to be ordinary.
	if w := putTimezone(t, s, cookie, `{"timezone":"America/New_York"}`); w.Code != http.StatusNoContent {
		t.Fatalf("second put = %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateTimezoneRefusesJunk(t *testing.T) {
	s := testService(t)
	cookie := signedIn(t, s, testUser(t, s))

	for _, body := range []string{
		`{"timezone":"Nowhere/Atlantis"}`,
		`{"timezone":""}`,
		`{"timezone":"` + strings.Repeat("x", maxTimezoneName+1) + `"}`,
		// A path is the shape that would matter: LoadLocation reads the
		// embedded database by name, so a name is all it may ever be handed.
		`{"timezone":"../../etc/passwd"}`,
	} {
		w := putTimezone(t, s, cookie, body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400: %s", body, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), `"field":"timezone"`) {
			t.Fatalf("%s did not name the field: %s", body, w.Body.String())
		}
	}
}

func TestUpdateTimezoneNeedsAuth(t *testing.T) {
	s := testService(t)
	if w := putTimezone(t, s, nil, `{"timezone":"Europe/Zurich"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out = %d, want 401", w.Code)
	}
}
