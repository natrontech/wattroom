package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
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

// A hidden rider's chalk never reaches the rider who hid them (#4152). An
// initial chalked across the pair is the painter's alone, as a cheer aimed
// across it is: on their road and nobody else's, and they are never told.
func TestChalkNeverCrossesAHiddenPair(t *testing.T) {
	h, clock, url := controlHub(t)
	h.SetHider(hidPair{"jan", "sven"})
	h.SetRoads(fakeRoads{heights: hills().Heights})
	jan, sven, kai := dial(t, url, "jan:owner"), dial(t, url, "sven:member"), dial(t, url, "kai:member")
	eventually(t, "three riders joined", func() bool {
		return h.Presence("velvet").Connected == 3
	})
	sendControl(t, jan, protocol.Control{
		Action: "pick", WorkoutName: "Over the hills", TotalSeconds: 900,
		WorkoutJSON: `{"steps":[{"type":"road","seconds":900}]}`,
		Route:       &protocol.ControlRoute{ID: homeLoop},
	})
	awaitFrame(t, kai, "the road picked", routeTick)
	clock.Add(int64(controlMinGap))
	sendControl(t, jan, protocol.Control{Action: "start"})
	awaitFrame(t, kai, "the countdown", func(msg protocol.ServerMessage) bool {
		return msg.Tick != nil && msg.Tick.State.Phase == "countdown"
	})

	chalk := func(conn *websocket.Conn, verb protocol.Roadside) {
		t.Helper()
		if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Roadside: &verb}); err != nil {
			t.Fatalf("chalk: %v", err)
		}
	}
	painted := func(by string, stamp protocol.RoadsideStamp) func(protocol.ServerMessage) bool {
		return func(msg protocol.ServerMessage) bool {
			return msg.Tick != nil && msg.Tick.Roadside != nil && slices.ContainsFunc(msg.Tick.Roadside.Paint, func(p protocol.RoadsidePaint) bool {
				return p.RiderID == by && p.Stamp == stamp
			})
		}
	}
	initial := paint(protocol.RoadsideStampInitial, 1500)
	initial.For = "jan"
	chalk(sven, initial)
	// The painter sees it, and no refusal: awaitFrame fails on one.
	awaitFrame(t, sven, "sven's initial for jan", painted("sven", protocol.RoadsideStampInitial))
	clock.Add(int64(controlMinGap))
	chalk(sven, paint(protocol.RoadsideStampHeart, 5000))
	awaitFrame(t, sven, "sven's heart", painted("sven", protocol.RoadsideStampHeart))
	// Painted after sven's: every frame carrying kai's heart carries sven's
	// two stamps too, wherever they are not cut.
	chalk(kai, paint(protocol.RoadsideStampHeart, 1600))

	for _, c := range []struct {
		name string
		conn *websocket.Conn
		want []string
	}{
		{"sven", sven, []string{"sven initial jan", "sven heart", "kai heart"}},
		{"jan", jan, []string{"kai heart"}},
		{"kai", kai, []string{"sven heart", "kai heart"}},
	} {
		seen := awaitFrame(t, c.conn, c.name+"'s copy of kai's heart", painted("kai", protocol.RoadsideStampHeart))
		var got []string
		for _, p := range seen.Tick.Roadside.Paint {
			got = append(got, strings.TrimSpace(p.RiderID+" "+string(p.Stamp)+" "+p.For))
		}
		if !slices.Equal(got, c.want) {
			t.Fatalf("%s's road reads %q, want %q", c.name, got, c.want)
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
