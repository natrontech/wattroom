package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// del runs one DELETE as a user ("" = signed out).
func del(t *testing.T, mux *http.ServeMux, user, path string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, path, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

// Deleting a line (#2417). Until this, a rider who said the wrong thing could
// only edit it, which leaves a line that visibly used to say something else —
// no use at all for a password pasted into the wrong room.
func TestDeleteChatMessage(t *testing.T) {
	svc, mux, users, room := setup(t)
	live := &fakeLive{}
	svc.SetLive(live)
	alice := users.ByToken["alice"] // the room's owner
	bob := users.ByToken["bob"]

	mine, ok := svc.saveChat(t.Context(), room.ID, room.Slug, store.UUIDString(bob.ID), "oops, my password is hunter2", "", time.Now().UnixMilli())
	if !ok {
		t.Fatal("save failed")
	}

	cases := []struct {
		name string
		user string
		path string
		want int
	}{
		{"signed out", "", mine, http.StatusUnauthorized},
		// 403, not 404: chat answers a non-member the way the edit does —
		// the room is not a secret, membership is the gate.
		{"non-member", "cara", mine, http.StatusForbidden},
		{"junk id", "bob", "not-a-uuid", http.StatusNotFound},
		{"unknown message", "bob", store.UUIDString(alice.ID), http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := del(t, mux, c.user, "/api/rooms/"+room.Slug+"/chat/"+c.path); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	// A room the caller is not in must not be an oracle either.
	if code, _ := del(t, mux, "bob", "/api/rooms/no-such-room/chat/"+mine); code != http.StatusNotFound {
		t.Fatalf("unknown room: %d", code)
	}
	if live.pings != 0 {
		t.Fatalf("a refused delete pinged the lobby %d times", live.pings)
	}

	// The author's own: gone from the log, and the lobby is pinged so the line
	// leaves the screen of everyone showing the room.
	if code, body := del(t, mux, "bob", "/api/rooms/"+room.Slug+"/chat/"+mine); code != http.StatusNoContent {
		t.Fatalf("bob deleting his own: %d %v", code, body)
	}
	if live.pings != 1 {
		t.Fatalf("the delete pinged the lobby %d times, want 1", live.pings)
	}
	if _, messages := backlog(t, mux, "alice", room.Slug); len(messages) != 0 {
		t.Fatalf("backlog still holds it: %v", messages)
	}
	// Deleting it twice is a 404, not a second broadcast: the line is gone,
	// and telling the room again would be about nothing.
	if code, _ := del(t, mux, "bob", "/api/rooms/"+room.Slug+"/chat/"+mine); code != http.StatusNotFound {
		t.Fatalf("second delete should 404")
	}
	if live.pings != 1 {
		t.Fatalf("a no-op delete pinged the lobby: %d pings", live.pings)
	}
}

// Who may delete whose. The owner's reach over other people's lines is the
// half of moderation a ban was missing — it severs the griefer and left their
// words up — and a coach deliberately does not get it: docs/SPEC.md's matrix
// gives moderation to the owner, and a coach runs sessions.
func TestDeleteChatMessagePermissions(t *testing.T) {
	svc, mux, users, room := setup(t)
	svc.SetLive(&fakeLive{})
	bob := users.ByToken["bob"]
	alice := users.ByToken["alice"] // owns the room

	bobs, ok := svc.saveChat(t.Context(), room.ID, room.Slug, store.UUIDString(bob.ID), "bringing cake", "", time.Now().UnixMilli())
	if !ok {
		t.Fatal("save failed")
	}
	// cara is not a member at all, which is answered before the question of
	// whose line it is arises.
	if code, body := del(t, mux, "cara", "/api/rooms/"+room.Slug+"/chat/"+bobs); code != http.StatusForbidden {
		t.Fatalf("non-member: %d %v, want 403", code, body)
	}

	// A plain member may not touch someone else's line. 403, not 404: bob can
	// see the room and the line, so the honest answer is that it is not his.
	alices, _ := svc.saveChat(t.Context(), room.ID, room.Slug, store.UUIDString(alice.ID), "see you at seven", "", time.Now().UnixMilli())
	if code, body := del(t, mux, "bob", "/api/rooms/"+room.Slug+"/chat/"+alices); code != http.StatusForbidden {
		t.Fatalf("bob deleting alice's: %d %v, want 403", code, body)
	}
	if _, messages := backlog(t, mux, "alice", room.Slug); len(messages) != 2 {
		t.Fatalf("a refused delete removed something: %v", messages)
	}

	// The owner may delete anyone's.
	if code, body := del(t, mux, "alice", "/api/rooms/"+room.Slug+"/chat/"+bobs); code != http.StatusNoContent {
		t.Fatalf("alice deleting bob's: %d %v", code, body)
	}
	_, messages := backlog(t, mux, "alice", room.Slug)
	if len(messages) != 1 || messages[0]["text"] != "see you at seven" {
		t.Fatalf("backlog after the owner's delete: %v", messages)
	}
}

// The line a coach marked is the room's announcement, and the FK sets the
// pointer to null when it goes. Without that the room would point at a row
// that is not there — and the notice is a quote, so it cannot outlive the
// sentence it quotes.
func TestDeletingTheAnnouncedLineTakesTheNoticeDown(t *testing.T) {
	svc, mux, users, room := setup(t)
	svc.SetLive(&fakeLive{})
	alice := users.ByToken["alice"]
	id, ok := svc.saveChat(t.Context(), room.ID, room.Slug, store.UUIDString(alice.ID), "no session Thursday", "", time.Now().UnixMilli())
	if !ok {
		t.Fatal("save failed")
	}
	marked, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if _, err := svc.store.Queries.SetRoomAnnouncement(t.Context(), db.SetRoomAnnouncementParams{
		RoomID: room.ID, MessageID: marked,
	}); err != nil {
		t.Fatalf("mark: %v", err)
	}
	if code, body := del(t, mux, "alice", "/api/rooms/"+room.Slug+"/chat/"+id); code != http.StatusNoContent {
		t.Fatalf("delete: %d %v", code, body)
	}
	if _, err := svc.store.Queries.GetRoomAnnouncement(t.Context(), room.ID); err == nil {
		t.Fatal("the notice outlived the line it quotes")
	}
}
