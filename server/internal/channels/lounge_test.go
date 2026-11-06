package channels

import (
	"log/slog"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

func TestLoungeKeeperRoundTrip(t *testing.T) {
	h := setup(t)
	channel := h.create(t, "voice", "Lounge", false)
	k := NewLoungeKeeper(t.Context(), h.store, slog.New(slog.DiscardHandler))
	if _, ok := k.Load(channel); ok {
		t.Fatal("a room nobody touched came back as if it had been left somehow")
	}
	want := protocol.LoungeState{LampOff: true, Weather: "snow", Fire: true, Pets: 3}
	k.Save(channel, protocol.LoungeState{Weather: "clear"})
	k.Save(channel, want)
	k.flush(t.Context())
	got, ok := k.Load(channel)
	if !ok || got != want {
		t.Fatalf("the room came back as %+v (%v), want %+v", got, ok, want)
	}
	if _, ok := k.Load("not-a-channel"); ok {
		t.Fatal("a place that is no channel has a room")
	}
}
