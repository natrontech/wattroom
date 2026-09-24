package chat

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestPostChannelChat(t *testing.T) {
	w := channelSetup(t)
	alice := w.users.ByToken["alice"]

	// Boundary: no auth 401, outside the crew and an unknown channel 404, and
	// the line's own validation as 400s.
	cases := []struct {
		name    string
		user    string
		channel string
		body    string
		want    int
	}{
		{"signed out", "", w.open, `{"text":"hi"}`, http.StatusUnauthorized},
		{"not in the crew", "dave", w.open, `{"text":"hi"}`, http.StatusNotFound},
		{"unknown channel", "alice", "not-a-channel", `{"text":"hi"}`, http.StatusNotFound},
		{"nothing to say", "alice", w.open, `{"text":"   "}`, http.StatusBadRequest},
		{"too long", "alice", w.open, `{"text":"` + strings.Repeat("ü", 501) + `"}`, http.StatusBadRequest},
		{"junk image", "alice", w.open, `{"text":"look","imageId":"nope"}`, http.StatusBadRequest},
		{"unknown field", "alice", w.open, `{"text":"hi","from":"spoof"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, w.mux, c.user, "/api/channels/"+c.channel+"/chat", c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	if n := w.pings(); n != 0 {
		t.Fatalf("a refused post pinged the lobby %d times", n)
	}

	// Happy: the line is persisted and answered with its id — reactions work
	// at once — and the lobby is pinged so the channel is re-read.
	code, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"  queue this one  "}`)
	if code != http.StatusOK {
		t.Fatalf("post: %d %v", code, body)
	}
	id, _ := body["id"].(string)
	if id == "" || body["from"] != "alice" || body["fromId"] != store.UUIDString(alice.ID) || body["text"] != "queue this one" {
		t.Fatalf("posted line: %v", body)
	}
	if n := w.pings(); n != 1 {
		t.Fatalf("the post pinged the lobby %d times, want 1", n)
	}
	if messages := w.messages(t, "bob", w.open); len(messages) != 1 || messages[0]["id"] != id {
		t.Fatalf("backlog: %v", messages)
	}
	// Saying something is reading up to it: alice's stamp is set, bob's is not.
	if w.readAt(t, "alice", w.open) == 0 {
		t.Fatal("poster's read stamp not set")
	}
	if w.readAt(t, "bob", w.open) != 0 {
		t.Fatal("a reader who never opened the channel has a read stamp")
	}
}

func TestReactionBoundariesInAChannel(t *testing.T) {
	w := channelSetup(t)
	id := w.say(t, "bob", w.open, "in")
	before := w.pings()
	react := "/api/channels/" + w.open + "/chat/reactions"

	cases := []struct {
		name string
		user string
		body string
		want int
	}{
		{"signed out", "", `{"messageId":"` + id + `","emoji":"flame"}`, http.StatusUnauthorized},
		{"not in the crew", "dave", `{"messageId":"` + id + `","emoji":"flame"}`, http.StatusNotFound},
		{"not a reaction", "alice", `{"messageId":"` + id + `","emoji":"<script>"}`, http.StatusBadRequest},
		{"no such message", "alice", `{"messageId":"not-a-uuid","emoji":"flame"}`, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, w.mux, c.user, react, c.body); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	if code, _ := post(t, w.mux, "alice", "/api/channels/not-a-channel/chat/reactions", `{"messageId":"`+id+`","emoji":"flame"}`); code != http.StatusNotFound {
		t.Fatalf("unknown channel: %d", code)
	}
	if n := w.pings() - before; n != 0 {
		t.Fatalf("a refused reaction pinged the lobby %d times", n)
	}

	// On, then off: the lobby hears both.
	for _, want := range []float64{1, 0} {
		if code, body := post(t, w.mux, "alice", react, `{"messageId":"`+id+`","emoji":"flame"}`); code != http.StatusOK || body["count"] != want {
			t.Fatalf("toggle to %v: %d %v", want, code, body)
		}
	}
	if n := w.pings() - before; n != 2 {
		t.Fatalf("two toggles pinged the lobby %d times, want 2", n)
	}
	// Any emoji the picker offers, and the crew's own by `:name:` (#2643).
	for _, emoji := range []string{"1️⃣", ":party_parrot:"} {
		if code, body := post(t, w.mux, "alice", react, fmt.Sprintf(`{"messageId":%q,"emoji":%q}`, id, emoji)); code != http.StatusOK || body["count"] != float64(1) {
			t.Fatalf("react %s: %d %v", emoji, code, body)
		}
	}
}

func TestMarkChannelRead(t *testing.T) {
	w := channelSetup(t)
	bob := w.users.ByToken["bob"]
	channel := w.channelID(t, w.open)
	w.say(t, "alice", w.open, "warm-up at 7?")

	for _, c := range []struct {
		name    string
		user    string
		channel string
		want    int
	}{
		{"signed out", "", w.open, http.StatusUnauthorized},
		{"not in the crew", "dave", w.open, http.StatusNotFound},
		{"unknown channel", "bob", "not-a-channel", http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			if code, body := post(t, w.mux, c.user, "/api/channels/"+c.channel+"/read", ""); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}

	// Bob has never opened the channel: everything is new, no stamp.
	unread := func() int32 {
		rows, err := w.svc.store.Queries.UnreadByChannel(t.Context(), db.UnreadByChannelParams{
			UserID: bob.ID, ChannelIds: []pgtype.UUID{channel},
		})
		if err != nil {
			t.Fatal(err)
		}
		var n int32
		for _, row := range rows {
			n += row.Unread
		}
		return n
	}
	if unread() != 1 || w.readAt(t, "bob", w.open) != 0 {
		t.Fatalf("before: unread %d readAt %v", unread(), w.readAt(t, "bob", w.open))
	}
	w.lobby.mu.Lock()
	w.lobby.reads = nil
	w.lobby.mu.Unlock()
	if code, body := post(t, w.mux, "bob", "/api/channels/"+w.open+"/read", ""); code != http.StatusNoContent {
		t.Fatalf("read: %d %v", code, body)
	}
	if unread() != 0 || w.readAt(t, "bob", w.open) == 0 {
		t.Fatalf("after: unread %d readAt %v", unread(), w.readAt(t, "bob", w.open))
	}
	// Bob's other devices hear it, so their badge clears too (#2711) — and
	// only Bob's: the read is pinged to its reader, never to the channel.
	w.lobby.mu.Lock()
	reads := append([]string(nil), w.lobby.reads...)
	w.lobby.mu.Unlock()
	if want := []string{store.UUIDString(bob.ID)}; !slices.Equal(reads, want) {
		t.Fatalf("read pinged %v, want %v", reads, want)
	}
}
