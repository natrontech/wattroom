package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"log/slog"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
)

// fakeAccess admits riders by an X-Rider header: "name:role", refusing others —
// standing in for rooms.Service so this tests the hub, not the database. Like
// the real thing it hands back the canonical (lowercase) channel, not the path.
type fakeAccess struct{}

func (fakeAccess) Authorize(r *http.Request, channel string) (protocol.Rider, string, error) {
	v := r.Header.Get("X-Rider")
	if v == "" {
		return protocol.Rider{}, "", av.ErrNotMember
	}
	if v == "!db" {
		return protocol.Rider{}, "", errors.New("membership lookup: connection refused")
	}
	name, role, _ := strings.Cut(v, ":")
	return protocol.Rider{ID: name, Name: name, Role: role, FtpWatts: 250}, strings.ToLower(channel), nil
}

func dial(t *testing.T, url, rider string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		HTTPHeader: http.Header{"X-Rider": []string{rider}},
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

// eventually polls until want reports true, and fails the test if it never
// does. A returned dial() proves only that the handshake completed:
// websocket.Accept writes the 101 before the handler registers the client, so
// hub state asserted straight after a dial is a race (#307).
//
// Polling rather than testing/synctest on purpose — a synctest bubble cannot
// see goroutines parked on real network I/O, which is what these tests use.
func eventually(t *testing.T, what string, want func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if want() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s never became true", what)
		}
		time.Sleep(time.Millisecond)
	}
}

// decksHeard is each test socket's last deck, filled back into the ticks
// that do not carry it — what the client does (#2838).
var decksHeard sync.Map // *websocket.Conn → *protocol.JukeboxState

func readTick(t *testing.T, conn *websocket.Conn) protocol.ServerTick {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, conn, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if msg.Tick != nil {
			if msg.Tick.Jukebox != nil {
				decksHeard.Store(conn, msg.Tick.Jukebox)
			} else if heard, ok := decksHeard.Load(conn); ok {
				msg.Tick.Jukebox, _ = heard.(*protocol.JukeboxState)
			}
			return *msg.Tick
		}
	}
	t.Fatalf("no tick within deadline")
	return protocol.ServerTick{}
}

func TestWebSocketRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	// The privacy property: no membership, no socket.
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, res, err := websocket.Dial(ctx, url, nil)
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("stranger was not refused with 403 (err %v)", err)
	}
	// A database that did not answer is not a stranger (#1984): 503, so the
	// client keeps trying instead of believing it was thrown out.
	_, res, err = websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"X-Rider": {"!db"}}})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("a database failure at the door was not a 503 (err %v, res %v)", err, res)
	}

	coach := dial(t, url, "jan:owner")
	member := dial(t, url, "sven:member")

	// Metrics flow into the coalesced tick, and the roster carries both riders.
	if err := wsjson.Write(t.Context(), member, protocol.ClientMessage{
		Metrics: &protocol.RiderMetrics{Watts: 210, Cadence: 88, Seq: 1},
	}); err != nil {
		t.Fatalf("send metrics: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	var tick protocol.ServerTick
	for {
		tick = readTick(t, coach)
		if _, ok := tick.Riders["sven"]; ok || time.Now().After(deadline) {
			break
		}
	}
	if tick.Riders["sven"].Watts != 210 {
		t.Fatalf("member metrics did not reach the tick: %+v", tick.Riders)
	}
	if len(tick.Roster) != 2 {
		t.Fatalf("roster: %+v", tick.Roster)
	}
	if tick.State.Phase != "idle" {
		t.Fatalf("phase: %q", tick.State.Phase)
	}

	// The coach opens the session with a pick (#2438)...
	if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &protocol.Control{
		Action: "pick", WorkoutName: "Openers", WorkoutJSON: wsWorkout, TotalSeconds: 120,
	}}); err != nil {
		t.Fatalf("coach pick: %v", err)
	}
	// Two sockets race: the member's start must land after the pick did.
	deadline = time.Now().Add(5 * time.Second)
	for tick = readTick(t, member); tick.State.Coach != "jan"; tick = readTick(t, member) {
		if time.Now().After(deadline) {
			t.Fatal("the pick never reached the tick")
		}
	}
	// ...and a member's start on it is refused with an error message, not
	// silently eaten: one session per channel, and it is the coach's.
	if err := wsjson.Write(t.Context(), member, protocol.ClientMessage{
		Control: &protocol.Control{Action: "start"},
	}); err != nil {
		t.Fatalf("send control: %v", err)
	}
	readCtx, readCancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer readCancel()
	var refused protocol.ServerMessage
	for {
		if err := wsjson.Read(readCtx, member, &refused); err != nil {
			t.Fatalf("read refusal: %v", err)
		}
		if refused.Error != nil {
			break
		}
	}
	if refused.Error.Code != "conflict" || !strings.Contains(refused.Error.Message, "jan") {
		t.Fatalf("member control: %+v", refused.Error)
	}

	// The coach starts; the tick's shared state moves to countdown.
	if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &protocol.Control{Action: "start"}}); err != nil {
		t.Fatalf("coach control: %v", err)
	}
	deadline = time.Now().Add(5 * time.Second)
	for {
		tick = readTick(t, coach)
		if tick.State.Phase == "countdown" || time.Now().After(deadline) {
			break
		}
	}
	if tick.State.Phase != "countdown" || tick.State.WorkoutName != "Openers" {
		t.Fatalf("state after start: %+v", tick.State)
	}
}

func TestJukeboxRefusalReachesOnlyTheRiderWhoAddedIt(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	sender := dial(t, url, "jan:member")
	other := dial(t, url, "ada:member")
	if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
		Jukebox: &protocol.JukeboxCommand{Action: "add", VideoID: "not-a-video!"},
	}); err != nil {
		t.Fatalf("send jukebox command: %v", err)
	}

	readCtx, readCancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer readCancel()
	var refused protocol.ServerMessage
	for {
		if err := wsjson.Read(readCtx, sender, &refused); err != nil {
			t.Fatalf("read refusal: %v", err)
		}
		if refused.Error != nil {
			break
		}
	}
	if refused.Error.Code != "jukebox_validation_error" {
		t.Fatalf("sender refusal: %+v", refused.Error)
	}
	if refused.Error.Message == "" {
		t.Fatal("sender refusal has no actionable message")
	}

	otherCtx, otherCancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer otherCancel()
	for {
		var msg protocol.ServerMessage
		if err := wsjson.Read(otherCtx, other, &msg); err != nil {
			if otherCtx.Err() != nil {
				return
			}
			t.Fatalf("read other rider: %v", err)
		}
		if msg.Error != nil {
			t.Fatalf("other rider received refusal: %+v", msg.Error)
		}
	}
}

func TestRosterDeduplicatesRiders(t *testing.T) {
	// The same rider on two devices is one presence: duplicate roster ids are
	// poison to keyed rendering, and this crashed the dashboard before it was
	// deduped (found live, then pinned here).
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/dupes"

	first := dial(t, url, "jan:owner")
	dial(t, url, "jan:owner") // same rider, second device

	tick := readTick(t, first)
	if len(tick.Roster) != 1 {
		t.Fatalf("expected one roster entry for one rider on two sockets, got %d", len(tick.Roster))
	}

	// Presence counts the same way: riders, not sockets — and names them.
	p := h.Presence("dupes")
	if p.Connected != 1 || p.Phase != "idle" || len(p.Riders) != 1 || p.Riders[0] != "jan" {
		t.Fatalf("presence: %+v", p)
	}
}

// A link typed with different capitalisation is the same room (#639). The
// live room is keyed on the canonical channel Authorize returns, not on the
// request path — otherwise `Velvet` and `velvet` fork two rooms with two
// rosters, and a kick or a close addressed to the canonical one leaves the
// other running forever.
func TestMixedCaseChannelIDSharesRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/"

	lower := dial(t, base+"velvet", "jan:owner")
	dial(t, base+"VeLvEt", "sven:member")

	eventually(t, "both riders in one roster", func() bool {
		return len(h.Presence("velvet").Riders) == 2
	})
	h.mu.Lock()
	n := len(h.rooms)
	_, canonical := h.rooms["velvet"]
	h.mu.Unlock()
	if n != 1 || !canonical {
		t.Fatalf("live rooms = %d (canonical present: %v), want exactly one keyed \"velvet\"", n, canonical)
	}
	tick := readTick(t, lower)
	if len(tick.Roster) != 2 {
		t.Fatalf("roster over the lowercase socket: %+v — the other casing landed elsewhere", tick.Roster)
	}
}

func TestJukeboxActionsRideTheTick(t *testing.T) {
	// #321, ADR-0019: the music changing under everyone is half of what
	// happened in the room, and it reaches the others the same way a cheer does.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/loud"

	a := dial(t, url, "jan:owner")
	b := dial(t, url, "sven:member")
	readTick(t, a)

	if err := wsjson.Write(t.Context(), b, protocol.ClientMessage{
		Jukebox: &protocol.JukeboxCommand{
			Action: "add", VideoID: "dQw4w9WgXcQ", Title: "Midnight City",
		},
	}); err != nil {
		t.Fatalf("send: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		tick := readTick(t, a)
		if len(tick.Events) > 0 {
			got := tick.Events[0]
			// An empty deck plays what it is handed, so the line the others
			// see is the now-playing one — and it names who queued it.
			if got.Kind != "jukebox" || got.Verb != "playing" ||
				got.Track != "Midnight City" || got.QueuedBy != "sven" {
				t.Fatalf("event: %+v", got)
			}
			if got.ID == "" {
				t.Fatal("event without an id: a grown burst could not replace it")
			}
			// Drained like cheers — the next tick must not repeat it.
			if next := readTick(t, a); len(next.Events) != 0 {
				t.Fatalf("event repeated on the next tick: %+v", next.Events)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("jukebox event never arrived on the tick")
		}
	}
}

func TestSetRoleReachesOpenSockets(t *testing.T) {
	// Promoting a coach used to change nothing until they reconnected: the
	// rider struct is captured when the socket opens, so their control stayed
	// refused and every roster still called them a member (rider report).
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/promote"

	owner := dial(t, url, "jan:owner")
	member := dial(t, url, "sven:member")
	readTick(t, member) // the socket is registered by the time a tick arrives

	h.SetRole("promote", "sven", "coach")

	// The roster tells everyone, so the tiles re-badge without a reload.
	deadline := time.Now().Add(5 * time.Second)
	var promoted bool
	for !promoted && time.Now().Before(deadline) {
		for _, rider := range readTick(t, owner).Roster {
			if rider.ID == "sven" && rider.Role == "coach" {
				promoted = true
			}
		}
	}
	if !promoted {
		t.Fatal("roster never carried the new role")
	}

	// And the control check honours it on the socket that is already open.
	if err := wsjson.Write(t.Context(), member, protocol.ClientMessage{
		Control: &protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: wsWorkout, TotalSeconds: 120},
	}); err != nil {
		t.Fatalf("send control: %v", err)
	}
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if readTick(t, member).State.WorkoutName == "Openers" {
			return
		}
	}
	t.Fatal("the promoted rider's control was still refused")
}

// The voice roster has to reach a client that has NOT joined voice: LiveKit
// tells a browser who is in the channel only once that browser is in it too,
// so before then the panel read "in voice - 0" with the whole room listed
// below it. The webhooks know better, and the tick carries their answer.
func TestVoiceRidesTheTickBeforeYouJoin(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/quiet"

	conn := dial(t, url, "jan:owner")
	readTick(t, conn)
	if tick := readTick(t, conn); len(tick.Voice) != 0 {
		t.Fatalf("voice = %v before anyone joined, want none", tick.Voice)
	}

	// Two tabs of one rider, as LiveKit identifies them.
	h.VoiceJoined("quiet", "sven#aaa", "Sven")
	h.VoiceJoined("quiet", "sven#bbb", "Sven")
	h.VoiceJoined("quiet", "david#ccc", "David")

	deadline := time.Now().Add(5 * time.Second)
	for {
		tick := readTick(t, conn)
		if len(tick.Voice) > 0 {
			if want := []string{"david", "sven"}; !slices.Equal(tick.Voice, want) {
				t.Fatalf("voice = %v, want %v", tick.Voice, want)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("voice never reached the tick")
		}
	}

	h.VoiceLeft("quiet", "sven#aaa")
	h.VoiceLeft("quiet", "sven#bbb")
	for {
		tick := readTick(t, conn)
		if slices.Equal(tick.Voice, []string{"david"}) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("leaving never reached the tick, voice = %v", tick.Voice)
		}
	}
}

func TestASlowSocketMissesTicksAlone(t *testing.T) {
	// #670: the tick used to be written to each socket in turn, on the room's
	// one goroutine, with a second's deadline each. A client that stopped
	// reading — bad wifi, a backgrounded tab, or a member holding a zero
	// window on purpose — cost the whole room up to a second per tick, and
	// during a sprint burst collapsed 4 Hz to 1 Hz for everyone else. Any
	// member could do it.
	c := &client{out: make(chan []byte, clientQueue)}
	for i := 0; i < clientQueue; i++ {
		c.send([]byte("tick"))
	}

	// The queue is full. The room must not wait for this rider.
	returned := make(chan struct{})
	go func() {
		c.send([]byte("one more"))
		close(returned)
	}()
	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("send blocked on a client that had stopped reading — the whole room waits behind it")
	}
	if len(c.out) != clientQueue {
		t.Errorf("queue holds %d frames, want it capped at %d", len(c.out), clientQueue)
	}

	// And the frames it did take are the ones it took, in order.
	first := <-c.out
	if string(first) != "tick" {
		t.Errorf("first queued frame is %q, want the oldest", first)
	}
}

// ARCHITECTURE.md seam 2: "the hub coalesces all riders into one tick message
// per room per second (n in, 1 out — never n²)". One marshal for the room,
// handed to every socket (#670) — per-client marshalling put the same work N
// times on the critical path between one slow socket and the next.
//
// This asserts the two sockets were handed THE SAME SLICE, not two slices
// that compare equal (#2233). Equality cannot see the bug: json.Marshal is
// deterministic, so a marshal moved back inside the loop produces identical
// bytes and identical rosters, and the assertion that used to stand here —
// the two decoded rosters being the same length — could not go red at all.
// Which is why this one is in-process: the frame is the evidence, and over a
// socket the frame is a copy by the time it arrives.
func TestEveryRiderGetsTheSameTickBytes(t *testing.T) {
	rm := newRoom("together")
	jan := &client{rider: protocol.Rider{ID: "jan", Name: "Jan", Role: "owner"}, out: make(chan []byte, clientQueue)}
	sven := &client{rider: protocol.Rider{ID: "sven", Name: "Sven", Role: "member"}, out: make(chan []byte, clientQueue)}
	rm.join(jan)
	rm.join(sven)
	go rm.run(slog.New(slog.DiscardHandler), time.Now, nil)
	t.Cleanup(func() { close(rm.stop) })

	take := func(who string, c *client) []byte {
		t.Helper()
		select {
		case frame := <-c.out:
			return frame
		case <-time.After(3 * time.Second):
			t.Fatalf("%s never got a tick", who)
			return nil
		}
	}
	janFrame, svenFrame := take("jan", jan), take("sven", sven)
	if len(janFrame) == 0 || len(svenFrame) == 0 {
		t.Fatal("a tick arrived empty")
	}
	// Same backing array = one marshal. No workout is picked, so neither
	// socket is owed the full copy that #1710 sends on its own.
	if &janFrame[0] != &svenFrame[0] {
		t.Errorf("the two sockets were handed different frames — the tick is being marshalled per client, not per room")
	}
	// And it is a tick, so the frame being compared is the one that matters.
	var msg protocol.ServerMessage
	if err := json.Unmarshal(janFrame, &msg); err != nil || msg.Tick == nil {
		t.Fatalf("the frame is not a tick: %v: %s", err, janFrame)
	}
	if msg.Tick.Roster == nil {
		t.Error("a tick arrived without a roster")
	}
}

// The workout definition rides only the tick that changes it and the first
// tick a socket gets (#1710); every other tick names it by hash. It used to
// ride every tick — 64 KiB at up to 4 Hz, re-parsed by every client.
func TestTheWorkoutRidesOnlyTheTickThatChangesIt(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/lean"

	coach := dial(t, url, "jan:owner")
	if tick := readTick(t, coach); tick.State.WorkoutHash != "" || tick.State.WorkoutJSON != "" {
		t.Fatalf("an idle room names a workout: %+v", tick.State)
	}
	pick := protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: wsWorkout, TotalSeconds: 120}
	if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &pick}); err != nil {
		t.Fatalf("pick: %v", err)
	}
	// The tick that carries the pick carries the definition...
	var tick protocol.ServerTick
	deadline := time.Now().Add(5 * time.Second)
	for tick.State.WorkoutHash == "" {
		if time.Now().After(deadline) {
			t.Fatal("the pick never reached the tick")
		}
		tick = readTick(t, coach)
	}
	if tick.State.WorkoutJSON != wsWorkout {
		t.Fatalf("the pick's tick did not carry the definition: %+v", tick.State)
	}
	hash := tick.State.WorkoutHash
	// ...and the next one names it only.
	next := readTick(t, coach)
	if next.State.WorkoutHash != hash || next.State.WorkoutJSON != "" {
		t.Fatalf("the tick after the pick: %+v", next.State)
	}
	// A late joiner has not heard it: their first tick has it in full.
	late := dial(t, url, "sven:member")
	if first := readTick(t, late); first.State.WorkoutJSON != wsWorkout || first.State.WorkoutHash != hash {
		t.Fatalf("a late joiner's first tick: %+v", first.State)
	}
}

// A workout the WS pick check accepts (audit 2026-09-09): "{}" used to pass
// because the hub never looked.
const wsWorkout = `{"steps":[{"type":"steady","seconds":120,"target":0.8}]}`

// A deliberate tap that is refused has to say so (#2232). The jukebox's own
// refusals — a bad video id, a queue that is full — already answer; the 300 ms
// throttle above them dropped the command in silence, so skip, pause and queue
// read as the button not working. The one channel where that matters, because
// these are taps a rider watches for a result.
func TestAThrottledJukeboxCommandAnswers(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	rider := dial(t, url, "jan:member")
	// Two inside the throttle's 300 ms: the first is answered on its own
	// merits, the second is refused by the throttle and must not be silent.
	for range 2 {
		if err := wsjson.Write(t.Context(), rider, protocol.ClientMessage{
			Jukebox: &protocol.JukeboxCommand{Action: "skip"},
		}); err != nil {
			t.Fatalf("send jukebox command: %v", err)
		}
	}

	readCtx, readCancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer readCancel()
	var throttled *protocol.Error
	for throttled == nil {
		var msg protocol.ServerMessage
		if err := wsjson.Read(readCtx, rider, &msg); err != nil {
			t.Fatalf("the throttled command was never answered: %v", err)
		}
		if msg.Error != nil && msg.Error.Code == "jukebox_rate_limited" {
			throttled = msg.Error
		}
	}
	if throttled.Message == "" {
		t.Error("the refusal has no message, so the rider is told nothing")
	}
	// jukebox_ so it lands beside the deck they tapped, not in the room's own
	// refusal slot (live.svelte.ts routes on the prefix).
	if !strings.HasPrefix(throttled.Code, "jukebox_") {
		t.Errorf("code %q does not reach the deck's refusal slot", throttled.Code)
	}
}
