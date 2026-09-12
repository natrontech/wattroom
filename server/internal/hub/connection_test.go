package hub

import (
	"context"
	"encoding/json"
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

// dialFrom is dial() with the address a proxy would have put on the request.
// The room socket reads it with httpx.ClientIP, so this is the last hop.
func dialFrom(t *testing.T, url, rider, ip string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"X-Rider":         []string{rider},
			"X-Forwarded-For": []string{ip},
		},
	})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("dial as %q: %v", rider, err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}

// readMessages drains n frames, whatever they are — the connection answer and
// the ticks arrive on the one socket and a test about either has to see both.
func readMessages(t *testing.T, conn *websocket.Conn, n int) []protocol.ServerMessage {
	t.Helper()
	out := make([]protocol.ServerMessage, 0, n)
	for len(out) < n {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, conn, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		out = append(out, msg)
	}
	return out
}

// A rider's public address goes to the rider's own socket and to no other
// (#2131) — the one fact in a room that is visible to exactly one person.
//
// The failure this guards is silent by nature: an address folded onto
// protocol.Rider would render correctly on the rider's own panel, pass every
// test that asserts the tick's shape, and publish everybody's address to the
// whole room with nothing anywhere going red. So this asserts the absence as
// well as the presence, over the wire, on the bytes the other rider's socket
// actually received.
func TestAnAddressReachesItsOwnSocketAndNoOther(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	const janIP, kimIP = "203.0.113.7", "198.51.100.4"
	jan := dialFrom(t, url, "jan:owner", janIP)
	// Jan's own address arrives first, before any tick: it is queued on the
	// socket at join.
	first := readMessages(t, jan, 1)[0]
	if first.Connection == nil {
		t.Fatalf("jan's first message carried no connection answer: %+v", first)
	}
	if first.Connection.IP != janIP {
		t.Errorf("jan was told %q, want the proxy's last hop %q", first.Connection.IP, janIP)
	}

	kim := dialFrom(t, url, "kim:member", kimIP)
	if own := readMessages(t, kim, 1)[0]; own.Connection == nil || own.Connection.IP != kimIP {
		t.Fatalf("kim's first message was not kim's own address: %+v", own)
	}

	// Now the room is two riders and ticking. Nothing kim receives from here
	// on may carry jan's address, in any field, at any depth — and the roster
	// kim receives has to actually name jan, or the assertion below is vacuous.
	named := false
	for _, msg := range readMessages(t, kim, 6) {
		if msg.Connection != nil && msg.Connection.IP != kimIP {
			t.Fatalf("kim was told an address that is not kim's: %q", msg.Connection.IP)
		}
		frame, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if strings.Contains(string(frame), janIP) {
			t.Fatalf("jan's address rode a message to kim: %s", frame)
		}
		if msg.Tick != nil {
			for _, rider := range msg.Tick.Roster {
				if rider.ID == "jan" {
					named = true
				}
			}
		}
	}
	if !named {
		t.Fatal("kim never saw jan on the roster, so the leak check proved nothing")
	}
}

// The round trip the keepalive measures reaches the roster, so one rider can
// see another's ping (#2131). The peer only has to READ: pongs are answered
// from a coder/websocket client's read loop.
func TestARidersPingReachesTheRoster(t *testing.T) {
	_, base := keepaliveHub(t)
	url := base + "/ws/rooms/velvet"
	jan := dial(t, url, "jan:owner")
	go func() {
		for {
			if _, _, err := jan.Read(t.Context()); err != nil {
				return
			}
		}
	}()
	kim := dial(t, url, "kim:member")

	// Kim watches jan, not themselves: the number a rider reads about someone
	// else is the one that had to come from the server rather than the client.
	deadline := time.Now().Add(3 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatal("jan's ping never reached kim's roster")
		}
		tick := readTick(t, kim)
		for _, rider := range tick.Roster {
			if rider.ID == "jan" && rider.PingMs > 0 {
				return
			}
		}
	}
}

// A rider is several screens, and the roster is one entry per rider: what it
// says about them is their BEST socket, and the ping and the device word come
// from that same one — never 12 ms from the laptop and "phone" from the
// handset beside it.
//
// Driven through the client records rather than through two real connections,
// because the point is the fold and not the network: two loopback sockets have
// the same round trip by construction.
func TestARidersRosterEntryIsOneScreen(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	dial(t, url, "jan:owner")
	dial(t, url, "jan:owner")
	watcher := dial(t, url, "kim:member")
	eventually(t, "both of jan's screens joined", func() bool {
		rm := h.room("velvet")
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 3
	})

	// The slow screen is the phone, the quick one the desk. The roster has to
	// report 12 ms AND "desktop": taking the lowest ping from one socket and
	// the device word from whichever the map yielded first is the bug.
	rm := h.room("velvet")
	rm.mu.Lock()
	jans := make([]*client, 0, 2)
	for c := range rm.clients {
		if c.rider.ID == "jan" {
			jans = append(jans, c)
		}
	}
	jans[0].rttMicros.Store(80_000)
	jans[0].deviceKind = "phone"
	jans[1].rttMicros.Store(12_000)
	jans[1].deviceKind = "desktop"
	rm.mu.Unlock()

	tick := readTick(t, watcher)
	entries := 0
	for _, rider := range tick.Roster {
		if rider.ID != "jan" {
			continue
		}
		entries++
		if rider.PingMs != 12 {
			t.Errorf("jan's ping is %d ms, want the best of 12 and 80", rider.PingMs)
		}
		if rider.Device != "desktop" {
			t.Errorf("jan is on %q, want the device of the socket the ping came from", rider.Device)
		}
	}
	if entries != 1 {
		t.Errorf("jan has %d roster entries, want one for two screens", entries)
	}
}

// A socket that has not been pinged yet must not silence a sibling that has,
// and must still be able to say what it is running on: a rider joining from
// one screen has no reading for the first few seconds, and a device word that
// blinks in only once a ping lands is the panel looking broken on arrival.
func TestAnUnmeasuredSocketStillNamesItsDevice(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	jan := dial(t, url, "jan:owner")
	watcher := dial(t, url, "kim:member")
	eventually(t, "jan joined", func() bool {
		rm := h.room("velvet")
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 2
	})
	if err := wsjson.Write(t.Context(), jan, protocol.ClientMessage{
		Device: &protocol.DeviceKind{Kind: "phone"},
	}); err != nil {
		t.Fatalf("send device: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatal("jan never read as a phone on kim's roster")
		}
		tick := readTick(t, watcher)
		for _, rider := range tick.Roster {
			if rider.ID != "jan" || rider.Device == "" {
				continue
			}
			if rider.Device != "phone" {
				t.Fatalf("jan reads as %q, want phone", rider.Device)
			}
			// No ping yet on this hub's 30 s schedule, and the word arrived
			// anyway — which is the whole point.
			if rider.PingMs != 0 {
				t.Fatalf("jan has a ping of %d ms on a hub that cannot have measured one", rider.PingMs)
			}
			return
		}
	}
}

// The device word is a closed set (#2131): the room renders it, so a client
// cannot write whatever it likes on everybody's screen. An unknown word is
// dropped rather than stored — the label goes absent, never wrong.
func TestADeviceWordOutsideTheSetIsNotStored(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

	jan := dial(t, url, "jan:owner")
	eventually(t, "jan joined", func() bool {
		rm := h.room("velvet")
		rm.mu.Lock()
		defer rm.mu.Unlock()
		return len(rm.clients) == 1
	})
	for _, forged := range []string{
		"<script>alert(1)</script>",
		"Supercalifragilistic workstation with a very long name",
		"DESKTOP",
		"",
	} {
		if err := wsjson.Write(t.Context(), jan, protocol.ClientMessage{
			Device: &protocol.DeviceKind{Kind: forged},
		}); err != nil {
			t.Fatalf("send device %q: %v", forged, err)
		}
	}
	// The last honest word still lands, which is what proves the refusals
	// above were refusals and not the whole path being dead.
	if err := wsjson.Write(t.Context(), jan, protocol.ClientMessage{
		Device: &protocol.DeviceKind{Kind: "tablet"},
	}); err != nil {
		t.Fatalf("send tablet: %v", err)
	}
	eventually(t, "only the known word was stored", func() bool {
		rm := h.room("velvet")
		rm.mu.Lock()
		defer rm.mu.Unlock()
		for c := range rm.clients {
			return c.deviceKind == "tablet"
		}
		return false
	})
}

// Rounding, where the two ends of the range both matter: a LAN round trip
// must not read as "never measured", and "never measured" must not read as a
// round trip of zero.
func TestPingRoundsWithoutLosingTheDifferenceBetweenFastAndUnknown(t *testing.T) {
	for _, tc := range []struct {
		name   string
		micros int64
		want   int
	}{
		{"never measured", 0, 0},
		{"a quarter of a millisecond still reads as a measurement", 250, 1},
		{"half a millisecond rounds up", 500, 1},
		{"rounds to nearest", 1_600, 2},
		{"whole milliseconds", 42_000, 42},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &client{}
			c.rttMicros.Store(tc.micros)
			if got := c.ping(); got != tc.want {
				t.Errorf("%d micros reported as %d ms, want %d", tc.micros, got, tc.want)
			}
		})
	}
}
