package crews

import (
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/natrontech/wattroom/server/internal/testx"
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
			// crews.owner_id is ON DELETE RESTRICT (ADR-0038): the crews a
			// rider founded go before the rider can.
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

// found starts a crew for who through the API (#2480) and hands back its id.
func (h *harness) found(t *testing.T, who, name string) string {
	t.Helper()
	status, body := h.call(t, who, http.MethodPost, "/api/crews", fmt.Sprintf(`{"name":%q}`, name))
	if status != http.StatusCreated {
		t.Fatalf("%s founding %q: %d %v", who, name, status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// newCrew founds a crew for owner and hands back its row — the shape most
// tests start from, where the crew is the fixture and not the thing under test.
func (h *harness) newCrew(t *testing.T, owner, name string) db.GetCrewRow {
	t.Helper()
	return h.crew(t, h.found(t, owner, name))
}

// crew reads a crew's row by its id, fresh — a rotated code or a new owner
// shows on the next read.
func (h *harness) crew(t *testing.T, id string) db.GetCrewRow {
	t.Helper()
	crewID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("crew id %q: %v", id, err)
	}
	crew, err := h.store.Queries.GetCrew(t.Context(), crewID)
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	return crew
}

func crewPath(crew db.GetCrewRow, rest ...string) string {
	return "/api/crews/" + store.UUIDString(crew.ID) + strings.Join(rest, "")
}

// joinCrew walks who in through the crew's door with its code.
func (h *harness) joinCrew(t *testing.T, who, code string) {
	t.Helper()
	if status, body := h.call(t, who, http.MethodPost, "/api/crews/join", fmt.Sprintf(`{"code":%q}`, code)); status != http.StatusOK {
		t.Fatalf("%s could not join the crew: %d %v", who, status, body)
	}
}

// join is joinCrew with the code read off the crew.
func (h *harness) join(t *testing.T, who string, crew db.GetCrewRow) {
	t.Helper()
	h.joinCrew(t, who, codeOf(h.crew(t, store.UUIDString(crew.ID)).Code))
}

// voice is the crew's first voice channel — a founded crew opens with one
// (#2480), and it is what the hub is addressed by (#2436).
func (h *harness) voice(t *testing.T, crew db.GetCrewRow) pgtype.UUID {
	t.Helper()
	rows, err := h.store.Queries.ListCrewChannels(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("channels: %v", err)
	}
	for _, c := range rows {
		if c.Kind == "voice" {
			return c.ID
		}
	}
	t.Fatalf("crew %s has no voice channel", crew.Name)
	return pgtype.UUID{}
}

// channel makes one of the crew's channels straight in the table: the
// channel is the fixture here, never the thing under test.
func (h *harness) channel(t *testing.T, crew db.GetCrewRow, kind, name string, private bool) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`insert into channels (crew_id, kind, name, position, private) values ($1, $2, $3, 0, $4) returning id`,
		crew.ID, kind, name, private).Scan(&id); err != nil {
		t.Fatalf("channel %s: %v", name, err)
	}
	return id
}

// crewRide is a ride ridden in one of the crew's sessions, in a voice channel.
func (h *harness) crewRide(t *testing.T, who string, crew db.GetCrewRow, channel pgtype.UUID, at time.Time, kj int) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into rides (user_id, crew_id, channel_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples)
		 values ($1, $2, $3, 'Openers', $4, 1800, 200, $5, 0.9, 250, ''::bytea)`,
		h.users.ByToken[who].ID, crew.ID, channel, at, kj); err != nil {
		t.Fatalf("ride: %v", err)
	}
}

func (h *harness) userID(t *testing.T, name string) string {
	t.Helper()
	return store.UUIDString(h.users.ByToken[name].ID)
}

func (h *harness) displayName(t *testing.T, name string) string {
	t.Helper()
	return h.users.ByToken[name].DisplayName
}

// makeCrewAdmin hands someone the crew role every "can a crew admin …" test
// starts from. Straight to the row, not through /api/crews/{id}/role: the
// promotion is the fixture here, never the thing under test.
func (h *harness) makeCrewAdmin(t *testing.T, crew db.GetCrewRow, who string) {
	t.Helper()
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crew.ID, UserID: h.users.ByToken[who].ID, Role: "admin",
	}); err != nil {
		t.Fatalf("make %s a crew admin: %v", who, err)
	}
}

// crewRole is the one word the crew makes of a person — "" for somebody it
// has never heard of — read the way every gate in the app reads it.
func (h *harness) crewRole(t *testing.T, crew db.GetCrewRow, user pgtype.UUID) string {
	t.Helper()
	role, err := h.store.Queries.CrewRoleOf(t.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user})
	if err != nil {
		t.Fatalf("crew role: %v", err)
	}
	return role
}

// fakePresence satisfies Presence and records nothing; a test that needs to
// see a call embeds it and overrides the one method.
type fakePresence struct{}

func (fakePresence) Kick(string, string) {}

func (fakePresence) SessionAnnounce(string, string, string, string, time.Time) {}

func (fakePresence) PresenceChanged() {}

func (fakePresence) OpenSession(string, protocol.Rider, string, string) (string, string, string) {
	return "", "", ""
}
