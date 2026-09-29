package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// hidPair is a block list of one pair, either way round.
type hidPair [2]string

func (p hidPair) Hidden(a, b string) bool {
	return (a == p[0] && b == p[1]) || (a == p[1] && b == p[0])
}

func hiddenHub(t *testing.T, pair hidPair) (*Hub, string) {
	t.Helper()
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetHider(pair)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"
}

// tickWithCheers reads until a tick carrying cheers arrives, and returns it.
func tickWithCheers(t *testing.T, conn *websocket.Conn) protocol.ServerTick {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("read tick: %v", err)
		}
		if msg.Tick != nil && len(msg.Tick.Cheers) > 0 {
			return *msg.Tick
		}
	}
}

// cheersUpTo gathers every cheer a socket is sent in ticks up to `at`.
func cheersUpTo(t *testing.T, conn *websocket.Conn, at int64) []protocol.Cheer {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	var got []protocol.Cheer
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			t.Fatalf("read tick: %v", err)
		}
		if msg.Tick == nil {
			continue
		}
		got = append(got, msg.Tick.Cheers...)
		if msg.Tick.At >= at {
			return got
		}
	}
}

// A hidden pair shares a voice channel — hiding never parts a crew — but
// neither's cheers reach the other (#3202). Everyone else hears both.
func TestCheersNeverCrossAHiddenPair(t *testing.T) {
	h, url := hiddenHub(t, hidPair{"jan", "sven"})
	jan := dial(t, url, "jan:member")
	sven := dial(t, url, "sven:member")
	kai := dial(t, url, "kai:member")
	eventually(t, "three riders joined", func() bool {
		return h.Presence("velvet").Connected == 3
	})

	for _, c := range []struct {
		from     *websocket.Conn
		name     string
		hiddenTo *websocket.Conn
	}{{sven, "sven", jan}, {jan, "jan", sven}} {
		if err := wsjson.Write(t.Context(), c.from, protocol.ClientMessage{
			Cheer: &protocol.Cheer{Emoji: "flame"},
		}); err != nil {
			t.Fatalf("cheer: %v", err)
		}
		seen := tickWithCheers(t, kai)
		if len(seen.Cheers) != 1 || seen.Cheers[0].From != c.name {
			t.Fatalf("a bystander should hear %s's cheer: %+v", c.name, seen.Cheers)
		}
		if got := cheersUpTo(t, c.hiddenTo, seen.At); len(got) != 0 {
			t.Fatalf("%s's cheer reached the rider hidden from them: %+v", c.name, got)
		}
		// The sender's own copy is theirs to see.
		if got := cheersUpTo(t, c.from, seen.At); len(got) != 1 {
			t.Fatalf("%s's own cheer: %+v", c.name, got)
		}
	}
}

// A poke across a hidden pair lands nowhere, and the sender is answered as if
// it had — the blocked rider is never told (#3202).
func TestPokeAcrossAHiddenPairLandsNowhereAndSaysNothing(t *testing.T) {
	h, url := hiddenHub(t, hidPair{"jan", "sven"})
	jan := dial(t, url, "jan:member")
	sven := dial(t, url, "sven:member")
	kai := dial(t, url, "kai:member")
	eventually(t, "three riders joined", func() bool {
		return h.Presence("velvet").Connected == 3
	})

	if err := wsjson.Write(t.Context(), sven, protocol.ClientMessage{
		Poke: &protocol.Poke{To: "jan"},
	}); err != nil {
		t.Fatalf("poke: %v", err)
	}
	if got := readPoke(t, sven); got.To != "jan" || got.FromID != "sven" {
		t.Fatalf("the hidden sender's answer should read as landed: %+v", got)
	}
	// A poke from a bystander after it: whatever reaches jan first would be
	// sven's, had it been queued.
	if err := wsjson.Write(t.Context(), kai, protocol.ClientMessage{
		Poke: &protocol.Poke{To: "jan"},
	}); err != nil {
		t.Fatalf("poke: %v", err)
	}
	if got := readPoke(t, jan); got.FromID != "kai" {
		t.Fatalf("a hidden rider's poke reached jan: %+v", got)
	}
}
