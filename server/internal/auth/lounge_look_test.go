package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func putLoungeLook(t *testing.T, s *Service, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/me/lounge-look", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleSetLoungeLook(w, req)
	return w
}

func TestSetLoungeLook(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)

	for _, tc := range []struct{ name, body string }{
		{"upper case", `{"look":"3A21"}`},
		{"a space", `{"look":"3a 21"}`},
		{"too long", `{"look":"` + strings.Repeat("a", 17) + `"}`},
		{"markup", `{"look":"<b>"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := putLoungeLook(t, s, cookie, tc.body)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"field":"look"`) {
				t.Fatalf("%d %s, want 400 naming look", w.Code, w.Body.String())
			}
		})
	}
	if w := putLoungeLook(t, s, cookie, `{"look":1}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unreadable = %d, want 400", w.Code)
	}
	if w := putLoungeLook(t, s, nil, `{"look":"3a"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out = %d, want 401", w.Code)
	}

	if w := putLoungeLook(t, s, cookie, `{"look":"3a21070325"}`); w.Code != http.StatusOK {
		t.Fatalf("save = %d %s", w.Code, w.Body.String())
	}
	if got := getMe(t, s, signedIn(t, s, user))["loungeLook"]; got != "3a21070325" {
		t.Fatalf("a second session reads %v", got)
	}
	if w := putLoungeLook(t, s, cookie, `{"look":""}`); w.Code != http.StatusOK {
		t.Fatalf("clear = %d %s", w.Code, w.Body.String())
	}
	if got, held := getMe(t, s, cookie)["loungeLook"]; held {
		t.Fatalf("a cleared look still reads %v", got)
	}
}
