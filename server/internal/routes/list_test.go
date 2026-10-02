package routes

import (
	"net/http"
	"testing"
	"time"
)

// listed is the owner's list entry for one route id.
func listed(t *testing.T, h *harness, user, id string) map[string]any {
	t.Helper()
	status, body := h.call(t, user, http.MethodGet, "/api/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list: %d %v", status, body)
	}
	routes, _ := body["routes"].([]any)
	for i := range routes {
		if r := entry(routes, i); r["id"] == id {
			return r
		}
	}
	t.Fatalf("route %s is not on %s's list: %v", id, user, routes)
	return nil
}

// The list says how its owner has ridden each road (#3683): their own rides
// of its key and the latest's time, and where the latest ridden alone
// stopped short — never anybody else's ride, even of the same road.
func TestTheListCountsYourOwnRidesOfTheRoad(t *testing.T) {
	h := setup(t, nil)
	alice, bob := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID
	route, key := climbingRoute(t, h, alice)

	fresh := listed(t, h, "alice", route)
	if fresh["rides"] != float64(0) || fresh["lastRiddenAt"] != nil || fresh["carryOnM"] != nil {
		t.Fatalf("an unridden road reads %v, want 0 rides and nothing else", fresh)
	}

	seedRide(t, h, ride{who: alice, key: key, roadH: key, distanceM: 3000, mps: 6, ago: 48 * time.Hour})
	seedRide(t, h, ride{who: alice, key: key, roadH: key, fromM: 500, distanceM: 1200, mps: 6, ago: time.Hour})
	seedRide(t, h, ride{who: bob, key: key, roadH: key, distanceM: 3000, mps: 12, ago: time.Minute})

	got := listed(t, h, "alice", route)
	if got["rides"] != float64(2) {
		t.Errorf("rides = %v, want alice's own 2 and never bob's", got["rides"])
	}
	if got["carryOnM"] != float64(1700) {
		t.Errorf("carryOnM = %v, want 1700: the latest ride alone began at 500 and kept 1200", got["carryOnM"])
	}
	last, _ := time.Parse(time.RFC3339Nano, got["lastRiddenAt"].(string))
	if time.Since(last) < 30*time.Minute {
		t.Errorf("lastRiddenAt = %v, want alice's own latest, an hour ago, not bob's", last)
	}
}

// A road ridden to its end leaves nothing to carry on from.
func TestARoadRiddenToTheEndOffersNoCarryOn(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"].ID
	route, key := climbingRoute(t, h, alice)
	// Metres are kept whole: a ride to the end may land a metre short.
	seedRide(t, h, ride{who: alice, key: key, roadH: key, distanceM: 2999, mps: 6, ago: time.Hour})
	if got := listed(t, h, "alice", route); got["carryOnM"] != nil {
		t.Errorf("carryOnM = %v after a ride to the end, want none", got["carryOnM"])
	}
}

// A route from Strava rides owner-only (ADR-0063), and still lists with its
// counts.
func TestARouteFromStravaStillLists(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"].ID
	strava := storeTellingRoute(t, h, alice, stravaSrc)
	got := listed(t, h, "alice", strava)
	if got["ownerOnly"] != true || got["rides"] != float64(0) {
		t.Errorf("the Strava route lists as %v, want ownerOnly and 0 rides", got)
	}
}

func TestCarryOnIsShortOfTheEnd(t *testing.T) {
	n := func(v int32) *int32 { return &v }
	for _, c := range []struct {
		name           string
		from, distance *int32
		want           *int32
	}{
		{"never ridden alone", nil, nil, nil},
		{"rode nothing", n(0), n(0), nil},
		{"stopped partway from the start", nil, n(1200), n(1200)},
		{"stopped partway from km 0.5", n(500), n(1200), n(1700)},
		{"a metre short is the end", nil, n(2999), nil},
		{"past the end in laps", nil, n(4500), nil},
	} {
		got := carryOn(c.from, c.distance, 3000)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s: carryOn = %v, want %v", c.name, deref(got), deref(c.want))
		}
	}
}

func deref(p *int32) any {
	if p == nil {
		return nil
	}
	return *p
}
