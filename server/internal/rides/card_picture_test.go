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
// road's poster, named by the road's numbers; a workout on a road is the
// workout — its blocks under the watts, titled by the workout's own name,
// the road said under it in numbers only — and a workout on no road is the
// workout too, with no road to say. The ride's page reads the same word for
// its button.
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
		title   string // the title's start
		road    string // the road line's start; "" for none
	}{
		{"a free ride on a road", freeRideOn(route, 8, ""), true, nil, "free", "Road · 0.9 km", ""},
		{"a workout on a road", workoutOn(route), false, []float64{150, 250}, "workout", "Openers", "Virtual route · 0.9 km · "},
		{"a workout on no road", rideBody(120, 200), false, []float64{200, 200}, "workout", "Openers", ""},
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
			if !strings.HasPrefix(card.WorkoutName, tc.title) || strings.Contains(card.WorkoutName+card.RoadLine, "Home loop") {
				t.Errorf("titled %q, want it to start %q and never name the road", card.WorkoutName, tc.title)
			}
			if tc.road == "" && card.RoadLine != "" || !strings.HasPrefix(card.RoadLine, tc.road) {
				t.Errorf("road line %q, want it to start %q", card.RoadLine, tc.road)
			}
			if _, detail := call(t, h.mux, "alice", http.MethodGet, "/api/rides/"+id, ""); detail["rideMode"] != tc.mode {
				t.Errorf("the page reads its mode as %v, want %q", detail["rideMode"], tc.mode)
			}
		})
	}

	// The picture is posted: it never carries the ride's heart rate (WATTROOM.md).
	if card := cardOf(saved(workoutOn(route))); card.AvgHR != 0 || card.HR != nil {
		t.Errorf("heart rate on the ride's picture: %d on average", card.AvgHR)
	}
}
