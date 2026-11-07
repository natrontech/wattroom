package crews

import (
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The km stone counts the crew's sessions only for riders on the weekly
// board, the one consent a crew number from rides rests on (lounge.md).
func TestTheKmStoneCountsOnlyBoardRiders(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Stone Crew")
	h.joinCrew(t, "bob", codeOf(crew.Code))
	voice := h.channel(t, crew, "voice", "Ride", false)
	ride := func(who string, metres int) {
		if _, err := h.store.Pool.Exec(t.Context(),
			`insert into rides (user_id, crew_id, channel_id, workout_name, started_at, seconds, avg_watts, kj, execution, ftp_watts, samples, distance_m)
			 values ($1, $2, $3, 'Openers', $4, 1800, 200, 400, 0.9, 250, ''::bytea, $5)`,
			h.users.ByToken[who].ID, crew.ID, voice, time.Now(), metres); err != nil {
			t.Fatalf("ride: %v", err)
		}
	}
	ride("alice", 20_000)
	ride("bob", 30_000)
	stone := func() any {
		status, body := h.call(t, "alice", http.MethodGet, crewPath(crew)+"/room", "")
		if status != http.StatusOK {
			t.Fatalf("room: %d %v", status, body)
		}
		return body["boardMetres"]
	}
	if got := stone(); got != 0.0 {
		t.Fatalf("nobody is on the board, yet the stone says %v m", got)
	}
	if status, _ := h.call(t, "bob", http.MethodPatch, crewPath(crew)+"/me", `{"notify":true,"onBoard":true}`); status != http.StatusOK {
		t.Fatalf("bob on the board: %d", status)
	}
	if got := stone(); got != 30_000.0 {
		t.Fatalf("the stone says %v m, want bob's 30000", got)
	}
}

func TestTimeTogetherUnlocksWhatIsNotForSale(t *testing.T) {
	for _, tc := range []struct {
		hours float64
		want  []string
	}{
		{0, nil},
		{9.99, nil},
		{10, []string{"rug.fondue"}},
		{50, []string{"rug.fondue", "sign.bike", "sofa.velvet"}},
	} {
		got := unlockedBy(int64(tc.hours * 3600))
		if len(got) != len(tc.want) {
			t.Errorf("%v h: %v, want %v", tc.hours, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("%v h: %v, want %v", tc.hours, got, tc.want)
			}
		}
	}

	h := setup(t)
	crew := h.newCrew(t, "alice", "Sofa Crew")
	voice := h.channel(t, crew, "voice", "Hangout", false)
	path := crewPath(crew) + "/room"
	if status, body := h.call(t, "alice", http.MethodPost, path+"/items/rug.fondue", ""); status != http.StatusConflict {
		t.Fatalf("an unlock was sold: %d %v", status, body)
	}
	if status, _ := h.call(t, "alice", http.MethodPut, path+"/picks", `{"slot":"rug","item":"rug.fondue"}`); status != http.StatusConflict {
		t.Fatalf("a locked rug went down: %d", status)
	}
	if err := h.store.Queries.AddCrewTogether(t.Context(), db.AddCrewTogetherParams{
		Seconds: 10 * 3600, ChannelIds: []pgtype.UUID{voice},
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := h.call(t, "alice", http.MethodPut, path+"/picks", `{"slot":"rug","item":"rug.fondue"}`); status != http.StatusNoContent {
		t.Fatalf("an unlocked rug would not go down: %d %v", status, body)
	}
	_, room := h.call(t, "alice", http.MethodGet, path, "")
	owned, _ := room["owned"].([]any)
	if len(owned) != 1 || owned[0] != "rug.fondue" {
		t.Fatalf("the room owns %v, want the unlocked rug", owned)
	}
}
