package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// knownErrorCode reports whether a code is in the closed set errors.md pins. A
// WS refusal carries one of these, optionally behind a surface prefix that
// routes it — never a vocabulary of its own.
func knownErrorCode(code string) bool {
	switch code {
	case "validation_error", "invalid_request", "unauthorized", "forbidden",
		"not_found", "conflict", "rate_limited", "internal_error":
		return true
	}
	return false
}

func TestJukeboxRefusalsSpeakTheClosedSet(t *testing.T) {
	// Every refusal used to become `jukebox_` + its own name — seven codes no
	// rule and no client knew (2026-09-17 audit). The message stays the human
	// half; the code says what the rider does about it.
	for _, tc := range []struct {
		refusal jukeboxRefusal
		want    string
	}{
		{refusalQueueFull, "rate_limited"},
		{refusalTrackCap, "rate_limited"},
		{refusalInvalidVideo, "validation_error"},
		{refusalInvalidPlaylist, "validation_error"},
		{refusalPlaylistLarge, "validation_error"},
		{refusalInvalidTrack, "validation_error"},
		{refusalInvalidTrackID, "validation_error"},
	} {
		got := tc.refusal.code()
		if !knownErrorCode(got) {
			t.Errorf("%s: code %q is outside errors.md's set", tc.refusal, got)
		}
		if got != tc.want {
			t.Errorf("%s: code = %q, want %q", tc.refusal, got, tc.want)
		}
		if tc.refusal.message() == "" {
			t.Errorf("%s: no actionable message", tc.refusal)
		}
		if code := jukeboxCode(got); !strings.HasPrefix(code, "jukebox_") ||
			!knownErrorCode(strings.TrimPrefix(code, "jukebox_")) {
			t.Errorf("%s: namespaced code %q does not decompose", tc.refusal, code)
		}
	}
}

func TestPokeCooldownAnswersRateLimited(t *testing.T) {
	// The identical chat cooldown answers rate_limited, and errors.md pins the
	// reason: the rider's move is the same either way — wait, then try again.
	// `conflict` told them their poke duplicated something.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	jan := dial(t, url, "jan:member")
	dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool { return h.Presence("velvet").Connected == 2 })

	for range 2 {
		if err := wsjson.Write(t.Context(), jan, protocol.ClientMessage{
			Poke: &protocol.Poke{To: "sven"},
		}); err != nil {
			t.Fatalf("send poke: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	var refused protocol.ServerMessage
	for refused.Error == nil {
		if err := wsjson.Read(ctx, jan, &refused); err != nil {
			t.Fatalf("read refusal: %v", err)
		}
	}
	if refused.Error.Code != "rate_limited" {
		t.Fatalf("poke cooldown answered %+v, want rate_limited", refused.Error)
	}
}

func TestRoomAndHubShareOneClock(t *testing.T) {
	// newRoom defaults to time.Now and Hub.room() never overrode it, so
	// join/leave/setAway/setMetrics/fire stamped on one function and
	// run/sayDepartedLocked/rm.allow on another — identical in production,
	// divergent the moment either is injected, which is what the tests do.
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	frozen := time.Unix(1_700_000_000, 0)
	h.now = func() time.Time { return frozen } // before any room exists

	rm := h.room("velvet")
	if got := rm.now(); !got.Equal(frozen) {
		t.Fatalf("room clock = %v, hub clock = %v", got, frozen)
	}

	// The seam it costs: leave() stamps the departure on the room's clock and
	// the tick measures the grace window on the hub's. Two clocks put the
	// stamp years in the measuring clock's future, and the room was never
	// told anybody had gone.
	c := &client{rider: protocol.Rider{ID: "jan", Name: "Jan"}}
	rm.join(c)
	rm.leave(c)
	rm.mu.Lock()
	rm.sayDepartedLocked(h.now().Add(presenceGrace + time.Second))
	events := rm.events.drain()
	rm.mu.Unlock()
	if len(events) == 0 || events[len(events)-1].Verb != "left" {
		t.Fatalf("timeline = %+v, want Jan's departure past the grace window", events)
	}
}

func TestIdleTrainerIsNotASecondSprinter(t *testing.T) {
	// A rider sitting in the room with a trainer paired reports 0 W every
	// second — five whole seconds of samples, ranked at 0.0 w/kg, and
	// minSprintField read a field of two. The one person who sprinted took
	// the podium and the Sprint Snob credit off nobody (#2235).
	rm := newRoom("velvet")
	ada := &client{rider: protocol.Rider{ID: "ada", Name: "Ada", WeightKg: 60}}
	idle := &client{rider: protocol.Rider{ID: "idle", Name: "Idle", WeightKg: 70}}
	rm.join(ada)
	rm.join(idle)
	rm.mu.Lock()
	rm.seen["ada"] = ada.rider
	rm.seen["idle"] = idle.rider
	rm.armSprintWindow(gat(0), gat(15))
	for sec := range 15 {
		rm.sprint.collect("ada", 600, gat(sec))
		rm.sprint.collect("idle", 0, gat(sec))
	}
	state, winner := rm.scoreSprintLocked(gat(16))
	rm.mu.Unlock()

	if len(state.Results) != 1 || state.Results[0].RiderID != "ada" {
		t.Fatalf("podium = %+v, want Ada alone", state.Results)
	}
	if winner != "" {
		t.Fatalf("winner = %q — an idle trainer made the field of two", winner)
	}

	// The same sprint with a second rider who actually pedalled does name one.
	rm.mu.Lock()
	rm.armSprintWindow(gat(20), gat(35))
	for sec := 20; sec < 35; sec++ {
		rm.sprint.collect("ada", 600, gat(sec))
		rm.sprint.collect("idle", 200, gat(sec))
	}
	_, winner = rm.scoreSprintLocked(gat(36))
	rm.mu.Unlock()
	if winner != "ada" {
		t.Fatalf("winner = %q, want ada — two riders sprinted", winner)
	}
}

func TestCollectiveRampEndsOnTheTimeline(t *testing.T) {
	// The collective branch sets finished and builds no podium, so
	// advanceGameLocked's `len(gs.Podium) > 0` was false and a game the whole
	// room had just ridden left the timeline empty (ADR-0022).
	rm := newRoom("velvet")
	if refusal := rm.startGame("collective-ramp", gameStarter, gat(0)); refusal != "" {
		t.Fatal(refusal)
	}
	joinRide(rm, "a", "b")
	rm.mu.Lock()
	for id, r := range backyardRoster() {
		rm.seen[id] = r
	}
	// Line 75 % of a summed 500 W FTP: 375 W together. They hold, then fall.
	ride := func(from, to, a, b int) {
		for sec := from; sec <= to; sec++ {
			rm.metrics = map[string]protocol.RiderMetrics{
				"a": {Watts: a}, "b": {Watts: b},
			}
			rm.advanceGameLocked(gat(sec))
		}
	}
	ride(1, 15, 152, 228)
	ride(16, 27, 152, 60)
	events := rm.events.drain()
	done := rm.game != nil && rm.game.done()
	rm.mu.Unlock()

	if !done {
		t.Fatal("the room never fell off the line")
	}
	var ended *protocol.ChannelEvent
	for i, ev := range events {
		if ev.Verb == "gameEnded" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatalf("no ending on the timeline: %+v", events)
	}
	if ended.Kind != sessionKind || ended.Subject != "collective-ramp" {
		t.Fatalf("ending line = %+v", ended)
	}
	if ended.Count < 1 {
		t.Fatalf("ending line names no round: %+v", ended)
	}
}

func TestEndGameSaysSoOnce(t *testing.T) {
	// The coach's out, and the only end Team Relay has — relay.done() is
	// never true, so nothing else was ever going to say the paceline stopped.
	rm := newRoom("velvet")
	if refusal := rm.startGame("team-relay", gameStarter, gat(0)); refusal != "" {
		t.Fatal(refusal)
	}
	if !rm.endGame(gat(60)) {
		t.Fatal("end with a game running said nothing ran")
	}
	rm.mu.Lock()
	events := rm.events.drain()
	rm.mu.Unlock()
	if len(events) != 1 || events[0].Verb != "gameEnded" || events[0].Subject != "team-relay" {
		t.Fatalf("timeline = %+v, want one team-relay ending", events)
	}

	// A coach clearing a podium that already announced itself is not a second
	// ending: advanceGameLocked stamped gameDoneAt when it put the line up.
	rm2 := newRoom("velvet")
	if refusal := rm2.startGame("collective-ramp", gameStarter, gat(0)); refusal != "" {
		t.Fatal(refusal)
	}
	joinRide(rm2, "a", "b")
	rm2.mu.Lock()
	for id, r := range backyardRoster() {
		rm2.seen[id] = r
	}
	for sec := 1; sec <= 27; sec++ {
		rm2.metrics = map[string]protocol.RiderMetrics{"a": {Watts: 10}, "b": {Watts: 10}}
		rm2.advanceGameLocked(gat(sec))
	}
	announced := len(rm2.events.drain())
	rm2.mu.Unlock()
	if announced != 1 {
		t.Fatalf("the finish put %d lines up, want 1", announced)
	}
	if !rm2.endGame(gat(30)) {
		t.Fatal("end after the finish said nothing ran")
	}
	rm2.mu.Lock()
	after := rm2.events.drain()
	rm2.mu.Unlock()
	if len(after) != 0 {
		t.Fatalf("the coach's end said it again: %+v", after)
	}
}
