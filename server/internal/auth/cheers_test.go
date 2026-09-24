package auth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func putCheers(t *testing.T, s *Service, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/me/cheers", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleSetCheers(w, req)
	return w
}

// The reaction set is the rider's own (#2722): what they pick is what /api/me
// reads back, in every crew and DM alike.
func TestSetCheers(t *testing.T) {
	s := testService(t)
	cookie := signedIn(t, s, testUser(t, s))
	cheers := func() string {
		t.Helper()
		list, _ := getMe(t, s, cookie)["cheers"].([]any)
		words := make([]string, 0, len(list))
		for _, c := range list {
			word, _ := c.(string)
			words = append(words, word)
		}
		return strings.Join(words, " ")
	}

	if got := cheers(); got != strings.Join(baseCheers, " ") {
		t.Fatalf("a new rider reacts with %q, want the base set", got)
	}
	for _, tc := range []struct {
		name, body string
		status     int
		want       string
	}{
		{"not an icon", `{"cheers":["<b>"]}`, http.StatusBadRequest, ""},
		{"text is not a reaction", `{"cheers":["gg!"]}`, http.StatusBadRequest, ""},
		{"a key is lowercase", `{"cheers":["Flame"]}`, http.StatusBadRequest, ""},
		{"too many", fmt.Sprintf(`{"cheers":[%s]}`,
			strings.TrimSuffix(strings.Repeat(`"flame",`, protocol.MaxCheers+1), ",")), http.StatusBadRequest, ""},
		// A crew's own emoji means something in one crew only, and the set
		// goes everywhere the rider does.
		{"not a crew's own emoji", `{"cheers":[":party_parrot:"]}`, http.StatusBadRequest, ""},
		{"any emoji and a keycap", `{"cheers":["🦖","1️⃣"]}`, http.StatusOK, "🦖 1️⃣"},
		{"a pick, deduplicated", `{"cheers":["rocket","flame","rocket"]}`, http.StatusOK, "rocket flame"},
		{"empty is the base set", `{"cheers":[]}`, http.StatusOK, strings.Join(baseCheers, " ")},
		{"unreadable", `{"cheers":"flame"}`, http.StatusBadRequest, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := putCheers(t, s, cookie, tc.body); w.Code != tc.status {
				t.Fatalf("%d %s, want %d", w.Code, w.Body.String(), tc.status)
			}
			if tc.want != "" {
				if got := cheers(); got != tc.want {
					t.Fatalf("reacts with %q, want %q", got, tc.want)
				}
			}
		})
	}

	if w := putCheers(t, s, nil, `{"cheers":["flame"]}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out = %d, want 401", w.Code)
	}
}
