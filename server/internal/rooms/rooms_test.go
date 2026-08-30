package rooms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeUsers resolves the X-Test-User header instead of a session cookie, so
// these tests exercise rooms, not auth — auth has its own suite.
type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *fakeUsers
}

func setup(t *testing.T) *harness {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "carol"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}

	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users}
}

// call runs one request as a user ("" = signed out) and decodes the JSON body.
func (h *harness) call(t *testing.T, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func (h *harness) createRoom(t *testing.T, owner, name string) (slug, code string) {
	t.Helper()
	status, body := h.call(t, owner, http.MethodPost, "/api/rooms", fmt.Sprintf(`{"name":%q}`, name))
	if status != http.StatusCreated {
		t.Fatalf("create room: %d %v", status, body)
	}
	slug, _ = body["slug"].(string)
	code, _ = body["code"].(string)
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where slug = $1", slug)
	})
	return slug, code
}

func TestCreateAndJoinFlow(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Velvet Hammer Test")

	if !strings.HasPrefix(slug, "velvet-hammer-test") {
		t.Errorf("slug %q does not come from the name", slug)
	}
	if len(code) != 6 {
		t.Errorf("code %q is not 6 chars", code)
	}

	// A signed-in stranger with the link sees the name but not the invite code
	// or the member list — enough to decide to join, nothing more.
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["code"] != nil || body["members"] != nil {
		t.Fatalf("stranger view leaked: %d %v", status, body)
	}

	// Join by code — lowercase with spaces, because it was read out loud.
	status, body = h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, "  "+strings.ToLower(code)+"  "))
	if status != http.StatusOK || body["slug"] != slug {
		t.Fatalf("join by code: %d %v", status, body)
	}

	// A member sees everything.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["code"] != code || body["role"] != "member" {
		t.Fatalf("member view: %d %v", status, body)
	}
	if members, _ := body["members"].([]any); len(members) != 2 {
		t.Fatalf("expected 2 members, got %v", body["members"])
	}
}

func TestRolesMatrix(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Matrix")
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("bob join: %d", status)
	}

	bobID := store.UUIDString(h.users.byToken["bob"].ID)
	roleBody := fmt.Sprintf(`{"userId":%q,"role":"coach"}`, bobID)

	// Member cannot edit the room or assign roles (SPEC matrix: owner-only).
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug, `{"name":"x","listed":true}`); status != http.StatusForbidden {
		t.Errorf("member edited the room: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/role", roleBody); status != http.StatusForbidden {
		t.Errorf("member assigned a role: %d", status)
	}

	// Owner promotes bob to coach.
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", roleBody); status != http.StatusNoContent {
		t.Errorf("owner could not promote: %d", status)
	}
	// Re-joining must not downgrade the coach back to member.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("re-join: %d", status)
	}
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if body["role"] != "coach" {
		t.Errorf("re-join downgraded coach to %v", body["role"])
	}

	// Coach still cannot do owner things.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, store.UUIDString(h.users.byToken["carol"].ID))); status != http.StatusForbidden {
		t.Errorf("coach assigned a role: %d", status)
	}
}

func TestLeaveAndRemove(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Leaving")
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("join: %d", status)
	}
	bobID := store.UUIDString(h.users.byToken["bob"].ID)
	aliceID := store.UUIDString(h.users.byToken["alice"].ID)

	// A member cannot remove someone else.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+aliceID, ""); status != http.StatusForbidden {
		t.Errorf("member removed another member: %d", status)
	}
	// Self-leave works.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusNoContent {
		t.Errorf("self-leave: %d", status)
	}
	// The owner cannot leave their own room.
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/members/"+aliceID, ""); status != http.StatusBadRequest {
		t.Errorf("owner left their own room: %d", status)
	}
}

func TestUnauthenticatedAndBadCode(t *testing.T) {
	h := setup(t)
	if status, _ := h.call(t, "", http.MethodPost, "/api/rooms", `{"name":"x"}`); status != http.StatusUnauthorized {
		t.Errorf("signed-out create: %d", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/join", `{"code":"XXXXXX"}`)
	if status != http.StatusNotFound || body["field"] != "code" {
		t.Errorf("bad code: %d %v", status, body)
	}
}

func TestSlugAndCodeHelpers(t *testing.T) {
	if got := slugify("Velvet Hammer!!"); got != "velvet-hammer" {
		t.Errorf("slugify: %q", got)
	}
	if got := slugify("???"); got != "room" {
		t.Errorf("slugify fallback: %q", got)
	}
	code := randomCode(6)
	for _, c := range code {
		if strings.ContainsRune("0O1IL", c) {
			t.Errorf("code %q contains a read-aloud-ambiguous character", code)
		}
	}
}

func TestUpdateSoundPackAndDelete(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Deletable")
	_ = code

	if status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("bob join: %d %v", status, body)
	}

	// Owner sets the pack; bad values bounce with the field named.
	status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":false,"soundPack":"silent"}`)
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("set pack: %d %v", status, body)
	}
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":false,"soundPack":"airhorn"}`)
	if status != http.StatusBadRequest || body["field"] != "soundPack" {
		t.Fatalf("bad pack: %d %v", status, body)
	}
	// A PATCH without the field (the drawer's listed toggle) keeps the pack.
	status, body = h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Deletable","listed":true}`)
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("patch keeps pack: %d %v", status, body)
	}
	// Members see it on GET.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["soundPack"] != "silent" {
		t.Fatalf("member sees pack: %d %v", status, body)
	}

	// Delete is owner-only.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusForbidden {
		t.Fatalf("member delete: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("owner delete: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); status != http.StatusNotFound {
		t.Fatalf("room gone: %d", status)
	}
}

func TestScheduleLifecycle(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Planners")
	if status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("bob join: %d %v", status, body)
	}

	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	starts := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	plan := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`, workout, starts)

	// A plain member cannot plan; the owner can.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan); status != http.StatusForbidden {
		t.Fatalf("member schedule: %d", status)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", plan)
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID, _ := body["id"].(string)

	// The past bounces with the field named.
	past := fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
		workout, time.Now().Add(-2*time.Hour).UTC().Format(time.RFC3339))
	if status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", past); status != http.StatusBadRequest || body["field"] != "startsAt" {
		t.Fatalf("past plan: %d %v", status, body)
	}

	// Members see it on the room; a coach (promoted bob) can remove it.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := body["upcoming"].([]any)
	if status != http.StatusOK || len(upcoming) != 1 {
		t.Fatalf("upcoming: %d %v", status, body)
	}
	// The rooms list shows the next session.
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms", "")
	roomsList, _ := body["rooms"].([]any)
	found := false
	for _, entry := range roomsList {
		m, _ := entry.(map[string]any)
		if m["slug"] == slug {
			next, _ := m["nextSession"].(map[string]any)
			found = next["workoutName"] == "Openers"
		}
	}
	if status != http.StatusOK || !found {
		t.Fatalf("nextSession missing: %d %v", status, body)
	}

	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role",
		fmt.Sprintf(`{"userId":%q,"role":"coach"}`, h.userID(t, "bob"))); status != http.StatusNoContent {
		t.Fatalf("promote bob: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+planID, ""); status != http.StatusNoContent {
		t.Fatalf("coach unschedule: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+planID, ""); status != http.StatusNotFound {
		t.Fatalf("double unschedule: %d", status)
	}
}

func (h *harness) userID(t *testing.T, name string) string {
	t.Helper()
	return store.UUIDString(h.users.byToken[name].ID)
}
