package routes

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// storeTellingRoute gives owner the telling road — ends that give themselves
// away — from src, and returns its id.
func storeTellingRoute(t *testing.T, h *harness, owner pgtype.UUID, src string) string {
	t.Helper()
	row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: owner, Src: src, Name: "Home loop", GenName: "Road · 3.0 km · 50 m",
		Road: testx.TellingRoad(), RoadHash: "telling", LengthM: 3000, GainM: 50,
		Climbs: []byte("[]"), EleSource: "file",
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	return store.UUIDString(row.ID)
}

func workoutOn(routeID string) string {
	return `{"name":"Home loop","road":{"routeId":"` + routeID + `","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}`
}

// roadIn reads the road a reader was handed off an attached workout.
func roadIn(t *testing.T, workoutJSON string) (road.Road, attached) {
	t.Helper()
	var w struct {
		Road attached `json:"road"`
	}
	if err := json.Unmarshal([]byte(workoutJSON), &w); err != nil {
		t.Fatalf("attached workout unreadable: %v", err)
	}
	if w.Road.Profile == "" {
		return road.Road{}, w.Road
	}
	raw, err := base64.StdEncoding.DecodeString(w.Road.Profile)
	if err != nil {
		t.Fatal(err)
	}
	r, err := road.UnpackRoad(raw)
	if err != nil {
		t.Fatalf("attached profile unreadable: %v", err)
	}
	return r, w.Road
}

// assertNothingOfTheEnds is ADR-0063's promise, checked on what a reader
// holds: no height of a hidden end, no turn of one, no absolute altitude.
func assertNothingOfTheEnds(t *testing.T, what string, r road.Road, a attached) {
	t.Helper()
	if a.OriginM < protocol.RouteHiddenEndM {
		t.Errorf("%s starts %v m along the road, inside the hidden %d m", what, a.OriginM, protocol.RouteHiddenEndM)
	}
	for i, h := range r.Heights {
		if h != 0 {
			t.Fatalf("%s: height %d is %v m — an end's rise or an absolute altitude reached the crew", what, i, h)
		}
	}
	for i, turn := range r.Turns {
		if turn == testx.TellingEndTurn {
			t.Fatalf("%s: turn %d is a hidden end's", what, i)
		}
	}
	if len(r.Heights) == 0 {
		t.Fatalf("%s carries no road at all, so nothing above was checked", what)
	}
}

// ADR-0063, through every door a workout leaves by (#3051): the owner reads
// their whole road; a crew member, and every socket a pick reaches, gets the
// stretch between the anchors with its heights from zero — no point, heading
// or height of the ends the route hides.
func TestARoadIsCutToWhoeverReadsIt(t *testing.T) {
	h := setup(t, nil)
	alice, bob := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID
	route := storeTellingRoute(t, h, alice, "gpx")
	a := NewAttacher(h.store.Queries)

	own, err := a.Attach(t.Context(), workoutOn(route), alice)
	if err != nil {
		t.Fatal(err)
	}
	whole, meta := roadIn(t, own)
	if meta.OriginM != 0 || len(whole.Heights) != 151 || whole.Heights[0] != 800+testx.TellingEndRiseM {
		t.Errorf("the owner read %d samples from %v m starting at %v m high, want the whole 151 from 0 at 850", len(whole.Heights), meta.OriginM, whole.Heights[0])
	}

	crews, err := a.Attach(t.Context(), workoutOn(route), bob)
	if err != nil {
		t.Fatal(err)
	}
	cut, meta := roadIn(t, crews)
	assertNothingOfTheEnds(t, "a crew member's read", cut, meta)

	picked, refusal, err := a.ForSession(t.Context(), store.UUIDString(alice), workoutOn(route))
	if err != nil || refusal != "" {
		t.Fatalf("the owner's pick: %q %v", refusal, err)
	}
	cut, meta = roadIn(t, picked)
	assertNothingOfTheEnds(t, "a pick, on every socket", cut, meta)
}

// Only a route's owner puts it where others read it, and a route from Strava
// never goes there at all; the owner's own shelf takes either.
func TestOnlyTheOwnerSharesARoadAndNeverStravas(t *testing.T) {
	h := setup(t, nil)
	alice, bob := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID
	mine := storeTellingRoute(t, h, alice, "gpx")
	strava := storeTellingRoute(t, h, alice, "stravagpx")
	a := NewAttacher(h.store.Queries)
	var refused Refused

	if _, err := a.CheckShared(t.Context(), workoutOn(mine), bob); !errors.As(err, &refused) {
		t.Errorf("bob sharing alice's route: %v, want refused", err)
	}
	if _, err := a.CheckShared(t.Context(), workoutOn(strava), alice); !errors.As(err, &refused) {
		t.Errorf("alice sharing a Strava route: %v, want refused", err)
	}
	if id, err := a.CheckShared(t.Context(), workoutOn(mine), alice); err != nil || store.UUIDString(id) != mine {
		t.Errorf("alice sharing her own route: %v %v", id, err)
	}
	if err := a.CheckOwn(t.Context(), workoutOn(strava), alice); err != nil {
		t.Errorf("alice's shelf refused her own Strava route: %v", err)
	}
	if err := a.CheckOwn(t.Context(), workoutOn(mine), bob); !errors.As(err, &refused) {
		t.Errorf("bob's shelf took alice's route: %v", err)
	}
	if _, refusal, err := a.ForSession(t.Context(), store.UUIDString(bob), workoutOn(mine)); err != nil || refusal == "" {
		t.Errorf("bob picking alice's route: %q %v, want a refusal", refusal, err)
	}
}

// A deleted route leaves its reference, which reads "the route was deleted".
func TestADeletedRouteSaysSo(t *testing.T) {
	h := setup(t, nil)
	alice := h.users.ByToken["alice"].ID
	route := storeTellingRoute(t, h, alice, "gpx")
	if _, err := h.store.Pool.Exec(t.Context(), "delete from routes where id = $1", route); err != nil {
		t.Fatal(err)
	}
	out, err := NewAttacher(h.store.Queries).Attach(t.Context(), workoutOn(route), alice)
	if err != nil {
		t.Fatal(err)
	}
	if _, meta := roadIn(t, out); !meta.Deleted || meta.Profile != "" || meta.RouteID != route {
		t.Errorf("a deleted route's workout reads %+v, want its reference and deleted", meta)
	}
}
