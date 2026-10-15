package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

func putFigure(t *testing.T, s *Service, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/me/figure", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleSetFigure(w, req)
	return w
}

func TestSetFigure(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)

	me := getMe(t, s, cookie)
	if me["figureAsked"] != false {
		t.Fatalf("a new rider has been asked: %v", me["figureAsked"])
	}

	for _, tc := range []struct{ name, body, field string }{
		{"unknown build", `{"build":"huge"}`, "build"},
		{"too short", `{"heightCm":149}`, "heightCm"},
		{"too tall", `{"heightCm":206}`, "heightCm"},
		{"no such swatch", `{"skin":8}`, "skin"},
		{"negative swatch", `{"skin":-1}`, "skin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := putFigure(t, s, cookie, tc.body)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"field":"`+tc.field+`"`) {
				t.Fatalf("%d %s, want 400 naming %s", w.Code, w.Body.String(), tc.field)
			}
		})
	}
	if getMe(t, s, cookie)["figureAsked"] != false {
		t.Fatal("a refused save counted as the answer")
	}
	if w := putFigure(t, s, cookie, `{"build":"slim"`); w.Code != http.StatusBadRequest {
		t.Fatalf("unreadable = %d, want 400", w.Code)
	}
	if w := putFigure(t, s, nil, `{}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out = %d, want 401", w.Code)
	}

	if w := putFigure(t, s, cookie, `{"build":"strong","heightCm":190,"skin":3}`); w.Code != http.StatusOK {
		t.Fatalf("save = %d %s", w.Code, w.Body.String())
	}
	me = getMe(t, s, signedIn(t, s, user)) // a second session, a second device
	fig, _ := me["figure"].(map[string]any)
	if me["figureAsked"] != true || fig["build"] != "strong" || fig["heightCm"] != 190.0 || fig["skin"] != 3.0 {
		t.Fatalf("second session reads %v asked=%v", fig, me["figureAsked"])
	}
}

// A skip is an empty answer: asked for good, figure left neutral, and a
// second session never gets the card back.
func TestBodylessFigureIsASkip(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	if w := putFigure(t, s, cookie, ``); w.Code != http.StatusOK {
		t.Fatalf("no body = %d %s, want a skip", w.Code, w.Body.String())
	}
	if getMe(t, s, cookie)["figureAsked"] != true {
		t.Fatal("a body-less skip left the card unanswered")
	}
}

func TestSkippedFigureIsAskedForGood(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	if w := putFigure(t, s, signedIn(t, s, user), `{}`); w.Code != http.StatusOK {
		t.Fatalf("skip = %d %s", w.Code, w.Body.String())
	}
	me := getMe(t, s, signedIn(t, s, user))
	fig, _ := me["figure"].(map[string]any)
	if me["figureAsked"] != true || fig["build"] != nil || fig["heightCm"] != nil || fig["skin"] != nil {
		t.Fatalf("a skip left %v asked=%v, want neutral and asked", fig, me["figureAsked"])
	}
}

// ADR-0048: a figure is chosen, never derived from weight.
func TestFigureIgnoresWeight(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	for _, kg := range []int16{45, 75, 130} {
		if _, err := s.store.Queries.UpdateUserProfile(t.Context(), db.UpdateUserProfileParams{
			ID: user.ID, DisplayName: "auth-test", FtpWatts: 200, WeightKg: kg,
		}); err != nil {
			t.Fatal(err)
		}
		fig, _ := getMe(t, s, cookie)["figure"].(map[string]any)
		if fig["build"] != nil || fig["heightCm"] != nil || fig["skin"] != nil {
			t.Fatalf("at %d kg the figure reads %v, want neutral", kg, fig)
		}
	}
}
