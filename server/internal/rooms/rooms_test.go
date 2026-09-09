package rooms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
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
	st := storetest.Open(t)

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
			// Rooms and crews first: crews.owner_id is ON DELETE RESTRICT, so
			// a user who made a room through the API owns a crew and cannot
			// go until it does (ADR-0038).
			_, _ = st.Pool.Exec(context.Background(), "delete from rooms where owner_id = $1", u.ID)
			_, _ = st.Pool.Exec(context.Background(), "delete from crews where owner_id = $1", u.ID)
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
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where slug = $1", slug)
	})
	// The code a test hands round is the CREW's (#1236): the room's opens
	// nothing any more.
	return slug, codeOf(h.crewOf(t, slug).Code)
}

func TestCreateAndJoinFlow(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Velvet Hammer Test")

	if !strings.HasPrefix(slug, "velvet-hammer-test-") {
		t.Errorf("slug %q does not come from the name plus a random suffix", slug)
	}
	if len(code) != 6 {
		t.Errorf("code %q is not 6 chars", code)
	}

	// A signed-in stranger with the link sees the name but not the invite code
	// or the member list — enough to decide to join, nothing more. The door
	// tells them it is shut, and that they are not in the crew (#1236).
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["code"] != nil || body["members"] != nil {
		t.Fatalf("stranger view leaked: %d %v", status, body)
	}
	if body["canEnter"] != nil || body["inCrew"] != nil {
		t.Errorf("a stranger's door says canEnter=%v inCrew=%v, want neither", body["canEnter"], body["inCrew"])
	}

	// The stranger may not walk in: the room's crew is not theirs (#1236).
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Fatalf("a stranger walked into a room by its address: %d", status)
	}
	// Join the crew by code — lowercase with spaces, because it was read out
	// loud — then walk into the room, which is open to the crew.
	status, body = h.call(t, "bob", http.MethodPost, "/api/crews/join",
		fmt.Sprintf(`{"code":%q}`, "  "+strings.ToLower(code)+"  "))
	if status != http.StatusOK || body["name"] == nil {
		t.Fatalf("join crew by code: %d %v", status, body)
	}
	// In the crew and at an open room's door: it opens.
	if _, door := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, ""); door["canEnter"] != true || door["inCrew"] != true {
		t.Errorf("a crew member's door says canEnter=%v inCrew=%v, want both", door["canEnter"], door["inCrew"])
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusNoContent {
		t.Fatalf("a crew member could not walk in: %d", status)
	}

	// A member sees everything — including the crew's code on the room, which
	// is what the TV shows when the lounge is idle (#1236).
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK || body["role"] != "member" {
		t.Fatalf("member view: %d %v", status, body)
	}
	if c, _ := body["crew"].(map[string]any); c["code"] != code {
		t.Errorf("the room's crew does not carry the crew's code for members: %v", body["crew"])
	}
	if members, _ := body["members"].([]any); len(members) != 2 {
		t.Fatalf("expected 2 members, got %v", body["members"])
	}
}

func TestRolesMatrix(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Matrix")
	h.join(t, "bob", slug)

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
	h.join(t, "bob", slug)
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
	h.join(t, "bob", slug)
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
	status, body := h.call(t, "alice", http.MethodPost, "/api/crews/join", `{"code":"XXXXXX"}`)
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

// TestSlugSuffixUnguessable covers #694: a room's slug is not just its name,
// so two rooms sharing a name land on different, unguessable URLs, and
// renaming never regenerates or drops the suffix a shared link depends on.
func TestSlugSuffixUnguessable(t *testing.T) {
	h := setup(t)
	slugA, _ := h.createRoom(t, "alice", "Thursday Crew")
	slugB, _ := h.createRoom(t, "bob", "Thursday Crew")

	if slugA == slugB {
		t.Fatalf("two rooms with the same name got the same slug: %q", slugA)
	}
	const prefix = "thursday-crew-"
	if !strings.HasPrefix(slugA, prefix) || !strings.HasPrefix(slugB, prefix) {
		t.Fatalf("slugs missing the name prefix: %q, %q", slugA, slugB)
	}
	suffixA := strings.TrimPrefix(slugA, prefix)
	suffixB := strings.TrimPrefix(slugB, prefix)
	if suffixA == "" || suffixB == "" || suffixA == suffixB {
		t.Fatalf("suffixes are not distinct random strings: %q, %q", suffixA, suffixB)
	}

	// Renaming the room must not touch the slug — the suffix (and the whole
	// slug) is fixed at creation so a shared link keeps working.
	status, body := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slugA,
		`{"name":"Friday Crew","listed":false}`)
	if status != http.StatusOK {
		t.Fatalf("rename: %d %v", status, body)
	}
	if got := body["slug"]; got != slugA {
		t.Fatalf("rename changed the slug: %q -> %v", slugA, got)
	}
	status, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slugA, "")
	if status != http.StatusOK || body["name"] != "Friday Crew" {
		t.Fatalf("renamed room not reachable at its old slug: %d %v", status, body)
	}
}

func TestUpdateSoundPackAndDelete(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Deletable")
	_ = code

	h.enter(t, "bob", code, slug)

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
	h.enter(t, "bob", code, slug)

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
		h.join(t, member, slug)
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
	// A room ban is not a crew ban: the crew's door still answers, the
	// room's does not (ADR-0038, third amendment; #1236).
	joinBody := fmt.Sprintf(`{"code":%q}`, code)
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/crews/join", joinBody); status != http.StatusOK {
		t.Errorf("a room ban shut the crew's door: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPost, "/api/rooms/"+slug+"/join", ""); status != http.StatusForbidden {
		t.Errorf("banned rejoined after re-entering the crew: %d", status)
	}
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	wsReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	wsReq.Header.Set("X-Test-User", "bob")
	if _, _, err := svc.Authorize(wsReq, slug); err == nil {
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
	if _, err := h.store.Queries.DeleteMembership(t.Context(), db.DeleteMembershipParams{
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
	if _, _, err := svc.Authorize(wsReq, slug); err != nil {
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
	h.enter(t, "bob", code, slug)
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
	rider, _, err := svc.Authorize(req, slug)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if rider.TotalXp != 240 {
		t.Fatalf("rider.TotalXp = %d, want 240 — the roster cannot ring without it", rider.TotalXp)
	}
}

// Authorize hands back the room's canonical slug, whatever casing the link
// carried (#639): the hub and the AV token key live state on that, so a
// mixed-case link cannot fork a second live room.
func TestAuthorizeReturnsTheCanonicalSlug(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Velvet Crew")
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	shouted := strings.ToUpper(slug)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+shouted, nil)
	req.Header.Set("X-Test-User", "alice")
	_, canonical, err := svc.Authorize(req, shouted)
	if err != nil {
		t.Fatalf("authorize %q: %v", shouted, err)
	}
	if canonical != slug {
		t.Fatalf("canonical slug = %q, want %q", canonical, slug)
	}
}

// The room's member list carries each rider's earned badges (#703): the
// Members place is the one surface ADR-0027 lets a crew compare itself on, and
// it has no other source. Earned keys only — the achievements table holds
// nothing else, so there is no progress here to leak.
func TestMembersCarryEarnedBadges(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Badge Crew")
	h.enter(t, "bob", code, slug)
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

// fakePresence is one canned answer for every room — enough to drive the
// unread badge, which is the only thing on this path that reads presence.
type fakePresence struct{ p protocol.RoomPresence }

func (f fakePresence) Presence(string) protocol.RoomPresence { return f.p }
func (f fakePresence) Kick(string, string)                   {}
func (f fakePresence) SetRole(string, string, string)        {}
func (f fakePresence) SessionAnnounce(string, string, string, string, time.Time) {
}
func (f fakePresence) PresenceChanged() {}
func (f fakePresence) CloseRoom(string) {}

func TestUnreadBadgeSurvivesANamesake(t *testing.T) {
	// #649: standing in a room is reading it, so the badge is suppressed for
	// whoever is in there. That test used to be by display name, which
	// nothing makes unique: a second rider called "alice" standing in the
	// room silenced the real alice's badge, and the sidebar read as broken.
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "MFW 5")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room by slug: %v", err)
	}
	if _, err := h.store.Queries.SaveChatMessage(t.Context(), db.SaveChatMessageParams{
		RoomID: room.ID, UserID: h.users.byToken["bob"].ID, Text: "anyone riding tonight?",
	}); err != nil {
		t.Fatalf("save chat: %v", err)
	}

	unreadFor := func(t *testing.T, present protocol.RoomPresence) float64 {
		t.Helper()
		h.svc.SetPresence(fakePresence{p: present})
		status, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
		if status != http.StatusOK {
			t.Fatalf("list rooms: %d %v", status, body)
		}
		list, _ := body["rooms"].([]any)
		if len(list) != 1 {
			t.Fatalf("want one room, got %v", body["rooms"])
		}
		entry, _ := list[0].(map[string]any)
		n, _ := entry["unread"].(float64)
		return n
	}

	// A namesake in the room, and alice herself nowhere near it.
	namesake := store.UUIDString(h.users.byToken["bob"].ID)
	if n := unreadFor(t, protocol.RoomPresence{Riders: []string{"alice"}, RiderIDs: []string{namesake}}); n != 1 {
		t.Errorf("a namesake silenced the badge: unread = %v, want 1", n)
	}
	// Alice herself, standing in it: the badge is hers to lose.
	alice := store.UUIDString(h.users.byToken["alice"].ID)
	if n := unreadFor(t, protocol.RoomPresence{Riders: []string{"alice"}, RiderIDs: []string{alice}}); n != 0 {
		t.Errorf("alice is standing in the room: unread = %v, want 0", n)
	}
}

// #890 folded four per-room queries into ListUserRooms, two of them as LEFT
// LATERAL joins. A room with nothing planned and nothing said yields NULL for
// both, and sqlc reads their text columns as non-null from the schema — so
// without the coalesce in the query this scan fails and the whole rail 500s
// on the most ordinary room there is: a brand new one.
func TestRoomsListHandlesARoomWithNoPlanAndNoChat(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Fresh Air")

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	if status != http.StatusOK {
		t.Fatalf("list rooms: %d %v", status, body)
	}
	list, _ := body["rooms"].([]any)
	if len(list) != 1 {
		t.Fatalf("want one room, got %v", body["rooms"])
	}
	entry, _ := list[0].(map[string]any)
	if entry["slug"] != slug {
		t.Fatalf("slug = %v, want %q", entry["slug"], slug)
	}
	// Absent, not an empty husk: the frontend renders on presence of the key.
	if next, ok := entry["nextSession"]; ok && next != nil {
		t.Errorf("nextSession = %v, want absent for a room with no plan", next)
	}
	if last, ok := entry["lastChat"]; ok && last != nil {
		t.Errorf("lastChat = %v, want absent for a room nobody has spoken in", last)
	}
	// The owner still counts, and the count comes from the same single query.
	if n, _ := entry["memberCount"].(float64); n != 1 {
		t.Errorf("memberCount = %v, want 1", n)
	}
}

// roomRide writes one summary row into a room, back-dated, so the crew tiles
// have sessions to count. Distinct days are what a session is (#995).
func (h *harness) roomRide(t *testing.T, user string, room pgtype.UUID, at time.Time, seconds int32) {
	t.Helper()
	if _, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.users.byToken[user].ID, RoomID: room, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: at, Valid: true},
		Seconds:   seconds, AvgWatts: 200, Kj: 500, Execution: 0.9, FtpWatts: 200,
		Samples: []byte("bytes"), Xp: 10,
	}); err != nil {
		t.Fatalf("create ride: %v", err)
	}
}

func TestTogetherStatsAreCooperativeAndOwn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Crew Stats Test")
	h.enter(t, "bob", code, slug)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}

	now := time.Now()
	// Two riders in one session is ONE session, and both their seconds count.
	h.roomRide(t, "alice", room.ID, now.Add(-2*time.Hour), 1800)
	h.roomRide(t, "bob", room.ID, now.Add(-2*time.Hour), 1200)
	// A second session this month, alice only.
	h.roomRide(t, "alice", room.ID, now.AddDate(0, 0, -3), 600)
	// And one last month, so the month-on-month figure has something behind it.
	h.roomRide(t, "bob", room.ID, now.AddDate(0, -1, 0).AddDate(0, 0, -1), 900)

	status, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("get room: %d", status)
	}
	together, ok := body["together"].(map[string]any)
	if !ok {
		t.Fatalf("no together stats: %v", body)
	}
	number := func(field string) float64 {
		t.Helper()
		got, ok := together[field].(float64)
		if !ok {
			t.Fatalf("together.%s is %T, not a number: %v", field, together[field], together)
		}
		return got
	}
	if got := number("seconds"); got != 4500 {
		t.Errorf("seconds together = %v, want 4500 (everyone's, summed)", got)
	}
	// Three rides across two days this month, not three sessions.
	if got := number("sessionsThisMonth"); got != 2 {
		t.Errorf("sessions this month = %v, want 2", got)
	}
	if got := number("sessionsLastMonth"); got != 1 {
		t.Errorf("sessions last month = %v, want 1", got)
	}

	// The strip is the CALLER's own turnout. Bob missed the middle session and
	// alice missed last month's, and each of them sees only their own record.
	attended := func(who string) []bool {
		t.Helper()
		_, body := h.call(t, who, http.MethodGet, "/api/rooms/"+slug, "")
		stats, ok := body["together"].(map[string]any)
		if !ok {
			t.Fatalf("%s sees no together stats: %v", who, body)
		}
		raw, ok := stats["attended"].([]any)
		if !ok {
			t.Fatalf("%s: attended is %T: %v", who, stats["attended"], stats)
		}
		out := make([]bool, len(raw))
		for i, v := range raw {
			here, ok := v.(bool)
			if !ok {
				t.Fatalf("%s: attended[%d] is %T", who, i, v)
			}
			out[i] = here
		}
		return out
	}
	// Oldest first: last month, three days ago, today.
	if got := attended("alice"); len(got) != 3 || got[0] || !got[1] || !got[2] {
		t.Errorf("alice attended = %v, want [false true true]", got)
	}
	if got := attended("bob"); len(got) != 3 || !got[0] || got[1] || !got[2] {
		t.Errorf("bob attended = %v, want [true false true]", got)
	}
}

// Renamed with the field (#1178): what a room did together is `together` now,
// because ADR-0038 took `crew` for the layer above a room. The assertion is
// unchanged — only the key it reads, which is what following a rename means.
func TestTogetherStatsAreMembersOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Together Privacy Test")
	if _, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, ""); body["together"] != nil {
		t.Errorf("a non-member can see what the room did together: %v", body["together"])
	}
	if _, body := h.call(t, "", http.MethodGet, "/api/rooms/"+slug, ""); body["together"] != nil {
		t.Errorf("a signed-out visitor can see what the room did together: %v", body["together"])
	}
}

// The crew rides the room payload so the sidebar can group by it without a
// second request (#1178). Members only, on the same rule as the join code:
// someone outside the room may be outside its crew, and the crew's name is
// then not theirs to read.
func TestTheCrewIsOnTheRoomAndMembersOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Field Test")
	h.putInCrew(t, slug, "Natron")

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	crew, _ := body["crew"].(map[string]any)
	if crew == nil {
		t.Fatalf("a member cannot see the room's crew: %v", body["crew"])
	}
	if crew["name"] != "Natron" {
		t.Errorf("crew name = %v, want Natron", crew["name"])
	}
	if crew["id"] == nil || crew["id"] == "" {
		t.Error("the crew has no id, so a sidebar cannot group by it")
	}

	for _, who := range []struct{ name, as string }{
		{"a non-member", "carol"}, {"a signed-out visitor", ""},
	} {
		if _, body := h.call(t, who.as, http.MethodGet, "/api/rooms/"+slug, ""); body["crew"] != nil {
			t.Errorf("%s can see the room's crew: %v", who.name, body["crew"])
		}
	}
}

// The list is what the sidebar actually reads, and it carries the crew from a
// join rather than a lookup per room — this query's own comment is about the
// 1+4N round trips it already replaced once.
func TestTheRoomListCarriesTheCrew(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew List Test")
	h.putInCrew(t, slug, "Natron")

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms", "")
	rooms, _ := body["rooms"].([]any)
	for _, entry := range rooms {
		room, _ := entry.(map[string]any)
		if room["slug"] != slug {
			continue
		}
		crew, _ := room["crew"].(map[string]any)
		if crew == nil || crew["name"] != "Natron" {
			t.Fatalf("the room list does not name the room's crew: %v", room["crew"])
		}
		return
	}
	t.Fatal("the room is missing from its owner's list")
}

func TestBoardIsOffUntilTheRoomTurnsItOn(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Board Opt In Test")
	h.enter(t, "bob", code, slug)
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	h.roomRide(t, "alice", room.ID, time.Now(), 3600)
	h.roomRide(t, "bob", room.ID, time.Now(), 1800)

	// Being in a room does not put you on a board (ADR-0036).
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if body["board"] != nil {
		t.Fatalf("a board appeared without anyone enabling it: %v", body["board"])
	}
	if enabled, _ := body["boardEnabled"].(bool); enabled {
		t.Fatalf("boardEnabled is true on a fresh room")
	}

	// A member cannot switch it on; room settings are the owner's (SPEC matrix).
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Opt In Test","listed":false,"boardEnabled":true}`); status != http.StatusForbidden {
		t.Errorf("a member turned the board on: %d", status)
	}

	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Opt In Test","listed":false,"boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("owner could not enable the board: %d", status)
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	board, ok := body["board"].([]any)
	if !ok || len(board) != 2 {
		t.Fatalf("board = %v, want two riders", body["board"])
	}
	// Ordered by the week's work, and carrying the bracket, not just a rank.
	first, _ := board[0].(map[string]any)
	if first["displayName"] != "alice" {
		t.Errorf("board leader = %v, want alice (more kJ)", first["displayName"])
	}
	if first["category"] == nil || first["category"] == "" {
		t.Errorf("board row carries no category: %v", first)
	}

	// And a rename must not silently switch it back off.
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Renamed","listed":false}`); status != http.StatusOK {
		t.Fatalf("rename")
	}
	_, body = h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if enabled, _ := body["boardEnabled"].(bool); !enabled {
		t.Errorf("a rename turned the board off")
	}
}

func TestBoardIsThisWeekOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Board Week Test")
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Board Week Test","listed":false,"boardEnabled":true}`); status != http.StatusOK {
		t.Fatalf("enable board")
	}
	// Two weeks ago: a bad week is never permanent, so it must not be counted.
	h.roomRide(t, "alice", room.ID, time.Now().AddDate(0, 0, -14), 3600)

	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	if body["board"] != nil {
		t.Errorf("last fortnight's ride is on this week's board: %v", body["board"])
	}
}

// The member settings page renders the room's join code (#1099), so the read
// that feeds it must never hand the code to somebody outside the room. This
// is the acceptance box with teeth: the page cannot leak what the API does
// not give it, and it cannot help if the API does.
func TestOnlyMembersReadTheRoomsCode(t *testing.T) {
	h := setup(t)
	slug, code := h.createRoom(t, "alice", "Code Guarded")
	if code == "" {
		t.Fatal("no code to guard")
	}

	// A member gets everything the settings page shows — the pack, the
	// reaction set and the roster — and, on the crew, the code they are meant
	// to share (#1236: the invite is the crew's).
	h.join(t, "bob", slug)
	status, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status != http.StatusOK {
		t.Fatalf("member read: %d", status)
	}
	if _, crewBody := h.call(t, "bob", http.MethodGet, "/api/crews/"+store.UUIDString(h.crewOf(t, slug).ID), ""); crewBody["code"] != code {
		t.Errorf("a crew member cannot see the code they are meant to share: %v", crewBody["code"])
	}
	if body["members"] == nil {
		t.Error("a member got no roster, so the page cannot say who owns the room")
	}

	// Carol never joined. She may learn the room exists — the slug is a URL —
	// but not the thing that gets her in.
	status, body = h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	if status == http.StatusOK {
		if body["code"] != nil {
			t.Errorf("a non-member read the join code: %v", body["code"])
		}
		if body["soundPack"] != nil || body["cheers"] != nil || body["icsToken"] != nil {
			t.Errorf("a non-member read members-only settings: %v", body)
		}
		if body["members"] != nil {
			t.Errorf("a non-member read the roster: %v", body["members"])
		}
	}

	// And a banned rider is not a member, however they got here.
	bobID := store.UUIDString(h.users.byToken["bob"].ID)
	ban := fmt.Sprintf(`{"userId":%q,"role":"banned"}`, bobID)
	if status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/role", ban); status != http.StatusNoContent {
		t.Fatalf("ban: %d", status)
	}
	status, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	if status == http.StatusOK && body["code"] != nil {
		t.Errorf("a banned rider kept the join code: %v", body["code"])
	}
}

// A rider's own settings for one room (#1100). The switches are the easy
// half; what matters is that the two queries downstream actually honour them,
// because a preference nothing reads is worse than no preference at all —
// the rider believes they are off the board and they are on it.
func TestRiderPrefsAreTheirOwnAndAreHonoured(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Prefs")
	for _, member := range []string{"bob", "carol"} {
		h.join(t, member, slug)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}

	// Defaults reproduce today's behaviour: nobody is opted out by the
	// migration. This is the box that a silent opt-out would fail.
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Fatalf("defaults are not today's behaviour: %v", body["me"])
	}

	// Bob opts out of both.
	if status, out := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d %v", status, out)
	}
	_, body = h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ = body["me"].(map[string]any)
	if me == nil || me["notify"] != false || me["onBoard"] != false {
		t.Errorf("preferences did not persist: %v", body["me"])
	}
	// Carol is untouched — one rider's choice is not the room's.
	_, body = h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ = body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("bob's choice reached carol: %v", body["me"])
	}

	// The mail list honours it. The query needs a deliverable address and the
	// global flag on, so both are set directly — without them the target list
	// is empty whatever the preference says, and the assertion below would
	// pass against a filter that does nothing.
	for _, who := range []string{"bob", "carol"} {
		if _, err := h.store.Pool.Exec(t.Context(),
			"update users set email = $2, notify_planned = true where id = $1",
			h.users.byToken[who].ID, who+"@example.test"); err != nil {
			t.Fatalf("give %s an address: %v", who, err)
		}
	}
	// Alice plans, so she is excluded as the planner; bob opted out; carol
	// should be the only target left.
	targets, err := h.store.Queries.ListRoomNotifyTargets(t.Context(), db.ListRoomNotifyTargetsParams{
		RoomID: room.ID, ID: h.users.byToken["alice"].ID,
	})
	if err != nil {
		t.Fatalf("notify targets: %v", err)
	}
	var mailedBob, mailedCarol bool
	for _, target := range targets {
		mailedBob = mailedBob || target.ID == h.users.byToken["bob"].ID
		mailedCarol = mailedCarol || target.ID == h.users.byToken["carol"].ID
	}
	if mailedBob {
		t.Error("a rider who turned this room's mail off was still a target")
	}
	if !mailedCarol {
		t.Error("nobody would be mailed, so the opt-out proves nothing")
	}

	// And the board honours it — proved with a real ride this week, because
	// an empty board proves nothing about a filter.
	for _, who := range []string{"bob", "carol"} {
		h.roomRide(t, who, room.ID, time.Now(), 1800)
	}
	rows, err := h.store.Queries.RoomWeekBoard(t.Context(), room.ID)
	if err != nil {
		t.Fatalf("board: %v", err)
	}
	var sawBob, sawCarol bool
	for _, row := range rows {
		sawBob = sawBob || row.UserID == h.users.byToken["bob"].ID
		sawCarol = sawCarol || row.UserID == h.users.byToken["carol"].ID
	}
	if sawBob {
		t.Error("a rider who opted out is on the board anyway")
	}
	if !sawCarol {
		t.Error("nobody is on the board, so the opt-out proves nothing")
	}
}

// The update is keyed on (room, caller), so there is no way to spell another
// rider's preferences — and a non-member is refused by the same gate every
// other room-scoped write uses.
func TestOnlyYouSetYourOwnRoomPrefs(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Not Yours")
	h.join(t, "bob", slug)

	// Carol never joined.
	if status, _ := h.call(t, "carol", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusForbidden {
		t.Errorf("a non-member set preferences: %d", status)
	}
	// Signed out is 401, not 403.
	if status, _ := h.call(t, "", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
	// Bob's own write does not reach alice, however he addresses it: the body
	// carries no user id at all, so a smuggled one is simply refused.
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		fmt.Sprintf(`{"notify":false,"onBoard":false,"userId":%q}`,
			store.UUIDString(h.users.byToken["alice"].ID))); status != http.StatusBadRequest {
		t.Errorf("a smuggled userId was accepted: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("bob's own write: %d", status)
	}
	_, body := h.call(t, "alice", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("bob's write changed alice's preferences: %v", body["me"])
	}
}

// Leaving drops the membership row, so preferences reset on rejoining. That
// falls out of where they live rather than being enforced anywhere, which is
// exactly why it is worth a test — nothing else states it.
func TestLeavingARoomForgetsYourPreferences(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Forgetful")
	bobID := store.UUIDString(h.users.byToken["bob"].ID)
	h.join(t, "bob", slug)
	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/rooms/"+slug+"/me",
		`{"notify":false,"onBoard":false}`); status != http.StatusOK {
		t.Fatalf("set prefs: %d", status)
	}
	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/rooms/"+slug+"/members/"+bobID, ""); status != http.StatusNoContent {
		t.Fatalf("leave: %d", status)
	}
	h.join(t, "bob", slug)
	_, body := h.call(t, "bob", http.MethodGet, "/api/rooms/"+slug, "")
	me, _ := body["me"].(map[string]any)
	if me == nil || me["notify"] != true || me["onBoard"] != true {
		t.Errorf("rejoining kept the old preferences: %v", body["me"])
	}
}

// The opt-in public directory (#1118, ADR-0039). Two invariants matter more
// than the listing itself, and both are one careless clause from being wrong.
func TestDirectoryListsOnlyWhatOwnersChose(t *testing.T) {
	h := setup(t)
	openSlug, _ := h.createRoom(t, "alice", "Findable Room")
	shutSlug, _ := h.createRoom(t, "alice", "Private Room")

	// Every room starts unlisted — the default lives in the schema (#698),
	// so a fresh directory is empty however many rooms exist.
	if names := h.directory(t, "bob"); len(names) != 0 {
		t.Fatalf("a room listed itself without being asked: %v", names)
	}

	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+openSlug,
		`{"name":"Findable Room","listed":true,"soundPack":"base","cheers":["flame"]}`); status != http.StatusOK {
		t.Fatalf("list it: %d", status)
	}
	names := h.directory(t, "bob")
	if len(names) != 1 || names[0] != "Findable Room" {
		t.Fatalf("directory = %v, want only the listed room", names)
	}
	if slices.Contains(names, "Private Room") {
		t.Error("an unlisted room is in the directory")
	}
	_ = shutSlug

	// Signed out is not "public": opt-in public means opt-in to the riders on
	// this instance, not to the web (ADR-0009).
	if status, _ := h.call(t, "", http.MethodGet, "/api/rooms/directory", ""); status != http.StatusUnauthorized {
		t.Errorf("signed out read the directory: %d", status)
	}
}

// Listing widens DISCOVERY, never ACCESS. Bob can find the room; he still
// meets every gate he met before. This is the invariant that makes the
// feature safe, and it fails silently — the directory would look identical.
func TestListingARoomOpensNoDoor(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Findable Room")
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug,
		`{"name":"Findable Room","listed":true,"soundPack":"base","cheers":["flame"]}`); status != http.StatusOK {
		t.Fatalf("list it: %d", status)
	}

	// Carol is not a member. She can see it exists…
	if names := h.directory(t, "carol"); len(names) != 1 {
		t.Fatalf("carol cannot find a listed room: %v", names)
	}
	// …and that is the whole of what she gains.
	_, body := h.call(t, "carol", http.MethodGet, "/api/rooms/"+slug, "")
	for _, leak := range []string{"code", "members", "soundPack", "cheers", "icsToken", "board", "me"} {
		if body[leak] != nil {
			t.Errorf("listing exposed %q to a non-member: %v", leak, body[leak])
		}
	}
	// The directory entry itself carries no disclosure beyond the door.
	status, list := h.call(t, "carol", http.MethodGet, "/api/rooms/directory", "")
	if status != http.StatusOK {
		t.Fatalf("directory: %d", status)
	}
	entries, _ := list["rooms"].([]any)
	if len(entries) != 1 {
		t.Fatalf("entries = %v", entries)
	}
	entry, _ := entries[0].(map[string]any)
	for key := range entry {
		if key != "slug" && key != "name" && key != "icon" {
			t.Errorf("a directory entry carries %q — the columns are the disclosure decision", key)
		}
	}
}

// `listed` and crew visibility are different axes (ADR-0038 says so
// explicitly). Nothing here may make a crew-visible room listed, and listing
// a room is not a statement about any crew.
func TestListedIsNotCrewVisibility(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Room")
	// Bob is a member, so this room is crew-visible to him by ADR-0038's
	// default — and that must not put it in the public directory.
	h.join(t, "bob", slug)
	if names := h.directory(t, "carol"); len(names) != 0 {
		t.Errorf("a room became listed by having members: %v", names)
	}
	room, err := h.store.Queries.GetRoomBySlug(t.Context(), slug)
	if err != nil {
		t.Fatalf("room: %v", err)
	}
	if room.Listed {
		t.Error("joining a room set its listed flag")
	}
}

// directory reads the public list as one rider, returning room names.
func (h *harness) directory(t *testing.T, who string) []string {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/rooms/directory", "")
	if status != http.StatusOK {
		t.Fatalf("directory as %s: %d %v", who, status, body)
	}
	entries, _ := body["rooms"].([]any)
	var names []string
	for _, item := range entries {
		row, _ := item.(map[string]any)
		if name, ok := row["name"].(string); ok {
			names = append(names, name)
		}
	}
	return names
}
