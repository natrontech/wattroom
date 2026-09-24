package status

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

type world struct {
	mux   *http.ServeMux
	st    *store.Store
	users *testx.Users
	crew  pgtype.UUID
	pings *atomic.Int64
}

type countingLobby struct{ n *atomic.Int64 }

func (l countingLobby) PresenceChanged() { l.n.Add(1) }

// setup: alice owns a crew bob is a member of; dave is in none of it.
func setup(t *testing.T) world {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "dave"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	crew := testx.Crew(t, st, "Status Crew", users.ByToken["alice"].ID, users.ByToken["bob"].ID)
	pings := new(atomic.Int64)
	w := world{mux: http.NewServeMux(), st: st, users: users, crew: crew, pings: pings}
	New(st, users, countingLobby{pings}, slog.New(slog.DiscardHandler)).Register(w.mux)
	return w
}

func (w world) do(t *testing.T, method, who, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &buf)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	w.mux.ServeHTTP(rec, req)
	return rec
}

// statusOf is what every surface would show for the rider right now.
func (w world) statusOf(t *testing.T, who string) *protocol.Status {
	t.Helper()
	u, err := w.st.Queries.GetUser(t.Context(), w.users.ByToken[who].ID)
	if err != nil {
		t.Fatalf("read %s: %v", who, err)
	}
	return OfUser(u, time.Now())
}

func (w world) emoji(t *testing.T, name string) string {
	t.Helper()
	row, err := w.st.Queries.CreateCrewEmoji(t.Context(), db.CreateCrewEmojiParams{
		CrewID: w.crew, UserID: w.users.ByToken["alice"].ID, Name: name,
		Mime: "image/png", Bytes: []byte("\x89PNG\r\n\x1a\n"),
	})
	if err != nil {
		t.Fatalf("add :%s:: %v", name, err)
	}
	return store.UUIDString(row.ID)
}

func TestSetStatus(t *testing.T) {
	w := setup(t)
	rec := w.do(t, http.MethodPut, "bob", "/api/me/status", map[string]string{"emoji": "🤒", "text": "  Out sick  "})
	if rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	got := w.statusOf(t, "bob")
	if got == nil || got.Emoji != "🤒" || got.Text != "Out sick" || got.ExpiresAt != "" {
		t.Fatalf("status = %+v, want 🤒 Out sick with no clearing time", got)
	}
	if w.pings.Load() != 1 {
		t.Fatalf("lobby pinged %d times, want 1 — nobody else would see it change", w.pings.Load())
	}

	if rec := w.do(t, http.MethodDelete, "bob", "/api/me/status", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body.String())
	}
	if got := w.statusOf(t, "bob"); got != nil {
		t.Fatalf("after clearing, status = %+v", got)
	}
}

func TestSetStatusRefuses(t *testing.T) {
	w := setup(t)
	long := strings.Repeat("é", protocol.MaxStatusChars+1)
	past := time.Now().Add(-time.Minute).Format(time.RFC3339)
	for _, tc := range []struct {
		name, who string
		body      any
		code      int
		field     string
	}{
		{"signed out", "", map[string]string{"text": "hi"}, http.StatusUnauthorized, ""},
		{"too long", "bob", map[string]string{"text": long}, http.StatusBadRequest, "text"},
		{"two lines", "bob", map[string]string{"text": "a\nb"}, http.StatusBadRequest, "text"},
		{"words for an emoji", "bob", map[string]string{"emoji": "sick"}, http.StatusBadRequest, "emoji"},
		{"already cleared", "bob", map[string]string{"text": "hi", "expiresAt": past}, http.StatusBadRequest, "expiresAt"},
		{"unknown field", "bob", map[string]string{"colour": "red"}, http.StatusBadRequest, ""},
		{"another crew's emoji", "dave", map[string]string{"emojiId": w.emoji(t, "party")}, http.StatusBadRequest, "emoji"},
		{"no such emoji", "bob", map[string]string{"emojiId": "not-a-uuid"}, http.StatusBadRequest, "emoji"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := w.do(t, http.MethodPut, tc.who, "/api/me/status", tc.body)
			if rec.Code != tc.code {
				t.Fatalf("%d %s, want %d", rec.Code, rec.Body.String(), tc.code)
			}
			if tc.field != "" && !strings.Contains(rec.Body.String(), `"field":"`+tc.field+`"`) {
				t.Fatalf("body %s names no field %q", rec.Body.String(), tc.field)
			}
		})
	}
	if got := w.statusOf(t, "bob"); got != nil {
		t.Fatalf("a refused set left a status: %+v", got)
	}
}

func TestSettingNeitherClears(t *testing.T) {
	w := setup(t)
	w.do(t, http.MethodPut, "bob", "/api/me/status", map[string]string{"text": "Riding outside"})
	if rec := w.do(t, http.MethodPut, "bob", "/api/me/status", map[string]string{"text": "   "}); rec.Code != http.StatusNoContent {
		t.Fatalf("blank set: %d %s, want 204", rec.Code, rec.Body.String())
	}
	if got := w.statusOf(t, "bob"); got != nil {
		t.Fatalf("status = %+v, want none", got)
	}
}

// A crew emoji in a status (ADR-0060): the server names it from the row, its
// picture opens to anyone signed in while it is worn, and the crew deleting
// it leaves the status its :name:.
func TestCrewEmojiInAStatus(t *testing.T) {
	w := setup(t)
	id := w.emoji(t, "party_parrot")
	image := "/api/emoji/" + id

	if rec := w.do(t, http.MethodGet, "dave", image, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("nobody wears it yet, dave read it: %d", rec.Code)
	}
	rec := w.do(t, http.MethodPut, "bob", "/api/me/status", map[string]string{"emojiId": id, "emoji": "🙃", "text": "Party"})
	if rec.Code != http.StatusOK {
		t.Fatalf("wear: %d %s", rec.Code, rec.Body.String())
	}
	if got := w.statusOf(t, "bob"); got == nil || got.Emoji != ":party_parrot:" || got.EmojiID != id {
		t.Fatalf("status = %+v, want :party_parrot: by id — the row names it, not the client", got)
	}
	if rec := w.do(t, http.MethodGet, "dave", image, nil); rec.Code != http.StatusOK {
		t.Fatalf("bob wears it, dave outside the crew could not read it: %d %s", rec.Code, rec.Body.String())
	}
	if rec := w.do(t, http.MethodGet, "", image, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("signed out read it: %d", rec.Code)
	}

	if _, err := w.st.Queries.DeleteCrewEmoji(t.Context(), db.DeleteCrewEmojiParams{ID: mustUUID(t, id), CrewID: w.crew}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := w.statusOf(t, "bob"); got == nil || got.Emoji != ":party_parrot:" || got.EmojiID != "" {
		t.Fatalf("after the crew deleted it, status = %+v, want its :name: and no picture", got)
	}
	if rec := w.do(t, http.MethodGet, "dave", image, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("a deleted emoji still served: %d", rec.Code)
	}
}

func TestWornEmojiClosesWhenTheStatusClears(t *testing.T) {
	w := setup(t)
	id := w.emoji(t, "wave")
	w.do(t, http.MethodPut, "bob", "/api/me/status", map[string]string{"emojiId": id})
	w.do(t, http.MethodDelete, "bob", "/api/me/status", nil)
	if rec := w.do(t, http.MethodGet, "dave", "/api/emoji/"+id, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("nobody wears it any more, dave read it: %d", rec.Code)
	}
}

func TestOfHidesACleared(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	text := "Out sick"
	at := func(d time.Duration) pgtype.Timestamptz { return pgtype.Timestamptz{Time: now.Add(d), Valid: true} }
	for _, tc := range []struct {
		name    string
		expires pgtype.Timestamptz
		shown   bool
	}{
		{"don't clear", pgtype.Timestamptz{}, true},
		{"clears later", at(time.Minute), true},
		{"cleared just now", at(0), false},
		{"cleared long ago", at(-time.Hour), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Of(nil, pgtype.UUID{}, &text, tc.expires, now); (got != nil) != tc.shown {
				t.Fatalf("Of = %+v, want shown %v", got, tc.shown)
			}
		})
	}
	if got := Of(nil, pgtype.UUID{}, nil, pgtype.Timestamptz{}, now); got != nil {
		t.Fatalf("no emoji and no text read as %+v", got)
	}
}

func mustUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	id, err := store.ParseUUID(s)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
