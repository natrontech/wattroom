package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/natrontech/wattroom/server/internal/testx"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/natrontech/wattroom/server/internal/budget"

	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

func setup(t *testing.T) (*Service, *http.ServeMux, *testx.Users, db.Room) {
	t.Helper()
	st := storetest.Open(t)

	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	room, err := st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "chat-cave", Name: "Chat Cave", OwnerID: users.ByToken["alice"].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for _, name := range []string{"alice", "bob"} {
		if err := st.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: users.ByToken[name].ID, Role: "member",
		}); err != nil {
			t.Fatal(err)
		}
	}
	log := slog.New(slog.DiscardHandler)
	// The real gate, not a fake of it: what refuses a banned rider here is
	// the same code that refuses them at the socket (#638).
	svc := New(st, rooms.New(st, users, log), log)
	mux := http.NewServeMux()
	svc.Register(mux)
	return svc, mux, users, room
}

// The ban stops at chat HTTP too (#638): a banned member holds a membership
// row, but neither the backlog nor a post is theirs to touch.
func TestBannedMemberRefusedAtChat(t *testing.T) {
	svc, mux, users, room := setup(t)
	if status, _ := post(t, mux, "bob", "/api/rooms/"+room.Slug+"/chat", `{"text":"before"}`); status != http.StatusOK {
		t.Fatalf("member post before ban: %d", status)
	}
	if _, err := svc.store.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: users.ByToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatal(err)
	}
	if status, msgs := backlog(t, mux, "bob", room.Slug); status != http.StatusForbidden || len(msgs) != 0 {
		t.Errorf("banned rider read the backlog: %d %v", status, msgs)
	}
	if status, _ := post(t, mux, "bob", "/api/rooms/"+room.Slug+"/chat", `{"text":"still here"}`); status != http.StatusForbidden {
		t.Errorf("banned rider posted: %d", status)
	}
	if status, _ := postImage(t, mux, "bob", room.Slug, []byte("\x89PNG")); status != http.StatusForbidden {
		t.Errorf("banned rider uploaded an image: %d", status)
	}
	// Nothing leaked into the room: the members still see one line.
	if status, msgs := backlog(t, mux, "alice", room.Slug); status != http.StatusOK || len(msgs) != 1 {
		t.Errorf("room backlog after the refused post: %d, %d lines", status, len(msgs))
	}
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
	alice := users.ByToken["alice"]
	bob := users.ByToken["bob"]

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
	id1, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "warm-up at 7?", "")
	if !ok || id1 == "" {
		t.Fatal("save 1 failed")
	}
	id2, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(bob.ID), "in", "")
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
	alice := users.ByToken["alice"]
	// A second room the message does NOT live in.
	other, err := svc.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "other-cave", Name: "Other", OwnerID: alice.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = svc.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", other.ID)
	})
	id, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "here", "")
	if !ok {
		t.Fatal("save failed")
	}
	// Toggling it through the OTHER room's slug must refuse — the room is
	// the privacy boundary even for a reaction.
	if _, _, ok := svc.ToggleReaction(t.Context(), "other-cave", id, store.UUIDString(alice.ID), "🔥"); ok {
		t.Fatal("cross-room reaction accepted")
	}
}

// tinyPNG is just the signature — enough for http.DetectContentType.
var tinyPNG = []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")

func postImage(t *testing.T, mux *http.ServeMux, user, slug string, body []byte) (int, string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/rooms/"+slug+"/chat/images", bytes.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var out struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(w.Body).Decode(&out)
	return w.Code, out.ID
}

func getImage(t *testing.T, mux *http.ServeMux, user, slug, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rooms/"+slug+"/chat/images/"+id, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func TestChatImages(t *testing.T) {
	svc, mux, users, _ := setup(t)
	alice := users.ByToken["alice"]

	// Boundary: no auth 401, non-member 403, junk bytes 400.
	if code, _ := postImage(t, mux, "", "chat-cave", tinyPNG); code != http.StatusUnauthorized {
		t.Fatalf("unauthed upload: %d", code)
	}
	if code, _ := postImage(t, mux, "cara", "chat-cave", tinyPNG); code != http.StatusForbidden {
		t.Fatalf("non-member upload: %d", code)
	}
	if code, _ := postImage(t, mux, "alice", "chat-cave", []byte("not an image")); code != http.StatusBadRequest {
		t.Fatalf("junk upload: %d", code)
	}

	code, imgID := postImage(t, mux, "alice", "chat-cave", tinyPNG)
	if code != http.StatusOK || imgID == "" {
		t.Fatalf("upload: %d %q", code, imgID)
	}

	// Members read it back byte-for-byte; outsiders and junk ids do not.
	res := getImage(t, mux, "bob", "chat-cave", imgID)
	if res.Code != http.StatusOK || res.Header().Get("Content-Type") != "image/png" || !bytes.Equal(res.Body.Bytes(), tinyPNG) {
		t.Fatalf("serve: %d %q", res.Code, res.Header().Get("Content-Type"))
	}
	// Member bytes on our own origin: the browser must not re-sniff them.
	if res.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("blob served without nosniff")
	}
	if res := getImage(t, mux, "cara", "chat-cave", imgID); res.Code != http.StatusForbidden {
		t.Fatalf("non-member serve: %d", res.Code)
	}
	if res := getImage(t, mux, "alice", "chat-cave", "not-a-uuid"); res.Code != http.StatusNotFound {
		t.Fatalf("junk id: %d", res.Code)
	}

	// The room is the privacy boundary: the same id through another room's
	// slug must 404 even for a member of that room.
	other, err := svc.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "img-cave", Name: "Img", OwnerID: alice.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = svc.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", other.ID)
	})
	if err := svc.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: other.ID, UserID: alice.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	if res := getImage(t, mux, "alice", "img-cave", imgID); res.Code != http.StatusNotFound {
		t.Fatalf("cross-room serve: %d", res.Code)
	}

	// A line carrying the id surfaces it in the backlog.
	if _, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "", imgID); !ok {
		t.Fatal("save with image failed")
	}
	_, messages := backlog(t, mux, "alice", "chat-cave")
	last := messages[len(messages)-1]
	if last["imageId"] != imgID {
		t.Fatalf("backlog imageId: %v", last)
	}
}

func TestPruneChatImagesSweepsOnlyUnreferenced(t *testing.T) {
	svc, mux, users, room := setup(t)
	alice := users.ByToken["alice"]

	_, sent := postImage(t, mux, "alice", "chat-cave", tinyPNG)
	_, orphan := postImage(t, mux, "alice", "chat-cave", tinyPNG)
	if _, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "", sent); !ok {
		t.Fatal("save failed")
	}
	// Age both past the 15-minute grace; only the never-sent one may go.
	if _, err := svc.store.Pool.Exec(t.Context(),
		"update chat_images set created_at = now() - interval '1 hour' where room_id = $1", room.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.store.Queries.PruneChatImages(t.Context(), room.ID); err != nil {
		t.Fatal(err)
	}
	if res := getImage(t, mux, "alice", "chat-cave", sent); res.Code != http.StatusOK {
		t.Fatalf("referenced image swept: %d", res.Code)
	}
	if res := getImage(t, mux, "alice", "chat-cave", orphan); res.Code != http.StatusNotFound {
		t.Fatalf("orphan survived: %d", res.Code)
	}
}

func TestChatImageFromAnotherRoomIsRefused(t *testing.T) {
	svc, mux, users, _ := setup(t)
	alice := users.ByToken["alice"]
	other, err := svc.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "far-cave", Name: "Far", OwnerID: alice.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = svc.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", other.ID)
	})
	if err := svc.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: other.ID, UserID: alice.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	_, theirs := postImage(t, mux, "alice", "far-cave", tinyPNG)
	if theirs == "" {
		t.Fatal("upload to far-cave failed")
	}
	// Referencing it from chat-cave must not persist: serving is room-scoped
	// anyway, but the reference alone would pin the bytes past the sweep.
	if _, ok := svc.SaveChat(t.Context(), "chat-cave", store.UUIDString(alice.ID), "look", theirs); ok {
		t.Fatal("cross-room image reference accepted")
	}
	// Over HTTP the refusal is the rider's to act on (#1987): a 400 naming
	// the field, not a 500 with a retry that could never work.
	code, body := post(t, mux, "alice", "/api/rooms/chat-cave/chat", `{"text":"look","imageId":"`+theirs+`"}`)
	if code != http.StatusBadRequest || body["field"] != "imageId" {
		t.Fatalf("foreign image over http: %d %v", code, body)
	}
}

// One account's writes through the HTTP door are bounded (#1982) the way the
// socket's and the DM door's are: posts, edits and reactions share a minute,
// uploads an hour, and another member is not held back by it.
func TestChatWritesAreBoundedPerAccount(t *testing.T) {
	svc, mux, _, _ := setup(t)
	svc.lines = budget.New[pgtype.UUID](2, time.Minute)
	svc.uploads = budget.New[pgtype.UUID](1, time.Hour)

	var id string
	for i := 0; i < 2; i++ {
		code, body := post(t, mux, "alice", "/api/rooms/chat-cave/chat", `{"text":"hi"}`)
		if code != http.StatusOK {
			t.Fatalf("post %d: %d %v", i, code, body)
		}
		id, _ = body["id"].(string)
	}
	code, body := post(t, mux, "alice", "/api/rooms/chat-cave/chat", `{"text":"one more"}`)
	if code != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("the third line in a minute: %d %v", code, body)
	}
	if code, _ := post(t, mux, "alice", "/api/rooms/chat-cave/chat/reactions", `{"messageId":"`+id+`","emoji":"🔥"}`); code != http.StatusTooManyRequests {
		t.Fatalf("a reaction past the ceiling: %d", code)
	}
	if code, _ := post(t, mux, "bob", "/api/rooms/chat-cave/chat", `{"text":"still here"}`); code != http.StatusOK {
		t.Fatalf("bob held back by alice's ceiling: %d", code)
	}
	if _, img := postImage(t, mux, "alice", "chat-cave", tinyPNG); img == "" {
		t.Fatal("first upload refused")
	}
	if code, _ := postImage(t, mux, "alice", "chat-cave", tinyPNG); code != http.StatusTooManyRequests {
		t.Fatalf("the second upload in an hour: %d", code)
	}
}
