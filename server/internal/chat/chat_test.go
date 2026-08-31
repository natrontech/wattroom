package chat

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

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

func setup(t *testing.T) (*Service, *http.ServeMux, *fakeUsers, db.Room) {
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
	for _, name := range []string{"alice", "bob", "cara"} {
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
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: "CHAT01", Slug: "chat-cave", Name: "Chat Cave", OwnerID: users.byToken["alice"].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for _, name := range []string{"alice", "bob"} {
		if err := st.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: users.byToken[name].ID, Role: "member",
		}); err != nil {
			t.Fatal(err)
		}
	}
	svc := New(st, users, slog.New(slog.DiscardHandler))
	mux := http.NewServeMux()
	svc.Register(mux)
	return svc, mux, users, room
}

func backlog(t *testing.T, mux *http.ServeMux, user, slug string) (int, []map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rooms/"+slug+"/chat", nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var body struct {
		Messages []map[string]any `json:"messages"`
	}
	_ = json.NewDecoder(w.Body).Decode(&body)
	return w.Code, body.Messages
}

func TestChatRoundTrip(t *testing.T) {
	svc, mux, users, _ := setup(t)
	alice := users.byToken["alice"]
	bob := users.byToken["bob"]

	// Boundary: no auth 401, non-member 403, unknown room 404.
	if code, _ := backlog(t, mux, "", "chat-cave"); code != http.StatusUnauthorized {
		t.Fatalf("unauthed: %d", code)
	}
	if code, _ := backlog(t, mux, "cara", "chat-cave"); code != http.StatusForbidden {
		t.Fatalf("non-member: %d", code)
	}
	if code, _ := backlog(t, mux, "alice", "no-such-room"); code != http.StatusNotFound {
		t.Fatalf("unknown room: %d", code)
	}

	// Save two lines; the backlog returns them oldest-first with authors.
	id1, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "warm-up at 7?")
	if !ok || id1 == "" {
		t.Fatal("save 1 failed")
	}
	id2, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(bob.ID), "in")
	if !ok || id2 == "" {
		t.Fatal("save 2 failed")
	}
	code, messages := backlog(t, mux, "alice", "chat-cave")
	if code != http.StatusOK || len(messages) != 2 {
		t.Fatalf("backlog: %d %v", code, messages)
	}
	if messages[0]["from"] != "alice" || messages[1]["from"] != "bob" {
		t.Fatalf("order/authors: %v", messages)
	}
	// Author ids ride along (#219) — namesake-proof, same as live tick lines.
	if messages[0]["fromId"] != store.UUIDString(alice.ID) || messages[1]["fromId"] != store.UUIDString(bob.ID) {
		t.Fatalf("author ids: %v", messages)
	}

	// Reactions toggle: on → 1, mirrored on → 2, off → 1; junk id refused.
	// The added flag reports which way it went (#219).
	if n, added, ok := svc.ToggleReaction(t.Context(), "chat-cave", id1, store.UUIDString(bob.ID), "🔥"); !ok || n != 1 || !added {
		t.Fatalf("first toggle: %d %v %v", n, added, ok)
	}
	if n, added, ok := svc.ToggleReaction(t.Context(), "chat-cave", id1, store.UUIDString(alice.ID), "🔥"); !ok || n != 2 || !added {
		t.Fatalf("second rider: %d %v %v", n, added, ok)
	}
	if n, added, ok := svc.ToggleReaction(t.Context(), "chat-cave", id1, store.UUIDString(bob.ID), "🔥"); !ok || n != 1 || added {
		t.Fatalf("toggle off: %d %v %v", n, added, ok)
	}
	if _, _, ok := svc.ToggleReaction(t.Context(), "chat-cave", "not-a-uuid", store.UUIDString(bob.ID), "🔥"); ok {
		t.Fatal("junk message id accepted")
	}

	// The backlog carries counts and the viewer's own reactions.
	_, messages = backlog(t, mux, "alice", "chat-cave")
	first := messages[0]
	reactions, _ := first["reactions"].(map[string]any)
	if reactions["🔥"] != float64(1) {
		t.Fatalf("backlog count: %v", first)
	}
	mine, _ := first["mine"].([]any)
	if len(mine) != 1 || mine[0] != "🔥" {
		t.Fatalf("backlog mine: %v", first)
	}
}

func TestReactionRefusedAcrossRooms(t *testing.T) {
	svc, _, users, _ := setup(t)
	alice := users.byToken["alice"]
	// A second room the message does NOT live in.
	other, err := svc.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: "CHAT02", Slug: "other-cave", Name: "Other", OwnerID: alice.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = svc.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", other.ID)
	})
	id, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "here")
	if !ok {
		t.Fatal("save failed")
	}
	// Toggling it through the OTHER room's slug must refuse — the room is
	// the privacy boundary even for a reaction.
	if _, _, ok := svc.ToggleReaction(t.Context(), "other-cave", id, store.UUIDString(alice.ID), "🔥"); ok {
		t.Fatal("cross-room reaction accepted")
	}
}
