package hub

import (
	"testing"

	"github.com/coder/websocket/wsjson"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// A cheer from afar (#3275) rides the named rider's own tick and nobody
// else's: the bystander beside them never sees it, and across a hidden pair
// it reaches nobody while the sender is answered as if it landed (#3202).
func TestACheerFromAfarReachesOnlyThatRider(t *testing.T) {
	from := protocol.Cheer{Emoji: "flame", From: "jan", FromID: "jan", To: "sven"}

	t.Run("lands on the rider alone", func(t *testing.T) {
		h, url := hiddenHub(t, hidPair{"kai", "ruben"})
		sven := dial(t, url, "sven:member")
		kai := dial(t, url, "kai:member")
		eventually(t, "two riders joined", func() bool { return h.Presence("velvet").Connected == 2 })

		if h.CheerAfar("velvet", protocol.Cheer{Emoji: "flame", FromID: "jan", To: "ruben"}) {
			t.Fatal("a rider who is not in the channel was cheered")
		}
		if h.CheerAfar("elsewhere", from) {
			t.Fatal("a channel nobody is in was cheered")
		}
		if !h.CheerAfar("velvet", from) {
			t.Fatal("sven is in the channel, and the cheer did not land")
		}
		seen := tickWithCheers(t, sven)
		want := from
		want.Afar = true
		if len(seen.Cheers) != 1 || seen.Cheers[0] != want {
			t.Fatalf("sven heard %+v, want %+v", seen.Cheers, want)
		}
		if got := cheersUpTo(t, kai, seen.At); len(got) != 0 {
			t.Fatalf("the bystander heard sven's cheer from afar: %+v", got)
		}
	})

	t.Run("goes nowhere across a hidden pair", func(t *testing.T) {
		h, url := hiddenHub(t, hidPair{"jan", "sven"})
		sven := dial(t, url, "sven:member")
		kai := dial(t, url, "kai:member")
		eventually(t, "two riders joined", func() bool { return h.Presence("velvet").Connected == 2 })

		if !h.CheerAfar("velvet", from) {
			t.Fatal("the sender was told sven hid them")
		}
		// A cheer for everyone after it: every tick up to the one carrying
		// it would have carried the cheer from afar too.
		if err := wsjson.Write(t.Context(), kai, protocol.ClientMessage{
			Cheer: &protocol.Cheer{Emoji: "flame"},
		}); err != nil {
			t.Fatalf("cheer: %v", err)
		}
		seen := tickWithCheers(t, sven)
		for _, c := range seen.Cheers {
			if c.FromID != "kai" {
				t.Fatalf("a cheer crossed the hidden pair: %+v", seen.Cheers)
			}
		}
	})
}
