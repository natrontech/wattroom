package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func putHomeCrew(t *testing.T, s *Service, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/me/home-crew", strings.NewReader(body))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleSetHomeCrew(w, req)
	return w
}

func getMe(t *testing.T, s *Service, cookie *http.Cookie) map[string]any {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.handleMe(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("me = %d: %s", w.Code, w.Body.String())
	}
	var me map[string]any
	if err := json.NewDecoder(w.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	return me
}

// crewOwnedBy founds a crew for the test, cleaned up before its owner is.
func crewOwnedBy(t *testing.T, s *Service, owner db.User, code string) db.Crew {
	t.Helper()
	crew, err := s.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Crew " + code, OwnerID: owner.ID, Code: &code})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})
	return crew
}

func TestSetHomeCrew(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	mine := crewOwnedBy(t, s, user, "HOMEC1")

	body := `{"crewId":"` + store.UUIDString(mine.ID) + `"}`
	if w := putHomeCrew(t, s, cookie, body); w.Code != http.StatusOK {
		t.Fatalf("put = %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := getMe(t, s, cookie)["homeCrewId"]; got != store.UUIDString(mine.ID) {
		t.Fatalf("homeCrewId = %v, want %s", got, store.UUIDString(mine.ID))
	}
}

func TestSetHomeCrewRefusesACrewYouAreNotIn(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	other, err := s.store.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "other", FtpWatts: 200, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from users where id = $1", other.ID)
	})
	theirs := crewOwnedBy(t, s, other, "HOMEC2")

	if w := putHomeCrew(t, s, cookie, `{"crewId":"`+store.UUIDString(theirs.ID)+`"}`); w.Code != http.StatusNotFound {
		t.Fatalf("not in it = %d, want 404: %s", w.Code, w.Body.String())
	}
	if w := putHomeCrew(t, s, cookie, `{"crewId":"not-a-uuid"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("junk = %d, want 400: %s", w.Code, w.Body.String())
	}
	if w := putHomeCrew(t, s, nil, `{"crewId":"`+store.UUIDString(theirs.ID)+`"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("signed out = %d, want 401", w.Code)
	}
	if _, has := getMe(t, s, cookie)["homeCrewId"]; has {
		t.Fatal("a refused pick landed on the account")
	}
}

// /api/me carries the invite the door remembered (#2144) until it is joined.
func TestMeCarriesThePendingInvite(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	other, err := s.store.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "host", FtpWatts: 200, WeightKg: 75})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from users where id = $1", other.ID)
	})
	theirs := crewOwnedBy(t, s, other, "HOMEC3")

	if _, has := getMe(t, s, cookie)["pendingInvite"]; has {
		t.Fatal("an invite before any door")
	}
	code := "HOMEC3"
	if err := s.store.Queries.SetPendingCrewCode(t.Context(), db.SetPendingCrewCodeParams{ID: user.ID, PendingCrewCode: &code}); err != nil {
		t.Fatal(err)
	}
	if got := getMe(t, s, cookie)["pendingInvite"]; got != code {
		t.Fatalf("pendingInvite = %v, want %s", got, code)
	}
	if err := s.store.Queries.JoinCrew(t.Context(), db.JoinCrewParams{CrewID: theirs.ID, UserID: user.ID}); err != nil {
		t.Fatal(err)
	}
	if got, has := getMe(t, s, cookie)["pendingInvite"]; has {
		t.Fatalf("joined, and still invited: %v", got)
	}
}
