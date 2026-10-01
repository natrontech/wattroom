package routes

import (
	"bytes"
	"encoding/base64"
	"log/slog"
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// storedRoad is a route's road column and its seal, as a dump would read them.
func (h *harness) storedRoad(t *testing.T, id string) (road.Road, []byte) {
	t.Helper()
	var stored, sealed []byte
	if err := h.store.Pool.QueryRow(t.Context(), "select road, road_sealed from routes where id = $1", id).Scan(&stored, &sealed); err != nil {
		t.Fatal(err)
	}
	rd, err := road.UnpackRoad(stored)
	if err != nil {
		t.Fatal(err)
	}
	return rd, sealed
}

// assertBare fails on a road that could redraw its route or pin it on an
// elevation map: any turn, or any height that is not above its first sample.
func assertBare(t *testing.T, what string, rd road.Road) {
	t.Helper()
	if rd.Heights[0] != 0 {
		t.Errorf("%s starts %v m above sea — an altitude", what, rd.Heights[0])
	}
	for i, turn := range rd.Turns {
		if turn != 0 {
			t.Fatalf("%s turns %d° at sample %d — turns add back up to the shape", what, turn, i)
		}
	}
}

// ADR-0063, where a dump reads it (#3511): the table's road holds heights
// above its start and no turns, with a key or without; the whole road is
// sealed with the shape and opens for its owner alone.
func TestAStoredRoadDrawsNoShapeAndHasNoAltitude(t *testing.T) {
	telling := map[string]any{
		"src": "gpx", "eleSource": "file", "road": testx.TellingRoad(), "shape": shape, "climbs": []any{},
	}
	whole, err := road.UnpackRoad(testx.TellingRoad())
	if err != nil {
		t.Fatal(err)
	}
	for _, keyed := range []bool{true, false} {
		var keys *secrets.Cipher
		if keyed {
			keys = testKey(t, "k")
		}
		h := setup(t, keys)
		status, body := h.call(t, "alice", http.MethodPost, "/api/routes", telling)
		if status != http.StatusCreated {
			t.Fatalf("keyed %v: keep %d %v", keyed, status, body)
		}
		id, _ := body["id"].(string)
		stored, sealed := h.storedRoad(t, id)
		assertBare(t, "the stored road", stored)
		if stored.LengthM != whole.LengthM || stored.GainM() != whole.GainM() || stored.Heights[40]-stored.Heights[39] != whole.Heights[40]-whole.Heights[39] {
			t.Errorf("keyed %v: the bare road is not the same road — %v m, %v m up", keyed, stored.LengthM, stored.GainM())
		}
		if (sealed != nil) != keyed {
			t.Errorf("keyed %v: road_sealed is %d bytes", keyed, len(sealed))
		}

		// The owner rides the whole road where there was a key to keep it.
		_, got := h.call(t, "alice", http.MethodGet, "/api/routes/"+id, nil)
		raw, _ := got["road"].(string)
		served, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			t.Fatal(err)
		}
		if keyed != bytes.Equal(served, testx.TellingRoad()) {
			t.Errorf("keyed %v: the owner read the whole road: %v", keyed, bytes.Equal(served, testx.TellingRoad()))
		}
	}
}

// The crew's cut is taken from the whole road, so it keeps the headings of
// the stretch it shows — and still nothing of the ends.
func TestTheCrewsCutKeepsItsHeadings(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	status, body := h.call(t, "alice", http.MethodPost, "/api/routes", map[string]any{
		"src": "gpx", "eleSource": "file", "road": testx.TellingRoad(), "shape": shape, "climbs": []any{},
	})
	if status != http.StatusCreated {
		t.Fatalf("keep: %d %v", status, body)
	}
	id, _ := body["id"].(string)
	out, err := NewAttacher(h.store.Queries, h.keys).Attach(t.Context(), workoutOn(id), h.users.ByToken["bob"].ID)
	if err != nil {
		t.Fatal(err)
	}
	cut, meta := roadIn(t, out)
	assertNothingOfTheEnds(t, "the crew's cut", cut, meta)
	if cut.Turns[len(cut.Turns)/2] != 1 {
		t.Errorf("the crew's cut turns %d° mid-road, want the stretch's 1°", cut.Turns[len(cut.Turns)/2])
	}
}

// Roads stored before #3511 are sealed and stripped at boot: under this
// server's key the whole road is sealed, with no key it is stripped alone,
// and a row under some other key is left for the re-seal. A second boot
// changes nothing.
func TestTheBootSealsRoadsStoredBefore(t *testing.T) {
	keys := testKey(t, "k")
	h := setup(t, keys)
	alice := h.users.ByToken["alice"].ID
	legacy := func(version *int32) string {
		t.Helper()
		var geom []byte
		if version != nil {
			geom = []byte("sealed")
		}
		row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
			OwnerID: alice, Src: "gpx", Name: "Home loop", GenName: "Road · 3.0 km · 50 m",
			Road: testx.TellingRoad(), RoadHash: "telling", LengthM: 3000, GainM: 50,
			Climbs: []byte("[]"), EleSource: "file", GeomSealed: geom, KeyVersion: version,
		})
		if err != nil {
			t.Fatal(err)
		}
		return store.UUIDString(row.ID)
	}
	ours, other := keys.Version(), keys.Version()+1
	sealedHere, keyless, elsewhere := legacy(&ours), legacy(nil), legacy(&other)

	for range 2 {
		SealRoads(t.Context(), h.store.Queries, keys, slog.New(slog.DiscardHandler))
	}
	for _, id := range []string{sealedHere, keyless} {
		stored, _ := h.storedRoad(t, id)
		assertBare(t, "a road the boot passed over", stored)
	}
	stored, sealed := h.storedRoad(t, sealedHere)
	if whole, err := WholeRoad(keys, stored.Pack(), sealed, &ours); err != nil || !bytes.Equal(whole, testx.TellingRoad()) {
		t.Errorf("the sealed road opens to %d bytes (%v), want the whole road", len(whole), err)
	}
	if _, sealed := h.storedRoad(t, keyless); sealed != nil {
		t.Errorf("a keyless row was sealed")
	}
	if stored, sealed := h.storedRoad(t, elsewhere); sealed != nil || stored.Turns[0] != testx.TellingEndTurn {
		t.Errorf("a row under another key was touched: sealed %d bytes, first turn %d", len(sealed), stored.Turns[0])
	}
}
