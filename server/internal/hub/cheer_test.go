package hub

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// cheerRoom is a voice channel holding `ids`, and a hub whose clock reads `now`.
func cheerRoom(now *time.Time, ids ...string) (*Hub, *channelState, map[string]*client) {
	h := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil)
	h.now = func() time.Time { return *now }
	rm := newChannelState("velvet")
	socks := map[string]*client{}
	for _, id := range ids {
		c := &client{rider: protocol.Rider{ID: id, Name: id}}
		rm.clients[c] = struct{}{}
		socks[id] = c
	}
	return h, rm, socks
}

func cheerFrom(h *Hub, rm *channelState, c *client, to string) {
	h.handleMessage(c, rm, "velvet", c.rider, protocol.ClientMessage{
		Cheer: &protocol.Cheer{Emoji: "thumbs-up", To: to},
	})
}

// A cheer for one rider (#3116) is a cheer: one a second per sender, shared
// with every other cheer they send, and 32 a tick for the channel. One that
// names nobody else here drops without spending the sender's second.
func TestACheerForOneRiderKeepsTheCheerLimits(t *testing.T) {
	now := time.Unix(100, 0)
	h, rm, socks := cheerRoom(&now, "jan", "sven")

	cheerFrom(h, rm, socks["jan"], "sven")
	if len(rm.cheers) != 1 || rm.cheers[0] != (protocol.Cheer{Emoji: "thumbs-up", From: "jan", To: "sven"}) {
		t.Fatalf("the cheer for sven: %+v", rm.cheers)
	}
	now = now.Add(400 * time.Millisecond)
	cheerFrom(h, rm, socks["jan"], "")
	cheerFrom(h, rm, socks["jan"], "sven")
	if len(rm.cheers) != 1 {
		t.Fatalf("a second cheer inside jan's second landed: %+v", rm.cheers)
	}

	now = now.Add(time.Second)
	cheerFrom(h, rm, socks["jan"], "jan")
	cheerFrom(h, rm, socks["jan"], "kai")
	if len(rm.cheers) != 1 {
		t.Fatalf("a cheer for yourself, or for nobody here, landed: %+v", rm.cheers)
	}
	cheerFrom(h, rm, socks["jan"], " sven ")
	if len(rm.cheers) != 2 || rm.cheers[1].To != "sven" {
		t.Fatalf("a cheer that missed spent jan's second: %+v", rm.cheers)
	}

	crowd := []string{"sven"}
	for i := range 40 {
		crowd = append(crowd, string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	h, rm, socks = cheerRoom(&now, crowd...)
	for _, id := range crowd[1:] {
		cheerFrom(h, rm, socks[id], "sven")
	}
	if len(rm.cheers) != 32 {
		t.Fatalf("a tick's cheers for one rider: %d, want 32", len(rm.cheers))
	}
}

// Across a hidden pair a cheer for one rider is drawn for its sender alone:
// neither the rider it names nor anybody else sees it, and the sender is never
// told (#3202). A cheer for everyone still reaches the bystander.
func TestACheerForOneRiderNeverCrossesAHiddenPair(t *testing.T) {
	rm := newChannelState("velvet")
	rm.hider = hidPair{"jan", "sven"}
	cheers := []protocol.Cheer{
		{Emoji: "thumbs-up", From: "jan", To: "sven"},
		{Emoji: "flame", From: "jan"},
		{Emoji: "thumbs-up", From: "kai", To: "sven"},
	}
	from := []string{"jan", "jan", "kai"}
	for _, c := range []struct {
		to   string
		want int
	}{{"jan", 3}, {"sven", 1}, {"kai", 2}} {
		got, _ := rm.cheersFor(c.to, cheers, from)
		if len(got) != c.want {
			t.Errorf("%s hears %+v, want %d cheers", c.to, got, c.want)
		}
	}
}
