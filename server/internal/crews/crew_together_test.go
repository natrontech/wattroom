package crews

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The crew's time together in voice (lounge.md) is on its room, for its
// members: zero for a new crew, and what the hub's minutes added after.
func TestTheRoomSaysHowLongTheCrewHungOutTogether(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)
	together := func(who string) any {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/crews/"+crew+"/room", nil)
		req.Header.Set("X-Test-User", who)
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s reading the room: %d %s", who, w.Code, w.Body.String())
		}
		var room map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &room); err != nil {
			t.Fatal(err)
		}
		return room["togetherSec"]
	}
	if got := together("alice"); got != 0.0 {
		t.Fatalf("a new crew's time together: %v, want 0", got)
	}
	id, err := store.ParseUUID(crew)
	if err != nil {
		t.Fatal(err)
	}
	voice, err := h.store.Queries.CreateChannel(t.Context(), db.CreateChannelParams{
		CrewID: id, Kind: "voice", Name: "Hangout", MaxChannels: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.store.Queries.AddCrewTogether(t.Context(), db.AddCrewTogetherParams{
		Seconds: 120, ChannelIds: []pgtype.UUID{voice.ID},
	}); err != nil {
		t.Fatal(err)
	}
	if got := together("bob"); got != 120.0 {
		t.Fatalf("two minutes together: %v, want 120", got)
	}
}
