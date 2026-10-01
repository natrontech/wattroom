package customworkouts

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A rider's shelf takes a workout on one of their own routes — Strava's too,
// since nobody else reads the shelf — reads it back with the whole road, and
// refuses someone else's route (#3051).
func TestTheShelfRidesOnlyTheRidersOwnRoads(t *testing.T) {
	_, st, users := setup(t)
	mux := http.NewServeMux()
	shelf := New(st, users, slog.New(slog.DiscardHandler))
	shelf.SetRoads(routes.NewAttacher(st.Queries, nil))
	shelf.Register(mux)
	routeOf := func(who, src string) string {
		row, err := st.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
			OwnerID: users.ByToken[who].ID, Src: src, Name: "Home loop", GenName: "Road · 3.0 km · 50 m",
			Road: testx.TellingRoad(), RoadHash: "telling", LengthM: 3000, GainM: 50,
			Climbs: []byte("[]"), EleSource: "file",
		})
		if err != nil {
			t.Fatal(err)
		}
		return store.UUIDString(row.ID)
	}
	body := func(route string) string {
		return `{"workout":{"name":"Home loop","road":{"routeId":"` + route + `","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}}`
	}

	status, got := call(t, mux, "alice", http.MethodPost, "/api/workouts", body(routeOf("alice", "stravagpx")))
	if status != http.StatusCreated {
		t.Fatalf("alice saving a workout on her own Strava route: %d %v", status, got)
	}
	status, list := call(t, mux, "alice", http.MethodGet, "/api/workouts", "")
	if status != http.StatusOK || !strings.Contains(stringify(list), `profile`) || strings.Contains(stringify(list), `originM":400`) {
		t.Fatalf("alice's shelf reads %d %v, want her road whole", status, list)
	}
	status, got = call(t, mux, "bob", http.MethodPost, "/api/workouts", body(routeOf("alice", "gpx")))
	if status != http.StatusForbidden || got["field"] != "workout" {
		t.Errorf("bob saving a workout on alice's route: %d %v, want 403 on workout", status, got)
	}
}

// stringify is a decoded answer as text, to look for what should not be in it.
func stringify(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}
