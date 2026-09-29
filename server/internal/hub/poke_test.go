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

func TestQueuePokeTargetsEverySocketOfOneRider(t *testing.T) {
	rm := newRoom("velvet")
	sender := &client{rider: protocol.Rider{ID: "jan"}}
	targetDesk := &client{rider: protocol.Rider{ID: "sven"}}
	targetPhone := &client{rider: protocol.Rider{ID: "sven"}}
	other := &client{rider: protocol.Rider{ID: "kai"}}
	for _, c := range []*client{sender, targetDesk, targetPhone, other} {
		rm.join(c)
	}

	want := protocol.Poke{To: "sven", FromID: "jan", From: "jan", At: 42}
	if !rm.queuePoke("sven", want) {
		t.Fatal("connected target was not found")
	}

	rm.mu.Lock()
	queued := rm.drainPokesLocked()
	rm.mu.Unlock()
	if len(queued) != 2 {
		t.Fatalf("queued for %d sockets, want the target's 2", len(queued))
	}
	for _, c := range []*client{targetDesk, targetPhone} {
		if got := queued[c]; len(got) != 1 || got[0] != want {
			t.Errorf("target socket got %+v, want %+v", got, want)
		}
	}
	if queued[sender] != nil || queued[other] != nil {
		t.Fatal("poke leaked to an unaddressed rider")
	}
}

func TestPokeCooldownIsPerSenderAndTarget(t *testing.T) {
	rm := newRoom("velvet")
	now := time.Unix(100, 0)
	if !rm.allow("poke:sven", "jan", now, pokeCooldown) {
		t.Fatal("first poke was refused")
	}
	if rm.allow("poke:sven", "jan", now, pokeCooldown) {
		t.Fatal("same sender-target pair escaped the cooldown")
	}
	if !rm.allow("poke:kai", "jan", now, pokeCooldown) {
		t.Fatal("a different target shared the cooldown")
	}
	if !rm.allow("poke:sven", "ruben", now, pokeCooldown) {
		t.Fatal("a different sender shared the cooldown")
	}
	if !rm.allow("poke:sven", "jan", now.Add(pokeCooldown), pokeCooldown) {
		t.Fatal("cooldown did not expire")
	}
}

func readPoke(t *testing.T, conn *websocket.Conn) protocol.Poke {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	for {
		var message protocol.ServerMessage
		if err := wsjson.Read(ctx, conn, &message); err != nil {
			t.Fatalf("read poke: %v", err)
		}
		if message.Poke != nil {
			return *message.Poke
		}
	}
}

func TestPokeUsesAuthenticatedSender(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	sender := dial(t, url, "jan:member")
	target := dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool {
		return h.Presence("velvet").Connected == 2
	})

	if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
		Poke: &protocol.Poke{To: "sven", FromID: "forged", From: "forged", At: 1},
	}); err != nil {
		t.Fatalf("send poke: %v", err)
	}
	got := readPoke(t, target)
	if got.To != "sven" || got.FromID != "jan" || got.From != "jan" || got.At <= 1 {
		t.Fatalf("routed poke trusted client sender fields: %+v", got)
	}
}

// A cooldown that drops in silence reads as a broken button, and the sender
// pokes again — the failure errors.md exists to prevent.
func TestPokeOnCooldownTellsTheSender(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	sender := dial(t, url, "jan:member")
	dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool {
		return h.Presence("velvet").Connected == 2
	})

	for range 2 {
		if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
			Poke: &protocol.Poke{To: "sven"},
		}); err != nil {
			t.Fatalf("send poke: %v", err)
		}
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		var msg protocol.ServerMessage
		err := wsjson.Read(ctx, sender, &msg)
		cancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if msg.Error != nil {
			if msg.Error.Message == "" {
				t.Fatalf("refusal carried no message: %+v", msg.Error)
			}
			return
		}
	}
	t.Fatal("the second poke was dropped without a word to the sender")
}

// Silence on success read as a button that did nothing (#2721): the socket
// that poked gets its own copy back, from itself.
func TestPokeAnswersTheSender(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	sender := dial(t, url, "jan:member")
	dial(t, url, "sven:member")
	eventually(t, "both riders joined", func() bool {
		return h.Presence("velvet").Connected == 2
	})
	if err := wsjson.Write(t.Context(), sender, protocol.ClientMessage{
		Poke: &protocol.Poke{To: "sven"},
	}); err != nil {
		t.Fatalf("send poke: %v", err)
	}
	if got := readPoke(t, sender); got.To != "sven" || got.FromID != "jan" {
		t.Fatalf("the sender's answer: %+v", got)
	}
}

// A friend's poke is a DM line, and the hub is how it lands NOW (#2721):
// every socket the rider holds, in every channel, carrying the words.
func TestPokeRiderReachesEveryChannel(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	base := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/"

	velvet := dial(t, base+"velvet", "sven:member")
	ember := dial(t, base+"ember", "sven:member")
	eventually(t, "sven in both channels", func() bool {
		return h.Presence("velvet").Connected == 1 && h.Presence("ember").Connected == 1
	})

	want := protocol.Poke{To: "sven", FromID: "jan", From: "jan", At: 42, Text: "wheel!", Dm: true}
	h.PokeRider("sven", want)
	for name, conn := range map[string]*websocket.Conn{"velvet": velvet, "ember": ember} {
		if got := readPoke(t, conn); got != want {
			t.Fatalf("%s heard %+v, want %+v", name, got, want)
		}
	}
}

// readRefusal reads until the socket's next refusal, skipping ticks.
func readRefusal(t *testing.T, conn *websocket.Conn) protocol.Error {
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
		if msg.Error != nil {
			return *msg.Error
		}
		if msg.Poke != nil {
			t.Fatalf("expected a refusal, the socket heard %+v", *msg.Poke)
		}
	}
	t.Fatal("no refusal within deadline")
	return protocol.Error{}
}

// roadside opens a voice channel where Sven rides the session and Jan
// stands beside it with his phone — the roadside of ADR-0064.
func roadside(t *testing.T) (h *Hub, jan, sven *websocket.Conn) {
	t.Helper()
	h = New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/channels/{id}", h.HandleWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/channels/velvet"

	jan = dial(t, url, "jan:member")
	sven = dial(t, url, "sven:member")
	dial(t, url, "kai:member")
	eventually(t, "all three joined", func() bool {
		return h.Presence("velvet").Connected == 3
	})
	joinRide(h.room("velvet"), "sven")
	return h, jan, sven
}

func sendPoke(t *testing.T, conn *websocket.Conn, poke protocol.Poke) {
	t.Helper()
	if err := wsjson.Write(t.Context(), conn, protocol.ClientMessage{Poke: &poke}); err != nil {
		t.Fatalf("send poke: %v", err)
	}
}

// A bottle handed up from the roadside reaches the rider it names, sent by
// whoever authenticated the socket, and the hand that passed it hears that
// it landed (#3022).
func TestABottleReachesARiderInTheSession(t *testing.T) {
	_, jan, sven := roadside(t)
	sendPoke(t, jan, protocol.Poke{To: "sven", Kind: protocol.PokeKindBottle, FromID: "forged"})

	got := readPoke(t, sven)
	if got.Kind != protocol.PokeKindBottle || got.FromID != "jan" || got.From != "jan" || got.At == 0 {
		t.Fatalf("sven was handed %+v, want a bottle from jan", got)
	}
	if answer := readPoke(t, jan); answer.Kind != protocol.PokeKindBottle || answer.To != "sven" {
		t.Fatalf("jan's answer: %+v", answer)
	}
}

// A bottle is a session's: the valley it waits for is one of the session's
// blocks, so a rider standing in the channel without riding gets none — and
// the one who tried is told why rather than left pressing (errors.md).
func TestABottleForSomeoneNotRidingIsRefused(t *testing.T) {
	_, jan, _ := roadside(t)
	sendPoke(t, jan, protocol.Poke{To: "kai", Kind: protocol.PokeKindBottle})
	if refusal := readRefusal(t, jan); refusal.Code != "invalid_request" || refusal.Message == "" {
		t.Fatalf("refusal = %+v, want invalid_request with words", refusal)
	}
}

func TestAPokeOfNoKnownKindIsRefused(t *testing.T) {
	_, jan, _ := roadside(t)
	sendPoke(t, jan, protocol.Poke{To: "sven", Kind: "anvil"})
	if refusal := readRefusal(t, jan); refusal.Code != "validation_error" {
		t.Fatalf("refusal = %+v, want validation_error", refusal)
	}
}

// Handing up a bottle every second would be a harassment button with a
// nicer name. It takes the poke's cooldown on a key of its own: a second
// bottle waits, and says so, while a poke to the same rider still lands.
func TestABottleTakesThePokeCooldownOnItsOwnKey(t *testing.T) {
	_, jan, sven := roadside(t)
	sendPoke(t, jan, protocol.Poke{To: "sven", Kind: protocol.PokeKindBottle})
	readPoke(t, jan) // the first one's answer

	sendPoke(t, jan, protocol.Poke{To: "sven", Kind: protocol.PokeKindBottle})
	refusal := readRefusal(t, jan)
	if refusal.Code != "rate_limited" || !strings.Contains(refusal.Message, "bottle") {
		t.Fatalf("second bottle: %+v, want rate_limited about the bottle", refusal)
	}

	sendPoke(t, jan, protocol.Poke{To: "sven"})
	for {
		got := readPoke(t, sven)
		if got.Kind == "" {
			break // the poke, behind the first bottle
		}
	}
}
