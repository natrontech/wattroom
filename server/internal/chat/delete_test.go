package chat

import (
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Deleting a line (#2417). Until this, a rider who said the wrong thing could
// only edit it, which leaves a line that visibly used to say something else —
// no use at all for a password pasted into the wrong channel.
func TestDeleteChannelMessage(t *testing.T) {
	w := channelSetup(t)
	alice := w.users.ByToken["alice"]
	mine := w.say(t, "bob", w.open, "oops, my password is hunter2")
	before := w.pings()

	cases := []struct {
		name string
		user string
		path string
		want int
	}{
		{"signed out", "", mine, http.StatusUnauthorized},
		// 404, not 403: outside the crew the channel is not a thing to refuse.
		{"not in the crew", "dave", mine, http.StatusNotFound},
		{"junk id", "bob", "not-a-uuid", http.StatusNotFound},
		{"unknown message", "bob", store.UUIDString(alice.ID), http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if code, body := del(t, w.mux, c.user, "/api/channels/"+w.open+"/chat/"+c.path); code != c.want {
				t.Fatalf("%d %v, want %d", code, body, c.want)
			}
		})
	}
	// A channel that is not there must not be an oracle either.
	if code, _ := del(t, w.mux, "bob", "/api/channels/not-a-channel/chat/"+mine); code != http.StatusNotFound {
		t.Fatalf("unknown channel: %d", code)
	}
	if n := w.pings() - before; n != 0 {
		t.Fatalf("a refused delete pinged the lobby %d times", n)
	}

	// The author's own: gone from the log, and the lobby is pinged so the line
	// leaves the screen of everyone showing the channel.
	if code, body := del(t, w.mux, "bob", "/api/channels/"+w.open+"/chat/"+mine); code != http.StatusNoContent {
		t.Fatalf("bob deleting his own: %d %v", code, body)
	}
	if n := w.pings() - before; n != 1 {
		t.Fatalf("the delete pinged the lobby %d times, want 1", n)
	}
	if messages := w.messages(t, "alice", w.open); len(messages) != 0 {
		t.Fatalf("backlog still holds it: %v", messages)
	}
	// Deleting it twice is a 404, not a second ping: the line is gone, and
	// telling the lobby again would be about nothing.
	if code, _ := del(t, w.mux, "bob", "/api/channels/"+w.open+"/chat/"+mine); code != http.StatusNotFound {
		t.Fatalf("second delete should 404")
	}
	if n := w.pings() - before; n != 1 {
		t.Fatalf("a no-op delete pinged the lobby: %d pings", n)
	}
}

// Who may delete whose. The reach over other people's lines is the half of
// moderation a ban was missing — it severs the griefer and left their words
// up — and it belongs to whoever keeps the crew's channels: its owner and its
// admins (ADR-0058). The owner's reach is TestEditAndDeleteInAChannel's.
func TestDeleteChannelMessagePermissions(t *testing.T) {
	w := channelSetup(t)
	bobs := w.say(t, "bob", w.open, "bringing cake")
	alices := w.say(t, "alice", w.open, "see you at seven")

	// A plain member may not touch someone else's line. 403, not 404: bob can
	// see the channel and the line, so the honest answer is that it is not his.
	if code, body := del(t, w.mux, "bob", "/api/channels/"+w.open+"/chat/"+alices); code != http.StatusForbidden {
		t.Fatalf("bob deleting alice's: %d %v, want 403", code, body)
	}
	if got := w.lines(t, "alice", w.open); len(got) != 2 {
		t.Fatalf("a refused delete removed something: %v", got)
	}

	// An admin may delete anyone's.
	w.setRole(t, "cara", "admin")
	if code, body := del(t, w.mux, "cara", "/api/channels/"+w.open+"/chat/"+bobs); code != http.StatusNoContent {
		t.Fatalf("an admin deleting bob's: %d %v", code, body)
	}
	if got := w.lines(t, "alice", w.open); len(got) != 1 || got[0] != "see you at seven" {
		t.Fatalf("backlog after the admin's delete: %v", got)
	}
}

// The channel's announcement is a pointer to a line, and the FK sets it to
// null when the line goes. Without that the channel would point at a row that
// is not there — and the notice is a quote, so it cannot outlive the sentence
// it quotes.
func TestDeletingTheAnnouncedLineTakesTheNoticeDown(t *testing.T) {
	w := channelSetup(t)
	channel := w.channelID(t, w.open)
	id := w.say(t, "alice", w.open, "no session Thursday")
	marked, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if rows, err := w.svc.store.Queries.SetChannelAnnouncement(t.Context(), db.SetChannelAnnouncementParams{
		ChannelID: channel, MessageID: marked,
	}); err != nil || rows != 1 {
		t.Fatalf("mark: %d %v", rows, err)
	}
	if code, body := del(t, w.mux, "alice", "/api/channels/"+w.open+"/chat/"+id); code != http.StatusNoContent {
		t.Fatalf("delete: %d %v", code, body)
	}
	if _, err := w.svc.store.Queries.GetChannelAnnouncement(t.Context(), channel); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("the notice outlived the line it quotes: %v", err)
	}
}
