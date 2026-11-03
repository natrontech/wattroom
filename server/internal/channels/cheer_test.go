package channels

import (
	"net/http"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// A cheer from afar (#3275) reaches only a rider the sender already sees on
// Home's around-now: someone in a voice channel the sender may enter. A
// private channel that does not name them, a crew they are not in or are
// banned from, and a rider who is not there all get nothing.
func TestACheerFromAfarReachesOnlyWhoAroundNowShows(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	cave := h.create(t, "voice", "Pain Cave", false)
	coaches := h.create(t, "voice", "Coaches", true)
	chat := h.create(t, "text", "General", false)
	id := func(who string) string { return store.UUIDString(h.users.ByToken[who].ID) }
	live.present = map[string]protocol.ChannelPresence{
		cave:    {RiderIDs: []string{id("dave")}},
		coaches: {RiderIDs: []string{id("alice")}},
	}
	cheer := func(who, channel, to, emoji string) (int, map[string]any) {
		t.Helper()
		return h.call(t, who, http.MethodPost, "/api/channels/"+channel+"/cheer",
			`{"to":"`+to+`","emoji":"`+emoji+`"}`)
	}

	for _, c := range []struct {
		name, who, channel, to, emoji string
		status                        int
		code, field                   string
	}{
		{"a private channel that does not name them", "bob", coaches, id("alice"), "flame", http.StatusNotFound, "not_found", ""},
		{"a rider who is not in that channel", "bob", cave, id("alice"), "flame", http.StatusNotFound, "not_found", ""},
		{"a chat channel", "bob", chat, id("dave"), "flame", http.StatusNotFound, "not_found", ""},
		{"a crew they are not in", "carol", cave, id("dave"), "flame", http.StatusNotFound, "not_found", ""},
		{"a crew they are banned from", "erin", cave, id("dave"), "flame", http.StatusNotFound, "not_found", ""},
		{"signed out", "", cave, id("dave"), "flame", http.StatusUnauthorized, "unauthorized", ""},
		{"themselves", "dave", cave, id("dave"), "flame", http.StatusBadRequest, "validation_error", "to"},
		{"not a cheer", "bob", cave, id("dave"), "<script>", http.StatusBadRequest, "validation_error", "emoji"},
	} {
		status, body := cheer(c.who, c.channel, c.to, c.emoji)
		if status != c.status || body["error"] != c.code || body["message"] == "" {
			t.Errorf("%s: %d %v, want %d %s with a message", c.name, status, body, c.status, c.code)
		}
		if c.field != "" && body["field"] != c.field {
			t.Errorf("%s: field %v, want %s", c.name, body["field"], c.field)
		}
	}
	if len(live.cheered) != 0 {
		t.Fatalf("a refused cheer reached the hub: %v", live.cheered)
	}

	if status, body := cheer("bob", cave, id("dave"), "flame"); status != http.StatusNoContent {
		t.Fatalf("bob cheering dave in an open voice channel: %d %v", status, body)
	}
	want := []string{cave + "/" + id("dave") + "/" + id("bob") + "/flame"}
	if !slices.Equal(live.cheered, want) {
		t.Fatalf("the hub was handed %v, want %v", live.cheered, want)
	}

	// The poke's cooldown, per sender and rider: a flood answers rate_limited,
	// and somebody else may still cheer the same rider.
	status, body := cheer("bob", cave, id("dave"), "flame")
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("bob's second cheer inside the cooldown: %d %v, want 429 rate_limited", status, body)
	}
	if status, body := cheer("alice", cave, id("dave"), "flame"); status != http.StatusNoContent {
		t.Fatalf("alice cheering dave after bob: %d %v", status, body)
	}
	if len(live.cheered) != 2 {
		t.Fatalf("the hub was handed %v, want bob's and alice's", live.cheered)
	}

	// A cheer is never a reward: nothing lands in either ledger.
	for _, table := range []string{"xp_events", "wallet_events"} {
		var n int
		if err := h.store.Pool.QueryRow(t.Context(),
			"select count(*) from "+table+" where user_id = any($1)",
			[]pgtype.UUID{h.users.ByToken["bob"].ID, h.users.ByToken["alice"].ID, h.users.ByToken["dave"].ID},
		).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("a cheer from afar wrote %d %s rows", n, table)
		}
	}
}
