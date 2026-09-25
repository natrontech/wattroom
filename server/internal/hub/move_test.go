package hub

import (
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A move reaches every screen the rider has in the channel and nobody else's
// (#2730), and never a rider who is pedalling: it would end their ride.
func TestMoveSendsOnlyTheMovedRiderAndNeverOneRiding(t *testing.T) {
	to := protocol.Moved{Channel: "lair", Name: "Lair", By: "Jan"}
	for _, tc := range []struct {
		name   string
		rider  string
		pedals bool
		want   error
	}{
		{"on the page, both tabs go", "kim", false, nil},
		{"pedalling stays put", "kim", true, ErrRiding},
		{"already gone", "nobody", false, ErrNotInChannel},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := New(slog.New(slog.DiscardHandler), nil, nil)
			now := time.Now()
			h.now = func() time.Time { return now }
			rm := newRoom("cave")
			h.rooms["cave"] = rm
			socket := func(id string) *client {
				c := &client{rider: protocol.Rider{ID: id, Name: id}, out: make(chan []byte, clientQueue)}
				rm.join(c)
				return c
			}
			kimDesk, kimPhone, sven := socket("kim"), socket("kim"), socket("sven")
			if tc.pedals {
				rm.lastWatts["kim"] = now
			}

			if err := h.Move("cave", tc.rider, to); !errors.Is(err, tc.want) {
				t.Fatalf("Move = %v, want %v", err, tc.want)
			}
			moved := func(c *client) bool {
				for {
					select {
					case frame := <-c.out:
						var msg protocol.ServerMessage
						if json.Unmarshal(frame, &msg) == nil && msg.Moved != nil {
							return *msg.Moved == to
						}
					default:
						return false
					}
				}
			}
			sent := tc.want == nil
			if desk, phone := moved(kimDesk), moved(kimPhone); desk != sent || phone != sent {
				t.Errorf("kim's sockets heard the move: desk %v, phone %v, want %v", desk, phone, sent)
			}
			if moved(sven) {
				t.Error("sven heard a move addressed to kim")
			}
		})
	}
	if err := New(slog.New(slog.DiscardHandler), nil, nil).Move("empty", "kim", to); !errors.Is(err, ErrNotInChannel) {
		t.Errorf("a channel nobody is in: %v, want ErrNotInChannel", err)
	}
}
