package rooms

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/natrontech/wattroom/server/internal/testx"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *testx.Users
	svc   *Service
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "carol"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
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

func (h *harness) userID(t *testing.T, name string) string {
	t.Helper()
	return store.UUIDString(h.users.ByToken[name].ID)
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

// fakePresence is one canned answer for every room — enough to drive the
// unread badge, which is the only thing on this path that reads presence.
type fakePresence struct{ p protocol.RoomPresence }

func (f fakePresence) Presence(string) protocol.RoomPresence { return f.p }

func (f fakePresence) Kick(string, string) {}

func (f fakePresence) SetRole(string, string, string) {}

func (f fakePresence) SessionAnnounce(string, string, string, string, time.Time) {
}

func (f fakePresence) PresenceChanged() {}

func (f fakePresence) CloseRoom(string) {}

// roomRide writes one summary row into a room, back-dated, so the crew tiles
// have sessions to count. Distinct days are what a session is (#995).
func (h *harness) roomRide(t *testing.T, user string, room pgtype.UUID, at time.Time, seconds int32) {
	t.Helper()
	if _, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.users.ByToken[user].ID, RoomID: room, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: at, Valid: true},
		Seconds:   seconds, AvgWatts: 200, Kj: 500, Execution: 0.9, FtpWatts: 200,
		Samples: []byte("bytes"), Xp: 10,
	}); err != nil {
		t.Fatalf("create ride: %v", err)
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

// The share card names a room only when its owner listed it (#1734,
// ADR-0039): "public" means every signed-in rider, not the web.
func TestTheShareCardNamesListedRoomsOnly(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Crew Card Room")
	if _, _, ok := h.svc.PublicIdentity(t.Context(), slug); ok {
		t.Fatal("an unlisted room has a public identity")
	}
	if status, _ := h.call(t, "alice", http.MethodPatch, "/api/rooms/"+slug, `{"name":"Crew Card Room","listed":true,"crewVisible":true}`); status != http.StatusOK {
		t.Fatalf("list: %d", status)
	}
	if name, _, ok := h.svc.PublicIdentity(t.Context(), slug); !ok || name != "Crew Card Room" {
		t.Fatalf("a listed room's identity: %q %v", name, ok)
	}
	if _, _, ok := h.svc.PublicIdentity(t.Context(), "no-such-room"); ok {
		t.Fatal("an unknown slug has a public identity")
	}
}
