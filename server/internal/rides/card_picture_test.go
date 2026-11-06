package rides

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/og"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// workoutOn is a two-minute workout on storeRoute's road at 250 W: a minute
// at 60 % of FTP, then a minute at FTP.
func workoutOn(routeID string) string {
	samples := make([]string, 120)
	for i := range samples {
		samples[i] = fmt.Sprintf(`{"watts":250,"cadence":90,"hr":%d,"m":%d}`, 120+i/4, 1000+8*i)
	}
	workout := `{"name":"Openers","road":{"routeId":"` + routeID + `","fromM":0,"toM":5000},` +
		`"steps":[{"type":"steady","seconds":60,"target":0.6},{"type":"steady","seconds":60,"target":1.0}]}`
	return fmt.Sprintf(`{"workoutName":"Openers","workoutJson":%q,"startedAt":%q,"samples":[%s],"routeId":%q}`,
		workout, nextStart().Format(time.RFC3339), strings.Join(samples, ","), routeID)
}

// Which picture a saved ride gets (#4430): a free ride on a road is its
// road's poster; a workout on a road is the workout — its blocks under the
// watts, its heart rate, the road under them — and a workout on no road is
// the workout too. The ride's page reads the same word for its button.
func TestWhichPictureASavedRideGets(t *testing.T) {
	h := setup(t)
	route, _ := storeRoute(t, h, "alice")
	alice := h.users.ByToken["alice"]
	svc := New(h.store, h.users, slog.New(slog.DiscardHandler))
	saved := func(body string) string {
		t.Helper()
		status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", body)
		if status != http.StatusCreated {
			t.Fatalf("save: %d %v", status, got)
		}
		id, _ := got["id"].(string)
		return id
	}
	cardOf := func(id string) og.RideCard {
		t.Helper()
		rideID, err := store.ParseUUID(id)
		if err != nil {
			t.Fatal(err)
		}
		row, err := h.store.Queries.GetRide(t.Context(), db.GetRideParams{ID: rideID, UserID: alice.ID})
		if err != nil {
			t.Fatalf("read ride: %v", err)
		}
		return svc.cardOf(t.Context(), alice, row)
	}

	for _, tc := range []struct {
		name    string
		body    string
		poster  bool
		targets []float64 // at seconds 30 and 90; nil for none
		mode    string
	}{
		{"a free ride on a road", freeRideOn(route, 8, ""), true, nil, "free"},
		{"a workout on a road", workoutOn(route), false, []float64{150, 250}, "workout"},
		{"a workout on no road", rideBody(120, 200), false, []float64{200, 200}, "workout"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := saved(tc.body)
			card := cardOf(id)
			if card.Poster() != tc.poster {
				t.Errorf("poster = %v, want %v", card.Poster(), tc.poster)
			}
			switch {
			case tc.targets == nil && card.Targets != nil:
				t.Errorf("blocks %v on a ride with no workout", card.Targets[:3])
			case tc.targets != nil && (len(card.Targets) != 120 || card.Targets[30] != tc.targets[0] || card.Targets[90] != tc.targets[1]):
				t.Errorf("targets at 30 s and 90 s are not %v: %d seconds", tc.targets, len(card.Targets))
			}
			if _, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, ""); detail["rideMode"] != tc.mode {
				t.Errorf("the page reads its mode as %v, want %q", detail["rideMode"], tc.mode)
			}
		})
	}

	// The workout on a road carries its heart rate: 120 to 149 bpm, 134.5 on
	// average, rounded.
	if card := cardOf(saved(workoutOn(route))); card.AvgHR != 135 || card.HR[0] != 120 {
		t.Errorf("heart rate %d at the start, %d on average; want 120 and 135", card.HR[0], card.AvgHR)
	}
}
