package hub

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"log/slog"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// fakeAccess admits riders by an X-Rider header: "name:role", refusing others —
// standing in for rooms.Service so this tests the hub, not the database. Like
// the real thing it hands back the canonical (lowercase) slug, not the path.
type fakeAccess struct{}

func (fakeAccess) Authorize(r *http.Request, slug string) (protocol.Rider, string, error) {
	v := r.Header.Get("X-Rider")
	if v == "" {
		return protocol.Rider{}, "", errors.New("no rider")
	}
	name, role, _ := strings.Cut(v, ":")
	return protocol.Rider{ID: name, Name: name, Role: role, FtpWatts: 250}, strings.ToLower(slug), nil
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
			return *msg.Tick
		}
	}
	t.Fatalf("no tick within deadline")
	return protocol.ServerTick{}
}

func TestWebSocketRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/velvet"

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

	// A member's control is refused with an error message, not silently eaten.
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
	if refused.Error.Code != "forbidden" {
		t.Fatalf("member control: %+v", refused.Error)
	}

	// The coach picks and starts; the tick's shared state moves to countdown.
	for _, control := range []protocol.Control{
		{Action: "pick", WorkoutName: "Openers", WorkoutJSON: "{}", TotalSeconds: 120},
		{Action: "start"},
	} {
		if err := wsjson.Write(t.Context(), coach, protocol.ClientMessage{Control: &control}); err != nil {
			t.Fatalf("coach control: %v", err)
		}
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

func TestRosterDeduplicatesRiders(t *testing.T) {
	// The same rider on two devices is one presence: duplicate roster ids are
	// poison to keyed rendering, and this crashed the dashboard before it was
	// deduped (found live, then pinned here).
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/dupes"

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
// live room is keyed on the canonical slug Authorize returns, not on the
// request path — otherwise `Velvet` and `velvet` fork two rooms with two
// rosters, and a kick or a close addressed to the canonical one leaves the
// other running forever.
func TestMixedCaseSlugSharesRoom(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/"

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

// fakeChat persists instantly with predictable ids — enough to prove the
// async save's follow-up ChatID reaches the tick (#219).
type fakeChat struct{}

func (fakeChat) SaveChat(context.Context, string, string, string, string) (string, bool) {
	return "msg-1", true
}

func (fakeChat) ToggleReaction(context.Context, string, string, string, string) (int, bool, bool) {
	return 0, false, false
}

func TestChatIDFollowsTheLine(t *testing.T) {
	// #219: the save runs off the read loop — the line broadcasts id-less,
	// the persisted id follows on a tick as a ChatID naming fromId+at.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetChatKeeper(fakeChat{})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/durable"

	a := dial(t, url, "jan:owner")
	readTick(t, a)
	if err := wsjson.Write(t.Context(), a, protocol.ClientMessage{
		Chat: &protocol.ChatLine{Text: "on my way"},
	}); err != nil {
		t.Fatalf("send: %v", err)
	}

	var line *protocol.ChatLine
	var assigned *protocol.ChatID
	deadline := time.Now().Add(5 * time.Second)
	for (line == nil || assigned == nil) && time.Now().Before(deadline) {
		tick := readTick(t, a)
		if len(tick.Chat) > 0 {
			line = &tick.Chat[0]
			if line.ID != "" {
				t.Fatalf("line waited for its save: %+v", line)
			}
		}
		if len(tick.ChatIDs) > 0 {
			assigned = &tick.ChatIDs[0]
		}
	}
	if line == nil || assigned == nil {
		t.Fatalf("line or id never arrived: line=%v assigned=%v", line, assigned)
	}
	if assigned.ID != "msg-1" || assigned.FromID != line.FromID || assigned.At != line.At {
		t.Fatalf("follow-up does not name the line: line=%+v assigned=%+v", line, assigned)
	}
}

func TestChatRidesTheTick(t *testing.T) {
	// #146, ADR-0010: ephemeral, room-scoped, drained per tick like cheers.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/chatty"

	a := dial(t, url, "jan:owner")
	b := dial(t, url, "sven:member")
	readTick(t, a)

	if err := wsjson.Write(t.Context(), b, protocol.ClientMessage{
		Chat: &protocol.ChatLine{Text: "  warm-up in five  "},
	}); err != nil {
		t.Fatalf("send: %v", err)
	}
	// Oversized and rapid-fire lines are dropped silently.
	_ = wsjson.Write(t.Context(), b, protocol.ClientMessage{
		Chat: &protocol.ChatLine{Text: strings.Repeat("x", 600)},
	})

	deadline := time.Now().Add(5 * time.Second)
	for {
		tick := readTick(t, a)
		if len(tick.Chat) > 0 {
			if tick.Chat[0].From != "sven" || tick.Chat[0].Text != "warm-up in five" {
				t.Fatalf("line: %+v", tick.Chat[0])
			}
			if len(tick.Chat) != 1 {
				t.Fatalf("oversized line leaked: %d lines", len(tick.Chat))
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("chat line never arrived on the tick")
		}
	}
}

func TestJukeboxActionsRideTheTick(t *testing.T) {
	// #321, ADR-0019: the music changing under everyone is half of what
	// happened in the room, and it reaches the others the same way chat does.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/loud"

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
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/promote"

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
		Control: &protocol.Control{Action: "pick", WorkoutName: "Openers", WorkoutJSON: "{}", TotalSeconds: 120},
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
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/quiet"

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
