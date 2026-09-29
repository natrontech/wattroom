package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

// tinyWorld is one crew (ana and cam), one friendship outside it (ana and
// fin), and a stranger (sol) — resolved the way internal/audience answers
// from the store, which has its own test against a real database.
type tinyWorld struct{}

func (tinyWorld) Channel(_ context.Context, _ string, riders []string) ([]string, error) {
	out := []string{"ana", "cam"} // who may enter the crew's voice channel
	for _, r := range riders {
		out = append(out, r)
		if r == "ana" {
			out = append(out, "fin")
		}
	}
	return out, nil
}

func (tinyWorld) Rider(_ context.Context, rider string) ([]string, error) {
	if rider == "ana" {
		return []string{"ana", "fin", "cam"}, nil
	}
	return []string{rider}, nil
}

// A change reaches the riders it concerns and nobody else (#2324): a
// crew-mate and a friend outside the crew hear ana join voice, change her
// status and come online; a stranger hears none of the three. Before, every
// change pinged every signed-in socket in the process.
func TestPresencePingsReachWhoTheChangeConcernsAndNoStranger(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	h.SetAudiences(tinyWorld{})
	h.SetLobbyAuth(func(r *http.Request) (string, bool) { return r.Header.Get("X-Rider"), true })
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/presence", h.HandleLobbyWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	// The three watchers hold lobby sockets the way a client does; their
	// queues are read directly, so a ping is counted without a writer racing
	// the read.
	watchers := map[string]*lobbyClient{}
	for _, name := range []string{"cam", "fin", "sol"} {
		c := &lobbyClient{ping: make(chan struct{}, 1)}
		watchers[name] = c
		h.mu.Lock()
		h.lobby[c] = name
		h.mu.Unlock()
	}
	heard := func(event string) {
		t.Helper()
		// The crew-mate is in every audience here, and one call queues every
		// socket it names under the one lock — once cam has it, the rest of
		// that ping has landed too.
		eventually(t, event+" reached the crew-mate", func() bool { return len(watchers["cam"].ping) == 1 })
		for name, want := range map[string]bool{"cam": true, "fin": true, "sol": false} {
			if got := len(watchers[name].ping) == 1; got != want {
				t.Errorf("%s: %s pinged = %v, want %v", event, name, got, want)
			}
			if len(watchers[name].ping) == 1 {
				<-watchers[name].ping
				watchers[name].take()
			}
		}
	}

	h.VoiceJoined("velvet", "ana", "Ana")
	heard("a voice join")

	// A status change is born in the status service, which resolves the
	// rider's audience and hands it over exactly so.
	audience, _ := tinyWorld{}.Rider(t.Context(), "ana")
	h.PresenceChangedFor(audience)
	heard("a status change")

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/presence"
	ctx := t.Context()
	conn, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"X-Rider": []string{"ana"}}})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("ana comes online: %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	heard("coming online")
}

// No resolver, or a lookup that failed, tells everyone: a wider re-fetch is
// the safe direction, and it is what every change did before #2324.
func TestAPresenceChangeWithNoAudienceTellsEveryone(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	stranger := &lobbyClient{ping: make(chan struct{}, 1)}
	h.lobby[stranger] = "sol"
	h.VoiceJoined("velvet", "ana", "Ana")
	if len(stranger.ping) != 1 {
		t.Fatal("with no resolver, a voice join told nobody")
	}
}
