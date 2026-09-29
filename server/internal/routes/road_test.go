package routes

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// riding is the hub as the road endpoint asks it: which channels ride a route.
type riding map[string][]string

func (r riding) ChannelsRiding(route string) []string { return r[route] }

// crewOf puts alice's route in reach: a crew of alice and bob, a voice channel,
// and carol, who is in neither. The route rides nowhere yet.
type crewOf struct {
	h       *harness
	route   string
	hash    string
	crew    pgtype.UUID
	channel string
	carol   pgtype.UUID
}

func roadSetup(t *testing.T) *crewOf {
	t.Helper()
	h := setup(t, testKey(t, "k"))
	route := h.keep(t, "alice")
	carol, err := h.store.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "carol", FtpWatts: 250, WeightKg: 70})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from users where id = $1", carol.ID) })
	h.users.ByToken["carol"] = carol
	crew := testx.Crew(t, h.store, "Road crew", h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID)
	var hash string
	if err := h.store.Pool.QueryRow(t.Context(), "select road_hash from routes where id = $1", route).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	return &crewOf{h: h, route: route, hash: hash, crew: crew, channel: testx.Voice(t, h.store, crew, "Road", false), carol: carol.ID}
}

// plan puts the route on the crew's shelf.
func (c *crewOf) plan(t *testing.T) {
	t.Helper()
	id, _ := store.ParseUUID(c.route)
	if _, err := c.h.store.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
		CrewID: c.crew, WorkoutName: "Road", WorkoutJson: []byte(`{"name":"Road","steps":[]}`),
		StartsAt: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true}, CreatedBy: c.h.users.ByToken["alice"].ID, RouteID: id,
	}); err != nil {
		t.Fatal(err)
	}
}

func (c *crewOf) road(t *testing.T, who, h string) (int, map[string]any, http.Header) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/routes/"+c.route+"/road?h="+h, nil)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	w := httptest.NewRecorder()
	c.h.mux.ServeHTTP(w, req)
	status, body := w.Code, map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return status, body, w.Header()
}

// servedRoad reads a /road answer's road.
func servedRoad(t *testing.T, body map[string]any) road.Road {
	t.Helper()
	raw, _ := body["road"].(string)
	packed, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		t.Fatal(err)
	}
	r, err := road.UnpackRoad(packed)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// ADR-0063 through the road endpoint (#3096): the owner reads the whole road;
// a member of a crew whose plan carries it reads only the stretch between the
// anchors, from zero; a rider who does not ride it with anyone is refused —
// and every reader gets the route's secret, cached by the road's hash.
func TestTheRoadReachesOnlyTheCrewsThatRideIt(t *testing.T) {
	c := roadSetup(t)
	if status, _, _ := c.road(t, "bob", c.hash); status != http.StatusForbidden {
		t.Fatalf("bob before any plan: %d, want 403", status)
	}
	c.plan(t)

	status, body, header := c.road(t, "alice", c.hash)
	whole := servedRoad(t, body)
	if status != http.StatusOK || body["originM"] != 0.0 || whole.LengthM != 3000 {
		t.Fatalf("the owner's road: %d from %v m, %v m long", status, body["originM"], whole.LengthM)
	}
	if header.Get("Cache-Control") != roadCache {
		t.Errorf("the road caches %q, want %q", header.Get("Cache-Control"), roadCache)
	}
	key := c.h.worldKey(t)
	if !bytes.Equal(secretOf(t, body["secret"]), key.RouteSecret(c.route)) {
		t.Error("the owner's road carries another secret than the route's")
	}

	status, body, _ = c.road(t, "bob", c.hash)
	cut := servedRoad(t, body)
	if status != http.StatusOK || body["originM"] != float64(protocol.RouteHiddenEndM) || cut.LengthM != 3000-2*protocol.RouteHiddenEndM || cut.Heights[0] != 0 {
		t.Fatalf("bob's road: %d from %v m, %v m long, starting %v m up — want the crew's cut", status, body["originM"], cut.LengthM, cut.Heights[0])
	}
	if !bytes.Equal(secretOf(t, body["secret"]), key.RouteSecret(c.route)) {
		t.Error("the crew's road carries another secret than the route's")
	}

	for _, r := range []struct {
		name, who, h string
		want         int
	}{
		{"carol, in no crew of it", "carol", c.hash, http.StatusForbidden},
		{"signed out", "", c.hash, http.StatusUnauthorized},
		{"another road's hash", "bob", "not-this-road", http.StatusNotFound},
		{"no hash", "bob", "", http.StatusBadRequest},
	} {
		if status, _, _ := c.road(t, r.who, r.h); status != r.want {
			t.Errorf("%s: %d, want %d", r.name, status, r.want)
		}
	}
}

// A session riding the route opens it to its channel's members, for as long
// as it rides — carol, named into nothing, still is not one.
func TestASessionOpensTheRoadToItsChannel(t *testing.T) {
	c := roadSetup(t)
	c.h.svc.SetRiding(riding{c.route: {c.channel}})
	if status, body, _ := c.road(t, "bob", c.hash); status != http.StatusOK || body["originM"] != float64(protocol.RouteHiddenEndM) {
		t.Fatalf("bob in the riding channel: %d %v", status, body["originM"])
	}
	if status, _, _ := c.road(t, "carol", c.hash); status != http.StatusForbidden {
		t.Errorf("carol, not in the crew: %d, want 403", status)
	}
	c.h.svc.SetRiding(riding{})
	if status, _, _ := c.road(t, "bob", c.hash); status != http.StatusForbidden {
		t.Errorf("bob once the session ends: %d, want 403", status)
	}
}

// The crew's map is the span between the anchors: none of the owner's ends.
// A crew anyone can join sees it only once the owner has said yes for that
// crew, and not after they say no.
func TestTheCrewsMapIsTheSpanAndAListedCrewIsAskedFirst(t *testing.T) {
	c := roadSetup(t)
	shapeOf := func(who string) (int, []road.LatLon) {
		t.Helper()
		status, body := c.h.call(t, who, http.MethodGet, "/api/routes/"+c.route+"/shape", nil)
		if status != http.StatusOK {
			return status, nil
		}
		s, _ := body["shape"].(string)
		points, err := road.DecodePolyline6(s, -1)
		if err != nil {
			t.Fatal(err)
		}
		return status, points
	}
	if status, _ := shapeOf("bob"); status != http.StatusForbidden {
		t.Fatalf("bob before any plan: %d, want 403", status)
	}
	c.plan(t)
	status, span := shapeOf("bob")
	if status != http.StatusOK || len(span) < 2 {
		t.Fatalf("bob's map: %d, %d points", status, len(span))
	}
	whole, err := road.DecodePolyline6(shape, -1)
	if err != nil {
		t.Fatal(err)
	}
	for _, end := range []road.LatLon{whole[0], whole[len(whole)-1]} {
		for _, p := range span {
			if metresBetween(p, end) < protocol.RouteHiddenEndM-1 {
				t.Fatalf("bob's map comes within %.0f m of the route's end %v", metresBetween(p, end), end)
			}
		}
	}
	if status, _ := shapeOf("carol"); status != http.StatusForbidden {
		t.Errorf("carol's map: %d, want 403", status)
	}

	if _, err := c.h.store.Pool.Exec(t.Context(), "update crews set listed = true where id = $1", c.crew); err != nil {
		t.Fatal(err)
	}
	consent := func(who string, body any) int {
		t.Helper()
		status, _ := c.h.call(t, who, http.MethodPut, "/api/routes/"+c.route+"/crews/"+store.UUIDString(c.crew), body)
		return status
	}
	if status, _ := shapeOf("bob"); status != http.StatusForbidden {
		t.Fatalf("a listed crew's map before the owner said yes: %d, want 403", status)
	}
	if status := consent("alice", map[string]bool{"shared": true}); status != http.StatusNoContent {
		t.Fatalf("alice says yes: %d", status)
	}
	if status, _ := shapeOf("bob"); status != http.StatusOK {
		t.Fatalf("a listed crew's map once the owner said yes: %d", status)
	}
	if status := consent("alice", map[string]bool{"shared": false}); status != http.StatusNoContent {
		t.Fatalf("alice says no: %d", status)
	}
	if status, _ := shapeOf("bob"); status != http.StatusForbidden {
		t.Errorf("a listed crew's map once the owner said no: %d, want 403", status)
	}
	if status, _, _ := c.road(t, "bob", c.hash); status != http.StatusOK {
		t.Errorf("the road rides on without the map: %d", status)
	}

	for _, r := range []struct {
		name, who string
		body      any
		want      int
	}{
		{"not the owner", "bob", map[string]bool{"shared": true}, http.StatusNotFound},
		{"no answer", "alice", map[string]string{}, http.StatusBadRequest},
		{"signed out", "", map[string]bool{"shared": true}, http.StatusUnauthorized},
	} {
		if status := consent(r.who, r.body); status != r.want {
			t.Errorf("%s: %d, want %d", r.name, status, r.want)
		}
	}
	if status, _ := c.h.call(t, "alice", http.MethodPut, "/api/routes/"+c.route+"/crews/00000000-0000-4000-8000-000000000001", map[string]bool{"shared": true}); status != http.StatusNotFound {
		t.Errorf("a crew alice is not in: %d, want 404", status)
	}
}
