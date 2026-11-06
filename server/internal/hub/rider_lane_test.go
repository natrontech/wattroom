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

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// laneRig is one hub's lanes with a clock the test moves.
type laneRig struct {
	t     *testing.T
	lanes *riderLanes
	at    time.Time
}

func newLaneRig(t *testing.T) *laneRig {
	r := &laneRig{t: t, at: time.Unix(1_800_000_000, 0)}
	r.lanes = newRiderLanes(func() time.Time { return r.at })
	return r
}

// socket opens one lobby socket for rider.
func (r *laneRig) socket(rider string) *lobbyClient {
	c := &lobbyClient{rider: rider, out: make(chan []byte, laneQueue)}
	r.lanes.add(c)
	return c
}

// send is one frame from c, and what the hub sends for it, by socket.
func (r *laneRig) send(c *lobbyClient, msg protocol.LobbyClientMessage) map[*lobbyClient][]protocol.LobbyLane {
	r.t.Helper()
	r.at = r.at.Add(time.Second)
	raw, err := json.Marshal(msg)
	if err != nil {
		r.t.Fatal(err)
	}
	return bySocket(r.lanes.heard(c, raw))
}

func bySocket(sends []laneSend) map[*lobbyClient][]protocol.LobbyLane {
	out := make(map[*lobbyClient][]protocol.LobbyLane)
	for _, s := range sends {
		out[s.to] = append(out[s.to], s.frame)
	}
	return out
}

func rideClaim(riding bool, tab, device string) protocol.LobbyClientMessage {
	return protocol.LobbyClientMessage{Ride: &protocol.RideClaim{Riding: riding, Tab: tab, Device: device}}
}

func press(action string) protocol.LobbyClientMessage {
	return protocol.LobbyClientMessage{Remote: &protocol.RemoteCommand{Action: action}}
}

// elsewhere is the last ride whereabouts in frames, and whether there was one.
func elsewhere(frames []protocol.LobbyLane) (string, bool) {
	where, told := "", false
	for _, f := range frames {
		if f.Ride != nil {
			where, told = f.Ride.Device, true
		}
	}
	return where, told
}

func errorCode(frames []protocol.LobbyLane) string {
	for _, f := range frames {
		if f.Error != nil {
			return f.Error.Code
		}
	}
	return ""
}

// A ride alone on the desk is found by the rider's phone on the lobby socket,
// and the phone's press reaches the desk and nobody else (#4425).
func TestRiderLaneCarriesThePhoneRemoteToTheRideAlone(t *testing.T) {
	r := newLaneRig(t)
	desk, phone, sven := r.socket("jan"), r.socket("jan"), r.socket("sven")
	r.send(phone, rideClaim(false, "phone-tab", "phone"))
	r.send(sven, rideClaim(false, "sven-tab", "phone"))

	got := r.send(desk, rideClaim(true, "desk-tab", "desktop"))
	if where, _ := elsewhere(got[phone]); where != "desktop" {
		t.Fatalf("the phone was told the ride is on %q, want desktop", where)
	}
	if where, told := elsewhere(got[desk]); !told || where != "" {
		t.Fatalf("the riding screen was told %q (told %v), want its own empty answer", where, told)
	}
	if len(got[sven]) != 0 {
		t.Fatalf("another rider heard jan's ride: %+v", got[sven])
	}

	got = r.send(phone, press("harder"))
	if len(got[desk]) != 1 || got[desk][0].Remote == nil || got[desk][0].Remote.Action != "harder" {
		t.Fatalf("the desk did not get the press: %+v", got[desk])
	}
	if len(got[phone]) != 0 || len(got[sven]) != 0 {
		t.Fatalf("the press went past the riding screen: phone %+v, sven %+v", got[phone], got[sven])
	}

	// The desk's answers reach the phone, never another rider.
	got = r.send(desk, protocol.LobbyClientMessage{Gear: &protocol.GearState{Label: "+2"}})
	if len(got[phone]) != 1 || got[phone][0].Gear == nil || got[phone][0].Gear.Label != "+2" {
		t.Fatalf("the phone did not hear the gear: %+v", got[phone])
	}
	if len(got[desk]) != 0 || len(got[sven]) != 0 {
		t.Fatalf("the gear went past the phone: desk %+v, sven %+v", got[desk], got[sven])
	}

	// The ride ends: the phone hears that nothing rides, and a press is refused.
	got = r.send(desk, rideClaim(false, "desk-tab", "desktop"))
	if where, told := elsewhere(got[phone]); !told || where != "" {
		t.Fatalf("the phone was not told the ride ended: %+v", got[phone])
	}
	if code := errorCode(r.send(phone, press("easier"))[phone]); code != "remote_conflict" {
		t.Fatalf("a press with no ride: %q, want remote_conflict", code)
	}
}

func TestRiderLaneRefusals(t *testing.T) {
	cases := []struct {
		name string
		// run sets up the rider's screens and returns the frames the last
		// send earned the phone.
		run  func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane
		want string
	}{
		{"no ride anywhere", func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane {
			return r.send(phone, press("harder"))[phone]
		}, "remote_conflict"},
		{"the riding tab pressing itself", func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane {
			r.send(phone, rideClaim(true, "phone-tab", "phone"))
			return r.send(phone, press("harder"))[phone]
		}, "remote_conflict"},
		{"an action outside the set", func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane {
			r.send(desk, rideClaim(true, "desk-tab", "desktop"))
			return r.send(phone, press("eject"))[phone]
		}, "remote_validation_error"},
		{"a second press inside the gap", func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane {
			r.send(desk, rideClaim(true, "desk-tab", "desktop"))
			r.send(phone, press("harder"))
			r.at = r.at.Add(-time.Second + remoteMinGap/2) // send adds a second
			return r.send(phone, press("harder"))[phone]
		}, "remote_rate_limited"},
		{"a shift with nothing to shift", func(r *laneRig, desk, phone *lobbyClient) []protocol.LobbyLane {
			r.send(desk, rideClaim(true, "desk-tab", "desktop"))
			return r.send(desk, protocol.LobbyClientMessage{Gear: &protocol.GearState{Idle: true}})[phone]
		}, "remote_conflict"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newLaneRig(t)
			desk, phone := r.socket("jan"), r.socket("jan")
			if code := errorCode(tc.run(r, desk, phone)); code != tc.want {
				t.Fatalf("got %q, want %q", code, tc.want)
			}
		})
	}
}

// First claim wins, as a trainer's does (ADR-0025): a second screen riding
// alone never takes the remote, and gets it once the first lets go.
func TestRiderLaneFirstRideHoldsTheRemote(t *testing.T) {
	r := newLaneRig(t)
	desk, laptop, phone := r.socket("jan"), r.socket("jan"), r.socket("jan")
	r.send(phone, rideClaim(false, "phone-tab", "phone"))
	r.send(desk, rideClaim(true, "desk-tab", "desktop"))
	r.send(laptop, rideClaim(true, "laptop-tab", "tablet"))

	got := r.send(phone, press("view"))
	if len(got[desk]) != 1 || len(got[laptop]) != 0 {
		t.Fatalf("the press went to the second ride: desk %d, laptop %d", len(got[desk]), len(got[laptop]))
	}
	// The second screen's answers are not the ride's.
	if got := r.send(laptop, protocol.LobbyClientMessage{View: &protocol.ViewState{Page: "ride"}}); len(got[phone]) != 0 {
		t.Fatalf("the phone heard the second ride's view: %+v", got[phone])
	}

	got = bySocket(r.lanes.remove(desk))
	if where, _ := elsewhere(got[phone]); where != "tablet" {
		t.Fatalf("with the desk gone the phone was told %q, want tablet", where)
	}
	if got := r.send(phone, press("view")); len(got[laptop]) != 1 {
		t.Fatalf("the laptop did not take the remote: %+v", got)
	}
}

// A reload opens a new socket while the old one is still registered; the tab
// label makes it its own successor, so the phone's remote stays put.
func TestRiderLaneReloadKeepsTheRide(t *testing.T) {
	r := newLaneRig(t)
	desk, phone := r.socket("jan"), r.socket("jan")
	r.send(phone, rideClaim(false, "phone-tab", "phone"))
	r.send(desk, rideClaim(true, "desk-tab", "desktop"))

	reloaded := r.socket("jan")
	if got := r.send(reloaded, rideClaim(true, "desk-tab", "desktop")); len(got[phone]) != 0 {
		t.Fatalf("the phone heard the reload: %+v", got[phone])
	}
	if got := bySocket(r.lanes.remove(desk)); len(got[phone]) != 0 {
		t.Fatalf("the phone heard the old socket go: %+v", got[phone])
	}
	if got := r.send(phone, press("page")); len(got[reloaded]) != 1 {
		t.Fatalf("the reloaded tab did not get the press: %+v", got)
	}
}

// The lane over a real lobby socket: what one screen sends reaches its
// rider's other screen, through the lobby's own writer.
func TestRiderLaneOverTheLobbySocket(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetLobbyAuth(func(r *http.Request) (string, bool) {
		name, _, _ := strings.Cut(r.Header.Get("X-Rider"), ":")
		return name, name != ""
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http")

	desk := dial(t, base+"/ws/presence", "jan:member")
	phone := dial(t, base+"/ws/presence", "jan:member")
	write := func(c *websocket.Conn, msg protocol.LobbyClientMessage) {
		t.Helper()
		raw, _ := json.Marshal(msg)
		if err := c.Write(t.Context(), websocket.MessageText, raw); err != nil {
			t.Fatal(err)
		}
	}
	// next is the next lane frame on c, past any presence pings.
	next := func(c *websocket.Conn, what string, ok func(protocol.LobbyLane) bool) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer cancel()
		for {
			_, raw, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("%s never arrived: %v", what, err)
			}
			var f protocol.LobbyLane
			if json.Unmarshal(raw, &f) == nil && ok(f) {
				return
			}
		}
	}

	write(phone, rideClaim(false, "phone-tab", "phone"))
	next(phone, "the phone's own answer", func(f protocol.LobbyLane) bool { return f.Ride != nil && f.Ride.Device == "" })
	write(desk, rideClaim(true, "desk-tab", "desktop"))
	next(phone, "the ride on the desk", func(f protocol.LobbyLane) bool { return f.Ride != nil && f.Ride.Device == "desktop" })
	write(phone, press("camera"))
	next(desk, "the phone's press", func(f protocol.LobbyLane) bool { return f.Remote != nil && f.Remote.Action == "camera" })

	_ = desk.CloseNow()
	next(phone, "the ride gone with its screen", func(f protocol.LobbyLane) bool { return f.Ride != nil && f.Ride.Device == "" })
}
