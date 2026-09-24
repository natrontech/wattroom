package emoji

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A crew's own emoji (#2643), behind the real crew gate.

type world struct {
	svc   *Service
	mux   *http.ServeMux
	st    *store.Store
	users *testx.Users
	crew  pgtype.UUID
	pings *atomic.Int64
}

type countingLobby struct{ n *atomic.Int64 }

func (l countingLobby) PresenceChanged() { l.n.Add(1) }

// setup: alice owns a crew bob and cara are members of; dave is in none of it.
func setup(t *testing.T) world {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara", "dave"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	crew := testx.Crew(t, st, "Emoji Crew", users.ByToken["alice"].ID, users.ByToken["bob"].ID, users.ByToken["cara"].ID)
	log := slog.New(slog.DiscardHandler)
	pings := new(atomic.Int64)
	w := world{svc: New(st, channels.New(st, users, log), countingLobby{pings}, log),
		mux: http.NewServeMux(), st: st, users: users, crew: crew, pings: pings}
	w.svc.Register(w.mux)
	return w
}

func (w world) path(rest string) string {
	return "/api/crews/" + store.UUIDString(w.crew) + "/emoji" + rest
}

// png is a body http.DetectContentType reads as a PNG, padded to size.
func png(size int) []byte {
	b := make([]byte, size)
	copy(b, "\x89PNG\r\n\x1a\n")
	return b
}

// do runs one request as a user ("" = signed out) and hands back the recorder.
func (w world) do(t *testing.T, method, who, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(body))
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	w.mux.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("%d, body is not JSON: %v", rec.Code, err)
	}
	return out
}

func (w world) upload(t *testing.T, who, name string, body []byte) (int, map[string]any) {
	t.Helper()
	rec := w.do(t, http.MethodPost, who, w.path("?name="+url.QueryEscape(name)), body)
	return rec.Code, decode(t, rec)
}

// add uploads one that must land, and returns its id.
func (w world) add(t *testing.T, who, name string) string {
	t.Helper()
	status, body := w.upload(t, who, name, png(64))
	if status != http.StatusCreated {
		t.Fatalf("%s adding :%s:: %d %v", who, name, status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// names is the crew's set as a member reads it, in the order it comes.
func (w world) names(t *testing.T, who string) []string {
	t.Helper()
	rec := w.do(t, http.MethodGet, who, w.path(""), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s listing: %d %s", who, rec.Code, rec.Body.String())
	}
	var body struct {
		Emoji []emojiJSON `json:"emoji"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("list body: %v", err)
	}
	if body.Emoji == nil {
		t.Fatal("the list is null, not an array")
	}
	out := []string{}
	for _, e := range body.Emoji {
		out = append(out, e.Name)
	}
	return out
}

func (w world) setRole(t *testing.T, who, role string) {
	t.Helper()
	if err := w.st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: w.crew, UserID: w.users.ByToken[who].ID, Role: role,
	}); err != nil {
		t.Fatalf("%s as %s: %v", who, role, err)
	}
}

// Upload, list, fetch and delete: the whole life of one emoji.
func TestEmojiRoundTrip(t *testing.T) {
	w := setup(t)
	if got := w.names(t, "cara"); len(got) != 0 {
		t.Fatalf("a new crew has emoji: %v", got)
	}

	picture := png(300)
	status, body := w.upload(t, "bob", "party_parrot", picture)
	if status != http.StatusCreated {
		t.Fatalf("upload: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	if id == "" || body["name"] != "party_parrot" || body["userId"] != store.UUIDString(w.users.ByToken["bob"].ID) || body["createdAt"] == "" {
		t.Fatalf("the created emoji reads %v", body)
	}
	if n := w.pings.Load(); n != 1 {
		t.Errorf("an add pinged the lobby %d times, want 1", n)
	}
	w.add(t, "cara", "ache")

	// By name, so a picker reads alphabetically.
	if got := w.names(t, "alice"); len(got) != 2 || got[0] != "ache" || got[1] != "party_parrot" {
		t.Fatalf("the owner reads %v", got)
	}

	rec := w.do(t, http.MethodGet, "cara", w.path("/"+id), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("image: %d %s", rec.Code, rec.Body.String())
	}
	got, _ := io.ReadAll(rec.Body)
	if !bytes.Equal(got, picture) {
		t.Error("the picture served is not the one uploaded")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q", ct)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("an uploaded picture is served without nosniff")
	}

	if rec := w.do(t, http.MethodDelete, "bob", w.path("/"+id), nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if got := w.names(t, "bob"); len(got) != 1 || got[0] != "ache" {
		t.Fatalf("after the delete the crew reads %v", got)
	}
	if rec := w.do(t, http.MethodGet, "cara", w.path("/"+id), nil); rec.Code != http.StatusNotFound {
		t.Errorf("a deleted emoji's picture: %d, want 404", rec.Code)
	}
}

// The crew's pictures are its members' (#2643): nobody else reads the list or
// a picture, and a crew they are not in is a 404 like one that does not exist.
func TestEmojiReadsAreTheCrews(t *testing.T) {
	w := setup(t)
	id := w.add(t, "bob", "gg")
	other := testx.Crew(t, w.st, "Other Crew", w.users.ByToken["dave"].ID)
	otherPath := "/api/crews/" + store.UUIDString(other) + "/emoji/" + id

	for _, tc := range []struct {
		name, who, path string
		want            int
	}{
		{"list, signed out", "", w.path(""), http.StatusUnauthorized},
		{"list, not in the crew", "dave", w.path(""), http.StatusNotFound},
		{"image, signed out", "", w.path("/" + id), http.StatusUnauthorized},
		{"image, not in the crew", "dave", w.path("/" + id), http.StatusNotFound},
		{"image, unknown id", "cara", w.path("/00000000-0000-0000-0000-000000000000"), http.StatusNotFound},
		{"image, malformed id", "cara", w.path("/nope"), http.StatusNotFound},
		// Dave's own crew does not have it: an id from another crew misses.
		{"image, under another crew", "dave", otherPath, http.StatusNotFound},
		{"list, malformed crew", "bob", "/api/crews/nope/emoji", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if rec := w.do(t, http.MethodGet, tc.who, tc.path, nil); rec.Code != tc.want {
				t.Fatalf("%d %s, want %d", rec.Code, rec.Body.String(), tc.want)
			}
		})
	}

	// A ban is a door shut, not a role: the banned read like strangers.
	w.setRole(t, "cara", "banned")
	if rec := w.do(t, http.MethodGet, "cara", w.path(""), nil); rec.Code != http.StatusNotFound {
		t.Errorf("a banned member lists: %d, want 404", rec.Code)
	}
}
