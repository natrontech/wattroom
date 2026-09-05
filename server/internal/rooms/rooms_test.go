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

	"github.com/jackc/pgx/v5/pgtype"

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

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.User(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *fakeUsers
	svc   *Service
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
	svc := New(st, users, slog.New(slog.DiscardHandler))
	svc.Register(mux)
	return &harness{mux: mux, store: st, users: users, svc: svc}
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

	// Moving the plan (#258): members cannot, the owner can, the past and
	// unknown ids bounce, and the room shows the new time.
	newStart := time.Now().Add(4 * time.Hour).UTC().Format(time.RFC3339)
	move := fmt.Sprintf(`{"startsAt":%q}`, newStart)
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID, move); status != http.StatusForbidden {
		t.Fatalf("member reschedule: %d", status)
	}
	if status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID,
		fmt.Sprintf(`{"startsAt":%q}`, time.Now().Add(-2*time.Hour).UTC().Format(time.RFC3339))); status != http.StatusBadRequest || body["field"] != "startsAt" {
		t.Fatalf("past reschedule: %d %v", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch,
		"/api/rooms/"+slug+"/schedule/00000000-0000-0000-0000-000000000000", move); status != http.StatusNotFound {
		t.Fatalf("unknown plan reschedule: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug+"/schedule/"+planID, move); status != http.StatusNoContent {
		t.Fatalf("reschedule: %d", status)
	}
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ = body["upcoming"].([]any)
	moved, _ := upcoming[0].(map[string]any)
	got, _ := time.Parse(time.RFC3339, fmt.Sprint(moved["startsAt"]))
	want, _ := time.Parse(time.RFC3339, newStart)
	if status != http.StatusOK || !got.Equal(want) {
		t.Fatalf("moved time not visible: %d got %v want %v", status, got, want)
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

func TestOwnedRoomsCap(t *testing.T) {
	h := setup(t)
	for i := range 3 {
		h.createRoom(t, "alice", fmt.Sprintf("Cap Room %d", i))
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms", `{"name":"One Too Many"}`)
	if status != http.StatusConflict || body["error"] != "conflict" {
		t.Fatalf("fourth room: %d %v", status, body)
	}
	// Deleting frees the slot (docs/SPEC.md), and the list carries the role
	// the frontend gates on.
	status, body = h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	roomsList, _ := body["rooms"].([]any)
	if status != http.StatusOK || len(roomsList) != 3 {
		t.Fatalf("list: %d %v", status, body)
	}
	first, _ := roomsList[0].(map[string]any)
	if first["role"] != "owner" {
		t.Fatalf("list entry missing role: %v", first)
	}
	// The frontend disables "Open room" on this number and phrases the hint
	// from it (#603) — without it the cap is a literal in two codebases.
	if owned, _ := body["maxOwned"].(float64); int(owned) != maxOwnedRooms {
		t.Fatalf("list missing the cap the frontend gates on: %v", body["maxOwned"])
	}
	slug, _ := first["slug"].(string)
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug, ""); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms", `{"name":"Slot Freed"}`); status != http.StatusCreated {
		t.Fatalf("after delete: %d", status)
	}
}

func TestBanFlow(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Ban Cave")
	for _, member := range []string{"bob", "carol"} {
		if status, _ := h.call(t, member, http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
			t.Fatalf("%s join: %d", member, status)
		}
	}
	bobID := store.UUIDString(h.users.byToken["bob"].ID)
	ban := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bobID)

	// Only the owner bans.
	if status, _ := h.call(t, "carol", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusForbidden {
		t.Errorf("member banned someone: %d", status)
	}
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}

	// The ban holds every door: rejoin by link, by code, and the WS/AV gate.
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rejoined by link: %d", status)
	}
	joinBody := fmt.Sprintf(`{"code":%q}`, code)
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/join", joinBody); status != http.StatusForbidden {
		t.Errorf("banned rejoined by code: %d", status)
	}
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	wsReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	wsReq.Header.Set("X-Test-User", "bob")
	if _, err := svc.Authorize(wsReq, slug); err == nil {
		t.Error("banned rider authorized for the room socket")
	}
	// Nor is "leaving" a way out (#637): the banned row is the ban, so the
	// self-removal path refuses, the row stays, and the rejoin stays shut.
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusForbidden {
		t.Errorf("banned rider left the room: %d", status)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if err := h.store.Queries.DeleteMembership(t.Context(), db.DeleteMembershipParams{
		RoomID: room.ID, UserID: h.users.byToken["bob"].ID,
	}); err != nil {
		t.Fatalf("delete membership: %v", err)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rider rejoined after leaving: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/"+bobID+"/rsvp", ""); status != http.StatusForbidden {
		t.Errorf("banned rider reached the RSVP gate: %d", status)
	}

	// The room vanishes from bob's nav, and bob gets the outsider view.
	if _, body := h.call(t, "bob", http.MethodGet, "/api/rooms", ""); body != nil {
		if roomsAny, _ := body["rooms"].([]any); len(roomsAny) != 0 {
			t.Errorf("banned rider still lists the room: %v", roomsAny)
		}
	}
	if _, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); body["role"] != nil || body["code"] != nil {
		t.Errorf("banned rider got the member view: %v", body)
	}

	// Members don't see the ban list; the owner does.
	countMembers := func(user string) (total, banned int) {
		_, body := h.call(t, user, http.MethodGet, "/api/rooms/"+slug, "")
		members, _ := body["members"].([]any)
		for _, m := range members {
			total++
			if row, ok := m.(map[string]any); ok && row["role"] == "banned" {
				banned++
			}
		}
		return total, banned
	}
	if total, banned := countMembers("carol"); total != 2 || banned != 0 {
		t.Errorf("member view of the roster: %d members, %d banned", total, banned)
	}
	if total, banned := countMembers("alice"); total != 3 || banned != 1 {
		t.Errorf("owner view of the roster: %d members, %d banned", total, banned)
	}

	// Unban restores a plain membership.
	unban := fmt.Sprintf(`{"userId":%q,"role":"member"}`, bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", unban); status != http.StatusNoContent {
		t.Fatalf("unban: %d", status)
	}
	if _, err := svc.Authorize(wsReq, slug); err != nil {
		t.Errorf("unbanned rider still refused: %v", err)
	}
}

func TestIconAndCheers(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Icon Cave")

	patch := func(body string) (int, map[string]any) {
		return h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug, body)
	}
	// Fresh room: no icon, base palette.
	if _, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, ""); body["icon"] != nil {
		t.Errorf("fresh room has an icon: %v", body["icon"])
	} else if cheers, _ := body["cheers"].([]any); len(cheers) != 6 {
		t.Errorf("fresh room palette: %v", body["cheers"])
	}

	// Icon: an icon key (#447) or none; junk refused; an emoji from before
	// #447 still lands so old rooms and clients keep working.
	if status, body := patch(`{"name":"Icon Cave","icon":"not an icon!"}`); status != http.StatusBadRequest {
		t.Errorf("junk icon accepted: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"<script>"}`); status != http.StatusBadRequest {
		t.Errorf("markup icon accepted: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"bike"}`); status != http.StatusOK || body["icon"] != "bike" {
		t.Errorf("key icon: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":"🦖"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("emoji icon (compat): %d %v", status, body)
	}
	// Absent field keeps it; empty clears it.
	if status, body := patch(`{"name":"Icon Cave"}`); status != http.StatusOK || body["icon"] != "🦖" {
		t.Errorf("absent icon did not keep: %d %v", status, body)
	}
	if status, body := patch(`{"name":"Icon Cave","icon":""}`); status != http.StatusOK || body["icon"] != nil {
		t.Errorf("empty icon did not clear: %d %v", status, body)
	}

	// Cheers: owner curates, dupes collapse, junk refused, cap enforced.
	if status, body := patch(`{"name":"Icon Cave","cheers":["heart","zap","heart"]}`); status != http.StatusOK {
		t.Fatalf("cheers: %d %v", status, body)
	} else if cheers, _ := body["cheers"].([]any); len(cheers) != 2 || cheers[0] != "heart" {
		t.Errorf("palette: %v", body["cheers"])
	}
	if status, body := patch(`{"name":"Icon Cave","cheers":["🦖","🌵"]}`); status != http.StatusOK {
		t.Errorf("emoji reactions (compat): %d %v", status, body)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["gg!"]}`); status != http.StatusBadRequest {
		t.Errorf("text reaction accepted: %d", status)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["Flame"]}`); status != http.StatusBadRequest {
		t.Errorf("uppercase reaction accepted: %d", status)
	}
	if status, _ := patch(`{"name":"Icon Cave","cheers":["flame","biceps-flexed","party-popper","skull","rocket","snowflake","heart","zap","trophy"]}`); status != http.StatusBadRequest {
		t.Errorf("nine reactions accepted: %d", status)
	}
	// Empty resets to the base set.
	if _, body := patch(`{"name":"Icon Cave","cheers":[]}`); true {
		if cheers, _ := body["cheers"].([]any); len(cheers) != 6 {
			t.Errorf("reset palette: %v", body["cheers"])
		}
	}
}

// A planned session with an RSVP is what #450 calls an event: any member can
// say they are in, the room shows who, and saying it twice says it once.
func TestSessionRsvp(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Event Room")
	if status, body := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("bob join: %d %v", status, body)
	}
	workout := `{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
	status, body := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule",
		fmt.Sprintf(`{"workoutName":"Openers","workoutJson":"%s","startsAt":%q}`,
			workout, time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)))
	if status != http.StatusCreated {
		t.Fatalf("schedule: %d %v", status, body)
	}
	planID, _ := body["id"].(string)
	rsvp := "/api/rooms/" + slug + "/schedule/" + planID + "/rsvp"

	// Signed out, a stranger, and an unknown plan all bounce.
	if status, _ := h.call(t, "", http.MethodPut, rsvp, ""); status != http.StatusUnauthorized {
		t.Fatalf("signed out rsvp: %d", status)
	}
	if status, _ := h.call(t, "carol", http.MethodPut, rsvp, ""); status != http.StatusForbidden {
		t.Fatalf("stranger rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut,
		"/api/rooms/"+slug+"/schedule/00000000-0000-0000-0000-000000000000/rsvp", ""); status != http.StatusNotFound {
		t.Fatalf("unknown plan rsvp: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/rooms/"+slug+"/schedule/not-a-uuid/rsvp", ""); status != http.StatusNotFound {
		t.Fatalf("malformed plan rsvp: %d", status)
	}

	// Bob is in, twice — and the room says so once.
	for range 2 {
		if status, _ := h.call(t, "bob", http.MethodPut, rsvp, ""); status != http.StatusNoContent {
			t.Fatalf("rsvp: %d", status)
		}
	}
	going := h.going(t, slug)
	if len(going) != 1 {
		t.Fatalf("going after rsvp: %v", going)
	}
	who, _ := going[0].(map[string]any)
	if who["id"] != h.userID(t, "bob") || who["displayName"] == "" {
		t.Fatalf("going names the wrong rider: %v", who)
	}

	// Taking it back empties the list; taking it back twice is not an error.
	for range 2 {
		if status, _ := h.call(t, "bob", http.MethodDelete, rsvp, ""); status != http.StatusNoContent {
			t.Fatalf("un-rsvp: %d", status)
		}
	}
	if going := h.going(t, slug); len(going) != 0 {
		t.Fatalf("going after cancel: %v", going)
	}
}

// going is the RSVP list on the room's one upcoming session.
func (h *harness) going(t *testing.T, slug string) []any {
	t.Helper()
	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	upcoming, _ := body["upcoming"].([]any)
	if status != http.StatusOK || len(upcoming) != 1 {
		t.Fatalf("upcoming: %d %v", status, body)
	}
	entry, _ := upcoming[0].(map[string]any)
	list, _ := entry["going"].([]any)
	return list
}

// The roster carries the level (#690): the room's faces wear the same ring the
// sidebar, the member list and DM heads already showed, and the strip's tiles
// have no other source for it. Authorize is where a socket's rider is built.
func TestAuthorizeCarriesTheRidersLevel(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Ring Room")
	if _, err := h.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
		UserID: h.users.byToken["alice"].ID,
		Source: "lounge",
		Amount: 240,
		Ref:    "roster-test",
		At:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("xp event: %v", err)
	}

	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	req.Header.Set("X-Test-User", "alice")
	rider, err := svc.Authorize(req, slug)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if rider.TotalXp != 240 {
		t.Fatalf("rider.TotalXp = %d, want 240 — the roster cannot ring without it", rider.TotalXp)
	}
}

// The room's member list carries each rider's earned badges (#703): the
// Members place is the one surface ADR-0027 lets a crew compare itself on, and
// it has no other source. Earned keys only — the achievements table holds
// nothing else, so there is no progress here to leak.
func TestMembersCarryEarnedBadges(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Badge Crew")
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/join",
		fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatal("bob could not join")
	}
	for _, key := range []string{"lounge-lizard", "dj"} {
		if _, err := h.store.Queries.AwardAchievement(t.Context(), db.AwardAchievementParams{
			UserID: h.users.byToken["bob"].ID, Key: key,
			EarnedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		}); err != nil {
			t.Fatalf("award %s: %v", key, err)
		}
	}

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	members, _ := body["members"].([]any)
	var seen []string
	for _, raw := range members {
		m, _ := raw.(map[string]any)
		if m["displayName"] != "bob" {
			// A rider with no badges carries none — omitempty, not an empty list.
			if _, present := m["badges"]; present {
				t.Fatalf("%v carries a badges field with nothing in it", m["displayName"])
			}
			continue
		}
		badges, ok := m["badges"].([]any)
		if !ok {
			t.Fatalf("bob carries no badges field: %v", m)
		}
		for _, b := range badges {
			key, ok := b.(string)
			if !ok {
				t.Fatalf("badge %v is not a key", b)
			}
			seen = append(seen, key)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("bob's badges = %v, want the two he earned", seen)
	}
}
